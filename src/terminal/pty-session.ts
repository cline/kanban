import * as pty from "node-pty";

const MAX_HISTORY_BYTES = 1024 * 1024;
const WINDOWS_CMD_META_CHARS_REGEXP = /([()\][%!^"`<>&|;, *?])/g;

export interface PtyExitEvent {
	exitCode: number;
	signal?: number;
}

export interface SpawnPtySessionRequest {
	binary: string;
	args?: string[] | string;
	cwd: string;
	env?: Record<string, string | undefined>;
	cols: number;
	rows: number;
	onData?: (chunk: Buffer) => void;
	onExit?: (event: PtyExitEvent) => void;
}

type PtyOutputChunk = string | Buffer | Uint8Array;

function normalizeOutputChunk(data: PtyOutputChunk): Buffer {
	if (typeof data === "string") {
		return Buffer.from(data, "utf8");
	}
	return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function isIgnorablePtyWriteError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	return code === "EIO" || code === "EBADF";
}

function isIgnorablePtyResizeError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "EIO" || code === "EBADF") {
		return true;
	}
	return error.message.toLowerCase().includes("already exited");
}

function terminatePtyProcess(ptyProcess: pty.IPty): void {
	const pid = ptyProcess.pid;
	ptyProcess.kill();
	if (process.platform !== "win32" && Number.isFinite(pid) && pid > 0) {
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			// Best effort: process group may already be gone or inaccessible.
		}
	}
}

function resolveWindowsComSpec(): string {
	const comSpec = process.env.ComSpec?.trim() || process.env.COMSPEC?.trim();
	return comSpec || "cmd.exe";
}

function escapeWindowsCommand(value: string): string {
	return value.replace(WINDOWS_CMD_META_CHARS_REGEXP, "^$1");
}

function normalizeWindowsCmdArgument(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "\\n");
}

function escapeWindowsArgument(value: string): string {
	let escaped = normalizeWindowsCmdArgument(`${value}`);
	escaped = escaped.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
	escaped = escaped.replace(/(?=(\\+?)?)\1$/g, "$1$1");
	escaped = `"${escaped}"`;
	escaped = escaped.replace(WINDOWS_CMD_META_CHARS_REGEXP, "^$1");
	return escaped;
}

function buildWindowsCmdArgsCommandLine(binary: string, args: string[]): string {
	const escapedCommand = escapeWindowsCommand(binary);
	const escapedArgs = args.map((part) => escapeWindowsArgument(part));
	const shellCommand = [escapedCommand, ...escapedArgs].join(" ");
	return `/d /s /c "${shellCommand}"`;
}

function shouldUseWindowsShellLaunch(binary: string): boolean {
	if (process.platform !== "win32") {
		return false;
	}
	const normalized = binary.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	if (normalized === "cmd" || normalized === "cmd.exe") {
		return false;
	}
	return normalized !== resolveWindowsComSpec().toLowerCase();
}

export class PtySession {
	private readonly ptyProcess: pty.IPty;
	private readonly outputHistory: Buffer[] = [];
	private historyBytes = 0;
	private interrupted = false;
	private exited = false;

	private constructor(
		ptyProcess: pty.IPty,
		private readonly onDataCallback?: (chunk: Buffer) => void,
		private readonly onExitCallback?: (event: PtyExitEvent) => void,
	) {
		this.ptyProcess = ptyProcess;
		(this.ptyProcess.onData as unknown as (listener: (data: PtyOutputChunk) => void) => void)((data) => {
			const chunk = normalizeOutputChunk(data);
			this.outputHistory.push(chunk);
			this.historyBytes += chunk.byteLength;
			while (this.historyBytes > MAX_HISTORY_BYTES && this.outputHistory.length > 0) {
				const shifted = this.outputHistory.shift();
				if (!shifted) {
					break;
				}
				this.historyBytes -= shifted.byteLength;
			}
			this.onDataCallback?.(chunk);
		});
		this.ptyProcess.onExit((event) => {
			this.exited = true;
			this.onExitCallback?.(event);
		});
	}

	static spawn({ binary, args = [], cwd, env, cols, rows, onData, onExit }: SpawnPtySessionRequest): PtySession {
		const normalizedArgs = typeof args === "string" ? [args] : args;
		const terminalName = env?.TERM?.trim() || process.env.TERM?.trim() || "xterm-256color";
		const useWindowsShellLaunch = shouldUseWindowsShellLaunch(binary);
		const spawnBinary = useWindowsShellLaunch ? resolveWindowsComSpec() : binary;
		const spawnArgs = useWindowsShellLaunch
			? buildWindowsCmdArgsCommandLine(binary, normalizedArgs)
			: normalizedArgs;
		const ptyOptions: pty.IPtyForkOptions = {
			name: terminalName,
			cwd,
			env,
			cols,
			rows,
			encoding: null,
		};

		const ptyProcess = pty.spawn(spawnBinary, spawnArgs, ptyOptions);
		return new PtySession(ptyProcess, onData, onExit);
	}

	get pid(): number {
		return this.ptyProcess.pid;
	}

	getOutputHistory(): readonly Buffer[] {
		return this.outputHistory;
	}

	write(data: string | Buffer): void {
		try {
			this.ptyProcess.write(typeof data === "string" ? data : data.toString("utf8"));
		} catch (error) {
			if (isIgnorablePtyWriteError(error)) {
				return;
			}
			throw error;
		}
	}

	resize(cols: number, rows: number, pixelWidth?: number, pixelHeight?: number): void {
		if (this.exited) {
			return;
		}
		try {
			if (pixelWidth !== undefined && pixelHeight !== undefined) {
				this.ptyProcess.resize(cols, rows, {
					width: pixelWidth,
					height: pixelHeight,
				});
				return;
			}
			this.ptyProcess.resize(cols, rows);
		} catch (error) {
			if (isIgnorablePtyResizeError(error)) {
				this.exited = true;
				return;
			}
			throw error;
		}
	}

	pause(): void {
		this.ptyProcess.pause();
	}

	resume(): void {
		this.ptyProcess.resume();
	}

	stop(options?: { interrupted?: boolean }): void {
		if (options?.interrupted) {
			this.interrupted = true;
		}
		terminatePtyProcess(this.ptyProcess);
	}

	wasInterrupted(): boolean {
		return this.interrupted;
	}
}
