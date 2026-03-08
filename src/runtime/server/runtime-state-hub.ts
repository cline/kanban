import type { IncomingMessage } from "node:http";
import { WebSocket, WebSocketServer } from "ws";

import type {
	RuntimeStateStreamErrorMessage,
	RuntimeStateStreamMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskReadyForReviewMessage,
	RuntimeStateStreamTaskSessionsMessage,
	RuntimeStateStreamWorkspaceRetrieveStatusMessage,
	RuntimeStateStreamWorkspaceStateMessage,
	RuntimeTaskSessionSummary,
} from "../api-contract.js";
import type { ResolvedWorkspaceStreamTarget, WorkspaceRegistry } from "./workspace-registry.js";
import type { TerminalSessionManager } from "../terminal/session-manager.js";

const TASK_SESSION_STREAM_BATCH_MS = 150;
const WORKSPACE_FILE_CHANGE_STREAM_BATCH_MS = 25;
const WORKSPACE_FILE_WATCH_INTERVAL_MS = 2_000;

export interface DisposeRuntimeStateWorkspaceOptions {
	disconnectClients?: boolean;
	closeClientErrorMessage?: string;
}

export interface CreateRuntimeStateHubDependencies {
	workspaceRegistry: Pick<
		WorkspaceRegistry,
		"resolveWorkspaceForStream" | "buildProjectsPayload" | "buildWorkspaceStateSnapshot"
	>;
}

export interface RuntimeStateHub {
	trackTerminalManager: (workspaceId: string, manager: TerminalSessionManager) => void;
	handleUpgrade: (request: IncomingMessage, socket: Parameters<WebSocketServer["handleUpgrade"]>[1], head: Buffer, context: {
		requestedWorkspaceId: string | null;
	}) => void;
	disposeWorkspace: (workspaceId: string, options?: DisposeRuntimeStateWorkspaceOptions) => void;
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void>;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void>;
	broadcastTaskReadyForReview: (workspaceId: string, taskId: string) => void;
	close: () => Promise<void>;
}

