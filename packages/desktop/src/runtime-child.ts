/**
 * RuntimeChildManager — manages the Kanban runtime as a child process.
 *
 * Responsibilities:
 * - Forking the runtime child process (outside asar via asarUnpack)
 * - Sending ParentToChildMessage IPC messages (start, shutdown, heartbeat-ack)
 * - Receiving ChildToParentMessage IPC messages (ready, error, shutdown-complete, heartbeat)
 * - Heartbeat monitoring with configurable timeout
 * - Crash detection and auto-restart logic (3 attempts, 5-min decay)
 * - Graceful shutdown with force-kill fallback
 * - tree-kill on Windows for grandchild cleanup
 */

import { type ChildProcess, execSync, fork } from "node:child_process";
import { EventEmitter } from "node:events";
import path, { join } from "node:path";

import type {
	ChildToParentMessage,
	ParentToChildMessage,
	RuntimeConfig,
} from "./ipc-protocol.js";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface RuntimeChildManagerEvents {
	ready: (url: string) => void;
	error: (message: string) => void;
	crashed: (exitCode: number | null, signal: string | null) => void;
	"shutdown-complete": () => void;
}

export interface RuntimeChildManagerOptions {
	/** Path to the runtime entry-point JS file (must be outside asar). */
	childScriptPath: string;
	/** Timeout in ms to wait for graceful shutdown before force-killing. Default: 5 000. */
	shutdownTimeoutMs?: number;
	/** Heartbeat interval in ms — how often we expect the child to ping. Default: 5 000. */
	heartbeatIntervalMs?: number;
	/** Heartbeat timeout in ms — no heartbeat within this window → dead. Default: 15 000. */
	heartbeatTimeoutMs?: number;
	/** Maximum auto-restart attempts before giving up. Default: 3. */
	maxRestarts?: number;
	/** Time window in ms after which the restart counter resets. Default: 300 000 (5 min). */
	restartDecayMs?: number;
	/** Override for `child_process.fork` — used in tests to inject a mock. */
	forkFn?: typeof fork;
}

// ---------------------------------------------------------------------------
// Allowed environment variables forwarded to the child process.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// V8 heap configuration for the runtime child process.
//
// When forked from Electron, the child inherits the main process's execArgv
// which may include restrictive V8 flags (e.g. smaller heap limits). The
// runtime child runs all agent sessions, message repositories, and PTY
// processes in a single Node process, so it needs a generous heap — especially
// when multiple agents run concurrently across different projects.
//
// Without an explicit execArgv override, the child can OOM within minutes
// under multi-agent workloads (the crash manifests as SIGABRT from
// node::OnFatalError during V8 GC).
// ---------------------------------------------------------------------------

/** Heap limit in MB for the runtime child process. */
const RUNTIME_CHILD_MAX_OLD_SPACE_MB = 4096;

const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
	'PATH', 'PATHEXT',
	'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
	'SYSTEMROOT', 'COMSPEC',
	'TMPDIR', 'TEMP', 'TMP',
	'LANG', 'LC_ALL', 'LC_CTYPE', 'NODE_ENV', 'SHELL', 'TERM',
	'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'ProgramFiles(x86)',
	'ProgramData', 'SYSTEMDRIVE',
	'XDG_RUNTIME_DIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME',
]);

/** Prefixes that are always forwarded to the runtime child. */
const ALLOWED_ENV_PREFIXES: readonly string[] = [
	"KANBAN_",
	"ANTHROPIC_",
	"OPENAI_",
	"OPENROUTER_",
	"GOOGLE_",
	"GEMINI_",
	"AWS_",
	"AZURE_",
	"MISTRAL_",
	"DEEPSEEK_",
	"GROQ_",
	"XAI_",
	"FIREWORKS_",
	"TOGETHER_",
	"COHERE_",
	"PERPLEXITY_",
	"CEREBRAS_",
	"OCA_",
	"CLINE_",
];

/**
 * Build extra PATH directories for Windows.
 *
 * Windows GUI apps inherit the system PATH, but common developer tool
 * install locations (npm global, Node.js user install, Git for Windows,
 * Python Scripts) may not be present. We add well-known directories so
 * agent shell sessions can find binaries like `kanban`, `git`, `node`, etc.
 */
function getWindowsExtraPathDirs(): string[] {
	const dirs: string[] = [];
	const localAppData = process.env.LOCALAPPDATA;
	const appData = process.env.APPDATA;
	const programFiles = process.env['ProgramFiles'];
	const programFilesX86 = process.env['ProgramFiles(x86)'];
	// npm global installs
	if (appData) dirs.push(join(appData, 'npm'));
	// Node.js user install
	if (localAppData) dirs.push(join(localAppData, 'Programs', 'nodejs'));
	// Scoop (common Windows package manager)
	if (localAppData) dirs.push(join(localAppData, 'Microsoft', 'WinGet', 'Packages'));
	// Git for Windows
	if (programFiles) dirs.push(join(programFiles, 'Git', 'cmd'));
	if (programFilesX86) dirs.push(join(programFilesX86, 'Git', 'cmd'));
	// Python
	if (localAppData) dirs.push(join(localAppData, 'Programs', 'Python', 'Python3*', 'Scripts'));
	return dirs.filter(Boolean);
}

