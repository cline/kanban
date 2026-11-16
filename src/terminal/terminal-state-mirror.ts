import serializeAddonModule from "@xterm/addon-serialize";
import headlessTerminalModule from "@xterm/headless";

const { SerializeAddon } = serializeAddonModule as typeof import("@xterm/addon-serialize");
const { Terminal } = headlessTerminalModule as typeof import("@xterm/headless");

/**
 * Server-side headless terminal scrollback.
 *
 * Kept deliberately small because the entire buffer is serialized via
 * `serializeAddon.serialize()` and shipped over the WebSocket on every
 * viewer connect (task switch). A 10,000-line buffer caused ~60s main-thread
 * freezes (#581) and RSS spikes toward OOM (#273) during long agent runs.
 * 1,000 lines is enough to show recent output while keeping the restore
 * snapshot ~10x smaller.
 */
const TERMINAL_SCROLLBACK = 1_000;

export interface TerminalRestoreSnapshot {
	snapshot: string;
	cols: number;
	rows: number;
}

interface TerminalStateMirrorOptions {
	onInputResponse?: (data: string) => void;
}

export class TerminalStateMirror {
	private readonly terminal: InstanceType<typeof Terminal>;
	private readonly serializeAddon = new SerializeAddon();
	private operationQueue: Promise<void> = Promise.resolve();

	constructor(cols: number, rows: number, options: TerminalStateMirrorOptions = {}) {
		this.terminal = new Terminal({
			allowProposedApi: true,
			cols,
			rows,
			scrollback: TERMINAL_SCROLLBACK,
		});
		this.terminal.loadAddon(this.serializeAddon);
		this.terminal.onData((data) => {
			options.onInputResponse?.(data);
		});
	}

	applyOutput(chunk: Buffer): void {
		const chunkCopy = new Uint8Array(chunk);
		this.enqueueOperation(
			() =>
				new Promise<void>((resolve) => {
					this.terminal.write(chunkCopy, () => {
						resolve();
					});
				}),
		);
	}

	resize(cols: number, rows: number): void {
		if (cols === this.terminal.cols && rows === this.terminal.rows) {
			return;
		}
		this.enqueueOperation(() => {
			this.terminal.resize(cols, rows);
		});
	}

	async getSnapshot(): Promise<TerminalRestoreSnapshot> {
		await this.operationQueue;
		return {
			// Serialize only the visible viewport (scrollback: 0) instead of the
			// full buffer. The viewer immediately receives live output deltas
			// after restore, so shipping the entire scrollback history on every
			// task switch is unnecessary and was the dominant cause of the
			// ~60s main-thread freeze (#581) and OOM trajectory (#273) during
			// long agent runs. This keeps the restore payload to roughly
			// rows*cols bytes regardless of run length.
			snapshot: this.serializeAddon.serialize({ scrollback: 0 }),
			cols: this.terminal.cols,
			rows: this.terminal.rows,
		};
	}

	dispose(): void {
		this.terminal.dispose();
	}

	private enqueueOperation(operation: () => void | Promise<void>): void {
		this.operationQueue = this.operationQueue
			.catch(() => undefined)
			.then(async () => {
				await operation();
			});
	}
}
