/**
 * WSL managed launch — starts the Kanban runtime inside a WSL distribution.
 *
 * Uses `wsl.exe -d <distro> -- npx kanban ...` to launch the server inside
 * WSL. The parent Electron process reads stdout for a JSON "ready" message.
 *
 * Unlike the local `RuntimeChildManager` which uses Node IPC (`fork`), the
 * WSL launch uses `spawn` because `wsl.exe` is a native Windows binary.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { buildWslCommand } from "./wsl-detect.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WslLaunchOptions {
	/** WSL distribution name (e.g. "Ubuntu"). */
	distro: string;
	/** Command to run inside WSL. Defaults to "npx". */
	command?: string;
	/**
	 * Arguments passed to the command.
	 * Defaults to `["kanban", "--host", "0.0.0.0", "--port", "auto"]`.
	 * We bind to 0.0.0.0 so Windows can reach the server via localhost.
	 */
	commandArgs?: string[];
	/** Auth token the runtime should require. */
	authToken: string;
	/** Timeout (ms) waiting for the "ready" signal. Default: 30 000. */
	readyTimeoutMs?: number;
	/** Override spawn function (for testing). */
	spawnFn?: typeof spawn;
}

export interface WslLaunchResult {
	/** The URL the runtime is listening on (rewritten for Windows host). */
	url: string;
}

// ---------------------------------------------------------------------------
// Ready-line parsing
// ---------------------------------------------------------------------------

/**
 * The runtime prints a JSON line to stdout when ready:
 *     {"ready":true,"url":"http://0.0.0.0:54321"}
 */
export function parseReadyLine(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("{")) return null;
	try {
		const obj = JSON.parse(trimmed) as Record<string, unknown>;
		if (obj.ready && typeof obj.url === "string") {
			return obj.url;
		}
	} catch {
		// Not JSON — ignore.
	}
	return null;
}

/**
 * Rewrite a WSL-internal URL so the Windows host can reach it.
 * Inside WSL2 the server may bind to `0.0.0.0`; from Windows we use `127.0.0.1`.
 */
export function rewriteUrlForHost(wslUrl: string): string {
	try {
		const u = new URL(wslUrl);
		if (u.hostname === "0.0.0.0" || u.hostname === "::" || u.hostname === "[::]") {
			u.hostname = "127.0.0.1";
		}
		return u.toString().replace(/\/$/, "");
	} catch {
		return wslUrl;
	}
}

// ---------------------------------------------------------------------------
// WslLauncher
// ---------------------------------------------------------------------------

export class WslLauncher extends EventEmitter {
	private child: ChildProcess | null = null;
	private readonly opts: Required<
		Pick<WslLaunchOptions,
			"distro" | "command" | "commandArgs" | "authToken" | "readyTimeoutMs"
		>
	> & { spawnFn: typeof spawn };

	constructor(options: WslLaunchOptions) {
		super();
		this.opts = {
			distro: options.distro,
			command: options.command ?? "npx",
			commandArgs: options.commandArgs ?? [
				"kanban", "--host", "0.0.0.0", "--port", "auto",
			],
			authToken: options.authToken,
			readyTimeoutMs: options.readyTimeoutMs ?? 30_000,
			spawnFn: options.spawnFn ?? spawn,
		};
	}

	/** Launch the kanban runtime inside WSL. Resolves once the child reports ready. */
	async start(): Promise<WslLaunchResult> {
		if (this.child) throw new Error("WSL child process is already running.");

		const { file, args } = buildWslCommand(
			this.opts.distro,
			this.opts.command,
			[...this.opts.commandArgs, "--auth-token", this.opts.authToken],
		);

		return new Promise<WslLaunchResult>((resolve, reject) => {
			const child = this.opts.spawnFn(file, args, {
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			this.child = child;
			let settled = false;
			const settleResolve = (v: WslLaunchResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve(v);
			};
			const settleReject = (v: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(v);
			};

			const timer = setTimeout(() => {
				settleReject(new Error(
					`WSL runtime did not become ready within ${this.opts.readyTimeoutMs}ms.`,
				));
				this.stop();
			}, this.opts.readyTimeoutMs);

			let stdoutBuf = "";
			child.stdout?.on("data", (chunk: Buffer) => {
				stdoutBuf += chunk.toString("utf-8");
				const lines = stdoutBuf.split("\n");
				stdoutBuf = lines.pop() ?? "";
				for (const line of lines) {
					const url = parseReadyLine(line);
					if (url) {
						const hostUrl = rewriteUrlForHost(url);
						settleResolve({ url: hostUrl });
						this.emit("ready", hostUrl);
						return;
					}
				}
			});

			let stderrBuf = "";
			child.stderr?.on("data", (chunk: Buffer) => {
				stderrBuf += chunk.toString("utf-8");
			});

			child.on("error", (err) => {
				this.child = null;
				settleReject(err);
				this.emit("spawn-error", err.message);
			});

			child.on("exit", (code, signal) => {
				this.child = null;
				const msg = `WSL child exited (code=${code}, signal=${signal})` +
					(stderrBuf ? `\n${stderrBuf.slice(0, 1000)}` : "");
				settleReject(new Error(msg));
				this.emit("exited", code, signal);
			});
		});
	}

	/** Stop the WSL child process. */
	stop(): void {
		if (!this.child) return;
		try { this.child.kill("SIGTERM"); } catch { /* already dead */ }
		this.child = null;
	}

	/** Whether the child process is currently running. */
	get running(): boolean { return this.child !== null; }
}
