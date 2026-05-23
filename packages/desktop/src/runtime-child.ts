/**
 * RuntimeChildManager — spawns the Kanban CLI as a subprocess, polls for
 * readiness over HTTP, and manages orderly shutdown.
 *
 * Non-goals (intentional):
 *   - No in-process runtime imports. The CLI lives in its own process.
 *   - No custom IPC. Lifecycle is managed via signals + process events.
 *   - No auto-restart. On crash we emit "crashed"; the main process
 *     decides whether to show a disconnected screen or offer restart.
 *   - No window management.
 *
 * Env/PATH policy is delegated to runtime-child-env.ts.
 */

import { type ChildProcess, execSync, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import http from "node:http";
import path from "node:path";

import { buildFilteredEnv } from "./runtime-child-env.js";

export interface RuntimeChildConfig {
	host: string;
	port: number;
}

export interface RuntimeChildManagerEvents {
	ready: [url: string];
	error: [message: string];
	/**
	 * Emitted when the subprocess exits without a prior `shutdown()` call.
	 * `stderrTail` is the last ~8 KB of child stderr, for diagnosing
	 * startup failures.
	 */
	crashed: [exitCode: number | null, signal: string | null, stderrTail: string];
}

export interface RuntimeChildManagerOptions {
	cliPath: string;
	/** Graceful-shutdown grace period before force-kill. Default: 5 000 ms. */
	shutdownTimeoutMs?: number;
	/** HTTP health-check poll interval. Default: 200 ms. */
	pollIntervalMs?: number;
	/** Max time to wait for runtime to become reachable. Default: 30 000 ms. */
	startupTimeoutMs?: number;
	/**
	 * V8 `--max-old-space-size` in MB. Default: 4 096. The runtime hosts
	 * all agent sessions, message repositories, and PTY processes in one
	 * Node process, so generous headroom matters for multi-agent workloads.
	 */
	maxOldSpaceMb?: number;
	spawnFn?: typeof spawn;
}

const DEFAULT_MAX_OLD_SPACE_MB = 4096;
const STDERR_TAIL_MAX_BYTES = 8192;

/**
 * Swap `app.asar` → `app.asar.unpacked` so `spawn()` can execute the CLI
 * from the unpacked bundle (asar archives are not natively executable).
 */
export function resolveCliPath(rawPath: string): string {
	return rawPath.replace(
		`${path.sep}app.asar${path.sep}`,
		`${path.sep}app.asar.unpacked${path.sep}`,
	);
}

/**
 * Kills the subprocess *and* its descendants. The CLI spawns PTYs and shell
 * workers, so a direct `process.kill(pid)` would leave those grandchildren
 * re-parented to init.
 *
 *   - Windows: `taskkill /T /F` walks the tree.
 *   - POSIX:   signals the whole process group (`-pid`). Requires the child
 *              to have been spawned with `detached: true` so it leads its own
 *              process group; otherwise `-pid` would target *our* group.
 */
function treeKill(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
	if (process.platform === "win32") {
		try {
			execSync(`taskkill /T /F /PID ${pid}`, { stdio: "ignore" });
		} catch {
			/* process already dead */
		}
	} else {
		try {
			process.kill(-pid, signal);
		} catch {
			/* process group already gone (ESRCH) */
		}
	}
}

function waitForReady(
	host: string,
	port: number,
	pollIntervalMs: number,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const deadline = Date.now() + timeoutMs;

		const check = () => {
			if (signal.aborted) {
				reject(new Error("Health check aborted"));
				return;
			}
			if (Date.now() > deadline) {
				reject(new Error(`Runtime did not become reachable within ${timeoutMs}ms`));
				return;
			}

			const req = http.get({ host, port, path: "/", timeout: 2_000 }, (res) => {
				res.resume();
				// Only treat 2xx as "ready". If the CLI binds the port but
				// answers with 5xx during a bad startup (e.g., partial
				// initialisation), keep polling instead of announcing ready.
				if (res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300) {
					resolve();
				} else {
					setTimeout(check, pollIntervalMs);
				}
			});
			req.on("error", () => {
				// Destroy for symmetry with the timeout path — on error the
				// socket is already terminated, but being explicit avoids
				// depending on that implementation detail.
				req.destroy();
				setTimeout(check, pollIntervalMs);
			});
			req.on("timeout", () => {
				req.destroy();
				setTimeout(check, pollIntervalMs);
			});
		};

		check();
	});
}

export class RuntimeChildManager extends EventEmitter<RuntimeChildManagerEvents> {
	private readonly opts: {
		cliPath: string;
		shutdownTimeoutMs: number;
		pollIntervalMs: number;
		startupTimeoutMs: number;
		maxOldSpaceMb: number;
		spawnFn: typeof spawn;
	};

	private child: ChildProcess | null = null;
	private shutdownRequested = false;
	private disposed = false;
	private abortController: AbortController | null = null;

	constructor(options: RuntimeChildManagerOptions) {
		super();
		this.opts = {
			cliPath: options.cliPath,
			shutdownTimeoutMs: options.shutdownTimeoutMs ?? 5_000,
			pollIntervalMs: options.pollIntervalMs ?? 200,
			startupTimeoutMs: options.startupTimeoutMs ?? 30_000,
			maxOldSpaceMb: options.maxOldSpaceMb ?? DEFAULT_MAX_OLD_SPACE_MB,
			spawnFn: options.spawnFn ?? spawn,
		};
	}