/**
 * Standard PATH directories to add when running as a desktop GUI app.
 *
 * macOS GUI apps inherit the system PATH from launchd, which typically only
 * includes /usr/bin:/bin:/usr/sbin:/sbin. This misses Homebrew, nvm, and
 * other user-installed tool directories. We append common locations so
 * agent shell sessions can find binaries like `kanban`, `git`, `node`, etc.
 */
const EXTRA_PATH_DIRS: readonly string[] =
	process.platform === "darwin"
		? [
				"/opt/homebrew/bin",
				"/opt/homebrew/sbin",
				"/usr/local/bin",
				"/usr/local/sbin",
				// System directories — macOS GUI apps launched via launchd
				// inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin) but
				// if the inherited PATH is empty or overridden, these must be
				// present so shells and core tools can always be found.
				"/usr/bin",
				"/bin",
				"/usr/sbin",
				"/sbin",
			]
		: process.platform === "linux"
			? ["/usr/local/bin", "/snap/bin", "/usr/bin", "/bin"]
			: process.platform === "win32"
				? getWindowsExtraPathDirs()
				: [];

/** Build a filtered copy of `process.env` containing only allowed keys. */
export function buildFilteredEnv(): NodeJS.ProcessEnv {
	const filtered: NodeJS.ProcessEnv = {};

	// Forward exact-match allowed keys.
	for (const key of ALLOWED_ENV_KEYS) {
		if (process.env[key] !== undefined) {
			filtered[key] = process.env[key];
		}
	}

	// Forward keys matching allowed prefixes (provider API keys, KANBAN_*, etc.).
	for (const key of Object.keys(process.env)) {
		if (filtered[key] !== undefined) continue;
		for (const prefix of ALLOWED_ENV_PREFIXES) {
			if (key.startsWith(prefix)) {
				filtered[key] = process.env[key];
				break;
			}
		}
	}

	// Enrich PATH with common directories that macOS GUI apps miss.
	if (EXTRA_PATH_DIRS.length > 0) {
		const currentPath = filtered.PATH ?? "";
		const pathParts = new Set(currentPath.split(path.delimiter).filter(Boolean));
		for (const dir of EXTRA_PATH_DIRS) {
			pathParts.add(dir);
		}
		filtered.PATH = [...pathParts].join(path.delimiter);
	}

	return filtered;
}

/**
 * Resolve the child script path for production builds.
 * Swaps `app.asar` → `app.asar.unpacked` so fork() can access the file.
 */
export function resolveChildScriptPath(rawPath: string): string {
	return rawPath.replace(
		`${path.sep}app.asar${path.sep}`,
		`${path.sep}app.asar.unpacked${path.sep}`,
	);
}

/** Kill a process tree. Uses `taskkill /T /F` on Windows. */
function treeKill(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
	if (process.platform === "win32") {
		try {
			execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
		} catch { /* process may already be dead */ }
	} else {
		try {
			process.kill(pid, signal);
		} catch { /* ESRCH — already exited */ }
	}
}

// ---------------------------------------------------------------------------
// RuntimeChildManager
// ---------------------------------------------------------------------------

export class RuntimeChildManager extends EventEmitter {
	private readonly opts: Required<
		Pick<RuntimeChildManagerOptions,
			"childScriptPath" | "shutdownTimeoutMs" | "heartbeatIntervalMs" |
			"heartbeatTimeoutMs" | "maxRestarts" | "restartDecayMs"
		>
	> & { forkFn: typeof fork };

	private child: ChildProcess | null = null;
	private lastConfig: RuntimeConfig | null = null;
	private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
	private restartCount = 0;
	private lastCrashTime = 0;
	private shutdownRequested = false;
	private disposed = false;

	constructor(options: RuntimeChildManagerOptions) {
		super();
		this.opts = {
			childScriptPath: options.childScriptPath,
			shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
			heartbeatIntervalMs: options.heartbeatIntervalMs ?? 5_000,
			heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 15_000,
			maxRestarts: options.maxRestarts ?? 3,
			restartDecayMs: options.restartDecayMs ?? 300_000,
			forkFn: options.forkFn ?? fork,
		};
	}

	/** Start the child. Resolves with the runtime URL on `ready`. */
	async start(config: RuntimeConfig): Promise<string> {
		if (this.disposed) throw new Error("RuntimeChildManager has been disposed");
		if (this.child) throw new Error("Child process is already running");
		this.lastConfig = config;
		this.shutdownRequested = false;
		return this.spawnChild(config);
	}

