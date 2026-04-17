interface CodexHostSessionCallbacks {
	onEcho: (chunk: Buffer) => void;
	onSubmitLine: (line: string) => void;
	onInterrupt: () => void;
	canAcceptInput: () => boolean;
}

function isPrintableByte(byte: number): boolean {
	return byte >= 0x20 && byte !== 0x7f;
}

export class CodexHostSession {
	readonly pid: number | null;
	private interrupted = false;
	private inputBuffer = "";
	private paused = false;

	constructor(
		pid: number | null,
		private readonly callbacks: CodexHostSessionCallbacks,
	) {
		this.pid = pid;
	}

	write(data: string | Buffer): void {
		const chunk = typeof data === "string" ? Buffer.from(data, "utf8") : data;
		for (const byte of chunk.values()) {
			if (byte === 0x03) {
				this.callbacks.onEcho(Buffer.from("^C\r\n", "utf8"));
				this.inputBuffer = "";
				this.callbacks.onInterrupt();
				continue;
			}
			if (!this.callbacks.canAcceptInput()) {
				continue;
			}
			if (byte === 0x08 || byte === 0x7f) {
				if (this.inputBuffer.length === 0) {
					continue;
				}
				this.inputBuffer = this.inputBuffer.slice(0, -1);
				this.callbacks.onEcho(Buffer.from("\b \b", "utf8"));
				continue;
			}
			if (byte === 0x0d || byte === 0x0a) {
				const line = this.inputBuffer;
				this.inputBuffer = "";
				this.callbacks.onEcho(Buffer.from("\r\n", "utf8"));
				if (line.trim().length > 0) {
					this.callbacks.onSubmitLine(line);
				} else {
					this.callbacks.onEcho(Buffer.from("› ", "utf8"));
				}
				continue;
			}
			if (!isPrintableByte(byte)) {
				continue;
			}
			const value = Buffer.from([byte]).toString("utf8");
			this.inputBuffer += value;
			this.callbacks.onEcho(Buffer.from(value, "utf8"));
		}
	}

	resize(): void {}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
	}

	stop(options?: { interrupted?: boolean }): void {
		if (options?.interrupted) {
			this.interrupted = true;
		}
	}

	wasInterrupted(): boolean {
		return this.interrupted;
	}

	isPaused(): boolean {
		return this.paused;
	}
}
