/**
 * Runtime child process entry point.
 *
 * This file is spawned by RuntimeChildManager via child_process.fork().
 * It listens for IPC messages from the Electron main process, starts the
 * Kanban runtime, and sends lifecycle messages back.
 */

import type { ChildToParentMessage, ParentToChildMessage } from "./ipc-protocol.js";

function send(message: ChildToParentMessage): void {
	process.send?.(message);
}

// Heartbeat — sends a heartbeat every 5 seconds so the parent knows
// the child is alive. If the parent doesn't respond with heartbeat-ack
// within 15 seconds (3 missed beats), the parent force-kills us.
const HEARTBEAT_INTERVAL_MS = 5_000;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

function startHeartbeat(): void {
	heartbeatTimer = setInterval(() => {
		send({ type: "heartbeat" });
	}, HEARTBEAT_INTERVAL_MS);
	// Allow the process to exit even if the timer is still running.
	if (heartbeatTimer.unref) {
		heartbeatTimer.unref();
	}
}

function stopHeartbeat(): void {
	if (heartbeatTimer !== null) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
}

// Listen for messages from the Electron main process.
process.on("message", async (raw: unknown) => {
	const msg = raw as ParentToChildMessage;

	switch (msg.type) {
		case "start": {
			try {
				// Dynamic import so the module isn't loaded until the start
				// message arrives — keeps the child process lean on startup.
				const { startRuntime } = await import("kanban/runtime-start");

				const handle = await startRuntime({
					host: msg.config.host,
					port: msg.config.port,
					authToken: msg.config.authToken,
					warn: (message: string) => {
						// Forward warnings to the parent as error messages.
						send({ type: "error", message });
					},
				});

				send({ type: "ready", url: handle.url });
				startHeartbeat();

				// Store the handle for shutdown.
				(globalThis as Record<string, unknown>).__kanbanRuntimeHandle = handle;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				send({ type: "error", message: `Failed to start runtime: ${message}` });
				process.exit(1);
			}
			break;
		}

		case "shutdown": {
			stopHeartbeat();
			try {
				const handle = (globalThis as Record<string, unknown>).__kanbanRuntimeHandle as
					| { shutdown: () => Promise<void> }
					| undefined;
				if (handle) {
					await handle.shutdown();
				}
			} catch {
				// Best effort — we're shutting down anyway.
			}
			send({ type: "shutdown-complete" });
			process.exit(0);
			break;
		}

		case "heartbeat-ack": {
			// The parent acknowledged our heartbeat — nothing to do.
			break;
		}
	}
});

// If the IPC channel is disconnected (parent died), exit gracefully.
process.on("disconnect", () => {
	stopHeartbeat();
	process.exit(0);
});