	/** Graceful shutdown; force-kills after shutdownTimeoutMs. */
	async shutdown(): Promise<void> {
		if (!this.child) return;
		this.shutdownRequested = true;
		this.clearHeartbeatTimer();
		return new Promise<void>((resolve) => {
			const forceTimer = setTimeout(() => {
				this.forceKill(); resolve();
			}, this.opts.shutdownTimeoutMs);
			const onDone = () => { clearTimeout(forceTimer); resolve(); };
			this.once("shutdown-complete", onDone);
			if (this.child) {
				this.child.once("exit", () => {
					this.removeListener("shutdown-complete", onDone);
					clearTimeout(forceTimer); resolve();
				});
			}
			this.send({ type: "shutdown" });
		});
	}

	/** Send an IPC message to the child process. */
	send(message: ParentToChildMessage): void {
		if (!this.child?.connected) return;
		this.child.send(message);
	}

	/** Register a handler for child → parent messages. */
	onMessage(handler: (message: ChildToParentMessage) => void): void {
		this.on("child-message", handler);
	}

	/** Dispose: kill child and prevent further use. */
	async dispose(): Promise<void> {
		this.disposed = true;
		await this.shutdown();
		this.removeAllListeners();
	}

	/** Whether a child process is currently running. */
	get running(): boolean { return this.child !== null; }

	/** PID of the child process, or `null` if not running. */
	get pid(): number | null { return this.child?.pid ?? null; }

	// -- Internals ----------------------------------------------------------

	private spawnChild(config: RuntimeConfig): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const scriptPath = resolveChildScriptPath(this.opts.childScriptPath);
			const child = this.opts.forkFn(scriptPath, [], {
				stdio: ["ignore", "pipe", "pipe", "ipc"],
				env: buildFilteredEnv(),
				// Override execArgv so the child does NOT inherit Electron's
				// restrictive V8 flags.  Give the runtime a generous heap —
				// it hosts all agent sessions, message stores, and PTY
				// processes in one process.
				execArgv: [`--max-old-space-size=${RUNTIME_CHILD_MAX_OLD_SPACE_MB}`],
			});
			this.child = child;
			child.stdout?.on('data', () => {});
			child.stderr?.on('data', () => {});
			let settled = false;
			const settle = (fn: typeof resolve | typeof reject, v: string | Error) => {
				if (settled) return;
				settled = true;
				(fn as (x: string | Error) => void)(v);
			};

			child.on("message", (raw: unknown) => {
				const msg = raw as ChildToParentMessage;
				this.emit("child-message", msg);
				switch (msg.type) {
					case "ready":
						this.startHeartbeatMonitor();
						settle(resolve, msg.url);
						this.emit("ready", msg.url);
						break;
					case "error":
						settle(reject, new Error(`Runtime child error: ${msg.message}`));
						this.emit("error", msg.message);
						break;
					case "shutdown-complete":
						this.clearHeartbeatTimer();
						this.emit("shutdown-complete");
						break;
					case "heartbeat":
						this.resetHeartbeatTimer();
						this.send({ type: "heartbeat-ack" });
						break;
				}
			});

			child.on("exit", (code, signal) => {
				this.clearHeartbeatTimer();
				this.child = null;
				settle(reject, new Error(
					`Runtime child exited unexpectedly (code=${code}, signal=${signal})`,
				));
				if (!this.shutdownRequested) {
					this.emit("crashed", code, signal);
					this.maybeAutoRestart();
				}
			});

			child.on("error", (err) => {
				this.clearHeartbeatTimer();
				this.child = null;
				settle(reject, err);
			});

			this.send({ type: "start", config });
		});
	}

	// -- Heartbeat ----------------------------------------------------------

	private startHeartbeatMonitor(): void { this.resetHeartbeatTimer(); }

	private resetHeartbeatTimer(): void {
		this.clearHeartbeatTimer();
		this.heartbeatTimer = setTimeout(() => {
			this.forceKill();
		}, this.opts.heartbeatTimeoutMs);
	}

	private clearHeartbeatTimer(): void {
		if (this.heartbeatTimer !== null) {
			clearTimeout(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	// -- Auto-restart -------------------------------------------------------

	private maybeAutoRestart(): void {
		if (this.disposed || this.shutdownRequested || !this.lastConfig) return;
		const now = Date.now();
		if (now - this.lastCrashTime > this.opts.restartDecayMs) {
			this.restartCount = 0;
		}
		this.lastCrashTime = now;
		this.restartCount++;
		if (this.restartCount > this.opts.maxRestarts) {
			this.emit("error",
				`Runtime child exceeded maximum restart attempts (${this.opts.maxRestarts})`,
			);
			return;
		}
		setImmediate(() => {
			if (this.disposed || this.shutdownRequested) return;
			this.spawnChild(this.lastConfig!).catch((err) => {
				this.emit("error", `Auto-restart failed: ${(err as Error).message}`);
			});
		});
	}

	// -- Force-kill ---------------------------------------------------------

	private forceKill(): void {
		if (!this.child) return;
		const pid = this.child.pid;
		if (pid !== undefined) treeKill(pid, "SIGKILL");
		try { this.child.kill("SIGKILL"); } catch { /* already dead */ }
	}
}