	async start(config: RuntimeChildConfig): Promise<string> {
		if (this.disposed) throw new Error("RuntimeChildManager has been disposed");
		if (this.child) throw new Error("Child process is already running");
		this.shutdownRequested = false;
		return this.spawnChild(config);
	}

	// Graceful shutdown via SIGTERM; force-kills after shutdownTimeoutMs.
	async shutdown(): Promise<void> {
		if (!this.child) return;
		this.shutdownRequested = true;
		this.abortController?.abort();

		return new Promise<void>((resolve) => {
			const forceTimer = setTimeout(() => {
				this.forceKill();
				resolve();
			}, this.opts.shutdownTimeoutMs);

			if (this.child) {
				this.child.once("exit", () => {
					clearTimeout(forceTimer);
					resolve();
				});
			}

			const pid = this.child?.pid;
			if (pid !== undefined) treeKill(pid, "SIGTERM");
		});
	}

	async dispose(): Promise<void> {
		this.disposed = true;
		await this.shutdown();
		this.removeAllListeners();
	}

	get running(): boolean {
		return this.child !== null;
	}

	private async spawnChild(config: RuntimeChildConfig): Promise<string> {
		const cliPath = resolveCliPath(this.opts.cliPath);
		const url = `http://${config.host}:${config.port}`;

		const env = buildFilteredEnv();
		env.KANBAN_DESKTOP = "1";
		// Merge our V8 heap limit with any existing NODE_OPTIONS from parent.
		// Strip both hyphen and underscore variants to avoid duplicates.
		const existingNodeOptions = env.NODE_OPTIONS?.trim() || "";
		const cleanedOptions = existingNodeOptions
			.replace(/--max[-_]old[-_]space[-_]size=\d+/g, "")
			.trim();
		const ourOptions = `--max-old-space-size=${this.opts.maxOldSpaceMb}`;
		env.NODE_OPTIONS = cleanedOptions
			? `${cleanedOptions} ${ourOptions}`
			: ourOptions;

		const args = ["--no-open", "--port", String(config.port), "--host", config.host];

		// POSIX: `detached: true` makes the child lead its own process
		// group, which is REQUIRED for `process.kill(-pid, …)` in treeKill
		// to signal the whole subtree without also hitting our own group.
		//
		// Windows: `taskkill /T /F /PID <pid>` walks the tree via PPID, so
		// process groups are not needed. Worse, `detached: true` on Windows
		// decouples child lifetime from the parent, which can leave a
		// zombie CLI holding port 3484 if Electron crashes. Keep it false.
		const child = this.opts.spawnFn(cliPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env,
			detached: process.platform !== "win32",
			// Prevent a console flash on Windows when the parent has a
			// window (no-op on POSIX).
			windowsHide: true,
		});
		this.child = child;

		// Create the abort controller BEFORE attaching exit/error handlers so
		// those handlers can abort a pending health check even if the failure
		// fires synchronously during spawn setup.
		this.abortController = new AbortController();

		// Pre-ready lifecycle contract: failures before "ready" reject start()
		// with a diagnostic; failures after "ready" flow through crashed/error
		// events. One failure never produces both a rejection and an event.
		let readyEmitted = false;
		let startupFailure: Error | null = null;

		// Drain stdout so the child doesn't block on a full OS pipe buffer.
		child.stdout?.on("data", () => {});

		// Rolling stderr tail — sized to stay in memory for the lifetime of
		// the subprocess and handed to the crashed listener on exit.
		let stderrTail = "";
		child.stderr?.on("data", (chunk: Buffer) => {
			stderrTail += chunk.toString("utf8");
			if (stderrTail.length > STDERR_TAIL_MAX_BYTES) {
				stderrTail = stderrTail.slice(-STDERR_TAIL_MAX_BYTES);
			}
		});

		child.on("exit", (code, signal) => {
			this.child = null;
			if (this.shutdownRequested) return;
			if (!readyEmitted) {
				const tail = stderrTail.trim();
				startupFailure = new Error(
					`CLI subprocess exited during startup (exitCode=${code ?? "null"}, signal=${signal ?? "null"}). Last stderr: ${tail || "<empty>"}`,
				);
				this.abortController?.abort();
			} else {
				this.emit("crashed", code, signal, stderrTail);
			}
		});

		child.on("error", (err) => {
			this.child = null;
			if (!readyEmitted) {
				startupFailure = err;
				this.abortController?.abort();
			} else {
				this.emit("error", err.message);
			}
		});

		try {
			await waitForReady(
				config.host,
				config.port,
				this.opts.pollIntervalMs,
				this.opts.startupTimeoutMs,
				this.abortController.signal,
			);
		} catch (error) {
			// Prefer the captured lifecycle failure (more informative) over
			// waitForReady's abort/timeout error. Tear down a still-alive
			// child so no orphan remains.
			if (this.child) this.forceKill();
			throw startupFailure ?? error;
		}

		// Guard against dispose() landing between health check resolving and
		// the ready announcement.
		if (this.disposed) {
			if (this.child) this.forceKill();
			throw new Error("RuntimeChildManager was disposed during startup");
		}

		readyEmitted = true;
		this.emit("ready", url);
		return url;
	}

	private forceKill(): void {
		if (!this.child) return;
		const pid = this.child.pid;
		if (pid !== undefined) treeKill(pid, "SIGKILL");
		try {
			this.child.kill("SIGKILL");
		} catch {
			/* already dead */
		}
	}
}
