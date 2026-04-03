/**
 * RuntimeChildManager — manages the Kanban runtime as a child process.
 *
 * Stub for Task 1.2. Will be responsible for:
 * - Forking the runtime child process (outside asar via asarUnpack)
 * - Sending ParentToChildMessage IPC messages (start, shutdown, heartbeat-ack)
 * - Receiving ChildToParentMessage IPC messages (ready, error, shutdown-complete, heartbeat)
 * - Heartbeat monitoring with configurable timeout
 * - Crash detection and restart logic
 * - Graceful shutdown with force-kill fallback
 */

import type {
	ChildToParentMessage,
	ParentToChildMessage,
	RuntimeConfig,
} from "./ipc-protocol.js";

export interface RuntimeChildManagerEvents {
	ready: (url: string) => void;
	error: (message: string) => void;
	crashed: (exitCode: number | null, signal: string | null) => void;
	"shutdown-complete": () => void;
}

export interface RuntimeChildManagerOptions {
	/** Path to the runtime-child.js entry point (must be outside asar). */
	childScriptPath: string;
	/** Timeout in ms to wait for graceful shutdown before force-killing. */
	shutdownTimeoutMs?: number;
	/** Interval in ms between heartbeat checks. */
	heartbeatIntervalMs?: number;
}

/**
 * Placeholder class — implementation will be added in Task 1.2.
 *
 * The real implementation will use child_process.fork() with IPC channel
 * and implement the full ParentToChildMessage / ChildToParentMessage protocol.
 */
export class RuntimeChildManager {
	private readonly options: RuntimeChildManagerOptions;

	constructor(options: RuntimeChildManagerOptions) {
		this.options = options;
	}

	/**
	 * Start the runtime child process with the given configuration.
	 * Resolves when the child sends a "ready" message with its URL.
	 */
	async start(_config: RuntimeConfig): Promise<string> {
		// TODO (Task 1.2): Fork the child process and wire IPC protocol.
		void this.options;
		throw new Error("RuntimeChildManager.start() is not yet implemented (Task 1.2)");
	}

	/**
	 * Send a shutdown message to the child and wait for graceful exit.
	 * Force-kills after shutdownTimeoutMs if the child does not respond.
	 */
	async shutdown(): Promise<void> {
		// TODO (Task 1.2): Send shutdown message via IPC, await shutdown-complete.
		throw new Error("RuntimeChildManager.shutdown() is not yet implemented (Task 1.2)");
	}

	/**
	 * Send an IPC message to the child process.
	 */
	send(_message: ParentToChildMessage): void {
		// TODO (Task 1.2): Write to child's IPC channel.
		throw new Error("RuntimeChildManager.send() is not yet implemented (Task 1.2)");
	}

	/**
	 * Register a handler for messages received from the child process.
	 */
	onMessage(_handler: (message: ChildToParentMessage) => void): void {
		// TODO (Task 1.2): Wire up child process 'message' event.
		throw new Error("RuntimeChildManager.onMessage() is not yet implemented (Task 1.2)");
	}
}
