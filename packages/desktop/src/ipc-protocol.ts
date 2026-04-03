/**
 * IPC message protocol for communication between the Electron main process
 * (parent) and the runtime child process.
 *
 * Uses discriminated unions on the `type` field so message handlers can
 * narrow the payload with a simple switch/case.
 */

// ---------------------------------------------------------------------------
// Runtime configuration sent to the child process on startup
// ---------------------------------------------------------------------------

export interface RuntimeConfig {
	/** Host for the runtime HTTP server to bind to. */
	host: string;
	/** Port for the runtime HTTP server, or "auto" to find an available port. */
	port: number | "auto";
	/** Ephemeral auth token the runtime should require on all API requests. */
	authToken: string;
	/**
	 * Absolute path to the bundled Kanban CLI shim (e.g. `Resources/bin/kanban`).
	 *
	 * The runtime child sets `KANBAN_CLI_COMMAND` from this value so that the
	 * home-agent system prompt references the bundled shim instead of relying
	 * on a global install or inferring from `process.execPath`.
	 */
	kanbanCliCommand?: string;
}

// ---------------------------------------------------------------------------
// Parent → Child messages
// ---------------------------------------------------------------------------

export interface StartMessage {
	type: "start";
	config: RuntimeConfig;
}

export interface ShutdownMessage {
	type: "shutdown";
}

export interface HeartbeatAckMessage {
	type: "heartbeat-ack";
}

export type ParentToChildMessage = StartMessage | ShutdownMessage | HeartbeatAckMessage;

// ---------------------------------------------------------------------------
// Child → Parent messages
// ---------------------------------------------------------------------------

export interface ReadyMessage {
	type: "ready";
	/** The URL the runtime HTTP server is listening on (e.g. "http://localhost:52341"). */
	url: string;
}

export interface ErrorMessage {
	type: "error";
	/** Human-readable description of what went wrong. */
	message: string;
}

export interface ShutdownCompleteMessage {
	type: "shutdown-complete";
}

export interface HeartbeatMessage {
	type: "heartbeat";
}

export type ChildToParentMessage = ReadyMessage | ErrorMessage | ShutdownCompleteMessage | HeartbeatMessage;