export function createRuntimeStateHub(deps: CreateRuntimeStateHubDependencies): RuntimeStateHub {
	const terminalSummaryUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const pendingTaskSessionSummariesByWorkspaceId = new Map<string, Map<string, RuntimeTaskSessionSummary>>();
	const taskSessionBroadcastTimersByWorkspaceId = new Map<string, NodeJS.Timeout>();
	const runtimeStateClientsByWorkspaceId = new Map<string, Set<WebSocket>>();
	const runtimeStateClients = new Set<WebSocket>();
	const runtimeStateWorkspaceIdByClient = new Map<WebSocket, string>();
	const runtimeStateWebSocketServer = new WebSocketServer({ noServer: true });
	const workspaceFileChangeBroadcastTimersByWorkspaceId = new Map<string, NodeJS.Timeout>();
	const workspaceFileRefreshIntervalsByWorkspaceId = new Map<string, NodeJS.Timeout>();

	const sendRuntimeStateMessage = (client: WebSocket, payload: RuntimeStateStreamMessage) => {
		if (client.readyState !== WebSocket.OPEN) {
			return;
		}
		try {
			client.send(JSON.stringify(payload));
		} catch {
			// Ignore websocket write errors; close handlers clean up disconnected sockets.
		}
	};

	const flushWorkspaceFileChangeBroadcast = (workspaceId: string) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamWorkspaceRetrieveStatusMessage = {
			type: "workspace_retrieve_status",
			workspaceId,
			retrievedAt: Date.now(),
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const queueWorkspaceFileChangeBroadcast = (workspaceId: string) => {
		if (workspaceFileChangeBroadcastTimersByWorkspaceId.has(workspaceId)) {
			return;
		}
		const timer = setTimeout(() => {
			workspaceFileChangeBroadcastTimersByWorkspaceId.delete(workspaceId);
			flushWorkspaceFileChangeBroadcast(workspaceId);
		}, WORKSPACE_FILE_CHANGE_STREAM_BATCH_MS);
		timer.unref();
		workspaceFileChangeBroadcastTimersByWorkspaceId.set(workspaceId, timer);
	};

	const disposeWorkspaceFileChangeBroadcast = (workspaceId: string) => {
		const timer = workspaceFileChangeBroadcastTimersByWorkspaceId.get(workspaceId);
		if (timer) {
			clearTimeout(timer);
		}
		workspaceFileChangeBroadcastTimersByWorkspaceId.delete(workspaceId);
	};

	const ensureWorkspaceFileRefresh = (workspaceId: string) => {
		if (workspaceFileRefreshIntervalsByWorkspaceId.has(workspaceId)) {
			return;
		}
		queueWorkspaceFileChangeBroadcast(workspaceId);
		const timer = setInterval(() => {
			queueWorkspaceFileChangeBroadcast(workspaceId);
		}, WORKSPACE_FILE_WATCH_INTERVAL_MS);
		timer.unref();
		workspaceFileRefreshIntervalsByWorkspaceId.set(workspaceId, timer);
	};

	const disposeWorkspaceFileRefresh = (workspaceId: string) => {
		const timer = workspaceFileRefreshIntervalsByWorkspaceId.get(workspaceId);
		if (timer) {
			clearInterval(timer);
		}
		workspaceFileRefreshIntervalsByWorkspaceId.delete(workspaceId);
		disposeWorkspaceFileChangeBroadcast(workspaceId);
	};

	const broadcastRuntimeProjectsUpdated = async (preferredCurrentProjectId: string | null): Promise<void> => {
		if (runtimeStateClients.size === 0) {
			return;
		}
		try {
			const payload = await deps.workspaceRegistry.buildProjectsPayload(preferredCurrentProjectId);
			for (const client of runtimeStateClients) {
				sendRuntimeStateMessage(client, {
					type: "projects_updated",
					currentProjectId: payload.currentProjectId,
					projects: payload.projects,
				} satisfies RuntimeStateStreamProjectsMessage);
			}
		} catch {
			// Ignore transient project summary failures; next update will resync.
		}
	};

	const flushTaskSessionSummaries = (workspaceId: string) => {
		const pending = pendingTaskSessionSummariesByWorkspaceId.get(workspaceId);
		if (!pending || pending.size === 0) {
			return;
		}
		pendingTaskSessionSummariesByWorkspaceId.delete(workspaceId);
		const summaries = Array.from(pending.values());
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (runtimeClients && runtimeClients.size > 0) {
			const payload: RuntimeStateStreamTaskSessionsMessage = {
				type: "task_sessions_updated",
				workspaceId,
				summaries,
			};
			for (const client of runtimeClients) {
				sendRuntimeStateMessage(client, payload);
			}
		}
		void broadcastRuntimeProjectsUpdated(workspaceId);
	};

	const queueTaskSessionSummaryBroadcast = (workspaceId: string, summary: RuntimeTaskSessionSummary) => {
		const pending =
			pendingTaskSessionSummariesByWorkspaceId.get(workspaceId) ?? new Map<string, RuntimeTaskSessionSummary>();
		pending.set(summary.taskId, summary);
		pendingTaskSessionSummariesByWorkspaceId.set(workspaceId, pending);
		if (taskSessionBroadcastTimersByWorkspaceId.has(workspaceId)) {
			return;
		}
		const timer = setTimeout(() => {
			taskSessionBroadcastTimersByWorkspaceId.delete(workspaceId);
			flushTaskSessionSummaries(workspaceId);
		}, TASK_SESSION_STREAM_BATCH_MS);
		timer.unref();
		taskSessionBroadcastTimersByWorkspaceId.set(workspaceId, timer);
	};

	const disposeTaskSessionSummaryBroadcast = (workspaceId: string) => {
		const timer = taskSessionBroadcastTimersByWorkspaceId.get(workspaceId);
		if (timer) {
			clearTimeout(timer);
		}
		taskSessionBroadcastTimersByWorkspaceId.delete(workspaceId);
		pendingTaskSessionSummariesByWorkspaceId.delete(workspaceId);
	};

	const cleanupRuntimeStateClient = (client: WebSocket) => {
		const workspaceId = runtimeStateWorkspaceIdByClient.get(client);
		if (workspaceId) {
			const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
			if (clients) {
				clients.delete(client);
				if (clients.size === 0) {
					runtimeStateClientsByWorkspaceId.delete(workspaceId);
					disposeWorkspaceFileRefresh(workspaceId);
				}
			}
		}
		runtimeStateWorkspaceIdByClient.delete(client);
		runtimeStateClients.delete(client);
	};

	const disposeWorkspace = (workspaceId: string, options?: DisposeRuntimeStateWorkspaceOptions) => {
		const unsubscribeSummary = terminalSummaryUnsubscribeByWorkspaceId.get(workspaceId);
		if (unsubscribeSummary) {
			try {
				unsubscribeSummary();
			} catch {
				// Ignore listener cleanup errors during project removal.
			}
		}
		terminalSummaryUnsubscribeByWorkspaceId.delete(workspaceId);
		disposeTaskSessionSummaryBroadcast(workspaceId);
		disposeWorkspaceFileRefresh(workspaceId);

		if (!options?.disconnectClients) {
			return;
		}

		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			runtimeStateClientsByWorkspaceId.delete(workspaceId);
			return;
		}

		for (const runtimeClient of runtimeClients) {
			if (options.closeClientErrorMessage) {
				sendRuntimeStateMessage(runtimeClient, {
					type: "error",
					message: options.closeClientErrorMessage,
				} satisfies RuntimeStateStreamErrorMessage);
			}
			try {
				runtimeClient.close();
			} catch {
				// Ignore close failures while disposing removed workspace clients.
			}
			cleanupRuntimeStateClient(runtimeClient);
		}
		runtimeStateClientsByWorkspaceId.delete(workspaceId);
	};

	const broadcastRuntimeWorkspaceStateUpdated = async (workspaceId: string, workspacePath: string): Promise<void> => {
		const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!clients || clients.size === 0) {
			return;
		}
		try {
			const workspaceState = await deps.workspaceRegistry.buildWorkspaceStateSnapshot(workspaceId, workspacePath);
			const payload: RuntimeStateStreamWorkspaceStateMessage = {
				type: "workspace_state_updated",
				workspaceId,
				workspaceState,
			};
			for (const client of clients) {
				sendRuntimeStateMessage(client, payload);
			}
		} catch {
			// Ignore transient state read failures; next update will resync.
		}
	};

	const broadcastTaskReadyForReview = (workspaceId: string, taskId: string) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamTaskReadyForReviewMessage = {
			type: "task_ready_for_review",
			workspaceId,
			taskId,
			triggeredAt: Date.now(),
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	runtimeStateWebSocketServer.on("connection", async (client: WebSocket, context: unknown) => {
		client.on("close", () => {
			cleanupRuntimeStateClient(client);
		});
		try {
			const requestedWorkspaceId =
				typeof context === "object" &&
				context !== null &&
				"requestedWorkspaceId" in context &&
				typeof (context as { requestedWorkspaceId?: unknown }).requestedWorkspaceId === "string"
					? (context as { requestedWorkspaceId: string }).requestedWorkspaceId || null
					: null;
			const workspace: ResolvedWorkspaceStreamTarget = await deps.workspaceRegistry.resolveWorkspaceForStream(
				requestedWorkspaceId,
				{
					onRemovedWorkspace: ({ workspaceId, message }) => {
						disposeWorkspace(workspaceId, {
							disconnectClients: true,
							closeClientErrorMessage: message,
						});
					},
				},
			);
			if (client.readyState !== WebSocket.OPEN) {
				cleanupRuntimeStateClient(client);
				return;
			}

			runtimeStateClients.add(client);
			if (workspace.workspaceId) {
				const workspaceClients = runtimeStateClientsByWorkspaceId.get(workspace.workspaceId) ?? new Set<WebSocket>();
				workspaceClients.add(client);
				runtimeStateClientsByWorkspaceId.set(workspace.workspaceId, workspaceClients);
				runtimeStateWorkspaceIdByClient.set(client, workspace.workspaceId);
			}

			try {
				let projectsPayload: { currentProjectId: string | null; projects: RuntimeStateStreamProjectsMessage["projects"] };
				let workspaceState: RuntimeStateStreamSnapshotMessage["workspaceState"];
				if (workspace.workspaceId && workspace.workspacePath) {
					[projectsPayload, workspaceState] = await Promise.all([
						deps.workspaceRegistry.buildProjectsPayload(workspace.workspaceId),
						deps.workspaceRegistry.buildWorkspaceStateSnapshot(workspace.workspaceId, workspace.workspacePath),
					]);
				} else {
					projectsPayload = await deps.workspaceRegistry.buildProjectsPayload(null);
					workspaceState = null;
				}
				sendRuntimeStateMessage(client, {
					type: "snapshot",
					currentProjectId: projectsPayload.currentProjectId,
					projects: projectsPayload.projects,
					workspaceState,
				} satisfies RuntimeStateStreamSnapshotMessage);
				if (workspace.removedRequestedWorkspacePath) {
					sendRuntimeStateMessage(client, {
						type: "error",
						message: `Project no longer exists on disk and was removed: ${workspace.removedRequestedWorkspacePath}`,
					} satisfies RuntimeStateStreamErrorMessage);
				}
				if (workspace.didPruneProjects) {
					void broadcastRuntimeProjectsUpdated(workspace.workspaceId);
				}
				if (workspace.workspaceId) {
					ensureWorkspaceFileRefresh(workspace.workspaceId);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendRuntimeStateMessage(client, {
					type: "error",
					message,
				} satisfies RuntimeStateStreamErrorMessage);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sendRuntimeStateMessage(client, {
				type: "error",
				message,
			} satisfies RuntimeStateStreamErrorMessage);
			client.close();
		}
	});

	return {
		trackTerminalManager: (workspaceId: string, manager: TerminalSessionManager) => {
			if (terminalSummaryUnsubscribeByWorkspaceId.has(workspaceId)) {
				return;
			}
			const unsubscribe = manager.onSummary((summary) => {
				queueTaskSessionSummaryBroadcast(workspaceId, summary);
			});
			terminalSummaryUnsubscribeByWorkspaceId.set(workspaceId, unsubscribe);
		},
		handleUpgrade: (request, socket, head, context) => {
			runtimeStateWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
				runtimeStateWebSocketServer.emit("connection", ws, context);
			});
		},
		disposeWorkspace,
		broadcastRuntimeWorkspaceStateUpdated,
		broadcastRuntimeProjectsUpdated,
		broadcastTaskReadyForReview,
		close: async () => {
			for (const timer of taskSessionBroadcastTimersByWorkspaceId.values()) {
				clearTimeout(timer);
			}
			taskSessionBroadcastTimersByWorkspaceId.clear();
			pendingTaskSessionSummariesByWorkspaceId.clear();
			for (const timer of workspaceFileRefreshIntervalsByWorkspaceId.values()) {
				clearInterval(timer);
			}
			workspaceFileRefreshIntervalsByWorkspaceId.clear();
			for (const timer of workspaceFileChangeBroadcastTimersByWorkspaceId.values()) {
				clearTimeout(timer);
			}
			workspaceFileChangeBroadcastTimersByWorkspaceId.clear();
			for (const unsubscribe of terminalSummaryUnsubscribeByWorkspaceId.values()) {
				try {
					unsubscribe();
				} catch {
					// Ignore listener cleanup errors during shutdown.
				}
			}
			terminalSummaryUnsubscribeByWorkspaceId.clear();
			for (const client of runtimeStateClients) {
				try {
					client.terminate();
				} catch {
					// Ignore websocket termination errors during shutdown.
				}
			}
			runtimeStateClients.clear();
			runtimeStateClientsByWorkspaceId.clear();
			runtimeStateWorkspaceIdByClient.clear();
			await new Promise<void>((resolveCloseWebSockets) => {
				runtimeStateWebSocketServer.close(() => {
					resolveCloseWebSockets();
				});
			});
		},
	};
}
