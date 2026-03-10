import * as pty from "node-pty";

const MAX_HISTORY_BYTES = 1024 * 1024;

export interface PtyExitEvent {
	exitCode: number;
	signal?: number;
}

export interface SpawnPtySessionRequest {
	binary: string;
	args?: string[];
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

export class PtySession {
	private readonly ptyProcess: pty.IPty;
	private readonly outputHistory: Buffer[] = [];
	private historyBytes = 0;
	private interrupted = false;

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
			this.onExitCallback?.(event);
		});
	}

	static spawn({
		binary,
		args = [],
		cwd,
		env,
		cols,
		rows,
		onData,
		onExit,
	}: SpawnPtySessionRequest): PtySession {
		const ptyProcess = pty.spawn(binary, args, {
			name: "xterm-256color",
			cwd,
			env,
			cols,
			rows,
			encoding: null,
		});
		return new PtySession(ptyProcess, onData, onExit);
	}

	get pid(): number {
		return this.ptyProcess.pid;
	}

	getOutputHistory(): readonly Buffer[] {
		return this.outputHistory;
	}

	write(data: string | Buffer): void {
		this.ptyProcess.write(typeof data === "string" ? data : data.toString("utf8"));
	}

	resize(cols: number, rows: number): void {
		this.ptyProcess.resize(cols, rows);
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
