import { useEffect, useReducer } from "react";

import type {
	RuntimeClineMcpServerAuthStatus,
	RuntimeProjectSummary,
	RuntimeStateStreamClineSessionContextUpdatedMessage,
	RuntimeStateStreamMcpAuthUpdatedMessage,
	RuntimeStateStreamMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskChatClearedMessage,
	RuntimeStateStreamTaskChatMessage,
	RuntimeStateStreamTaskReadyForReviewMessage,
	RuntimeTaskChatMessage,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceMetadata,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";

const STREAM_RECONNECT_BASE_DELAY_MS = 500;
const STREAM_RECONNECT_MAX_DELAY_MS = 5_000;

function mergeTaskSessionSummaries(
	currentSessions: Record<string, RuntimeTaskSessionSummary>,
	summaries: RuntimeTaskSessionSummary[],
): Record<string, RuntimeTaskSessionSummary> {
	if (summaries.length === 0) {
		return currentSessions;
	}
	const nextSessions = { ...currentSessions };
	for (const summary of summaries) {
		const existing = nextSessions[summary.taskId];
		if (!existing || existing.updatedAt <= summary.updatedAt) {
			nextSessions[summary.taskId] = summary;
		}
	}
	return nextSessions;
}

function getRuntimeStreamUrl(workspaceId: string | null): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/runtime/ws`);
	if (workspaceId) {
		url.searchParams.set("workspaceId", workspaceId);
	}
	return url.toString();
}

export interface UseRuntimeStateStreamResult {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
	workspaceMetadata: RuntimeWorkspaceMetadata | null;
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null;
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	latestMcpAuthStatuses: RuntimeClineMcpServerAuthStatus[] | null;
	clineSessionContextVersion: number;
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
}

interface RuntimeStateStreamStore {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
	workspaceMetadata: RuntimeWorkspaceMetadata | null;
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null;
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>;
	latestTaskReadyForReview: RuntimeStateStreamTaskReadyForReviewMessage | null;
	latestMcpAuthStatuses: RuntimeClineMcpServerAuthStatus[] | null;
	clineSessionContextVersion: number;
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
}

type RuntimeStateStreamAction =
	| { type: "requested_workspace_changed" }
	| { type: "stream_connected" }
	| { type: "snapshot"; payload: RuntimeStateStreamSnapshotMessage }
	| {
			type: "projects_updated";
			payload: RuntimeStateStreamProjectsMessage;
			nextProjectId: string | null;
	  }
	| { type: "task_chat_message"; payload: RuntimeStateStreamTaskChatMessage }
	| { type: "task_chat_cleared"; payload: RuntimeStateStreamTaskChatClearedMessage }
	| { type: "workspace_metadata_updated"; workspaceMetadata: RuntimeWorkspaceMetadata }
	| { type: "task_ready_for_review"; payload: RuntimeStateStreamTaskReadyForReviewMessage }
	| { type: "mcp_auth_updated"; payload: RuntimeStateStreamMcpAuthUpdatedMessage }
	| { type: "cline_session_context_updated"; payload: RuntimeStateStreamClineSessionContextUpdatedMessage }
	| { type: "workspace_state_updated"; workspaceState: RuntimeWorkspaceStateResponse }
	| { type: "task_sessions_updated"; summaries: RuntimeTaskSessionSummary[] }
	| { type: "stream_error"; message: string }
	| { type: "stream_disconnected"; message: string };

function createInitialRuntimeStateStreamStore(requestedWorkspaceId: string | null): RuntimeStateStreamStore {
	return {
		currentProjectId: requestedWorkspaceId,
		projects: [],
		workspaceState: null,
		workspaceMetadata: null,
		latestTaskChatMessage: null,
		taskChatMessagesByTaskId: {},
		latestTaskReadyForReview: null,
		latestMcpAuthStatuses: null,
		clineSessionContextVersion: 0,
		streamError: null,
		isRuntimeDisconnected: false,
		hasReceivedSnapshot: false,
	};
}

function upsertTaskChatMessage(
	currentMessages: RuntimeTaskChatMessage[],
	nextMessage: RuntimeTaskChatMessage,
): RuntimeTaskChatMessage[] {
	const existingIndex = currentMessages.findIndex((message) => message.id === nextMessage.id);
	if (existingIndex < 0) {
		return [...currentMessages, nextMessage];
	}
	const existingMessage = currentMessages[existingIndex];
	if (
		existingMessage &&
		existingMessage.content === nextMessage.content &&
		existingMessage.role === nextMessage.role &&
		existingMessage.createdAt === nextMessage.createdAt &&
		JSON.stringify(existingMessage.meta ?? null) === JSON.stringify(nextMessage.meta ?? null)
	) {
		return currentMessages;
	}
	const nextMessages = [...currentMessages];
	nextMessages[existingIndex] = nextMessage;
	return nextMessages;
}

function resolveProjectIdAfterProjectsUpdate(
	currentProjectId: string | null,
	payload: RuntimeStateStreamProjectsMessage,
): string | null {
	if (currentProjectId && payload.projects.some((project) => project.id === currentProjectId)) {
		return currentProjectId;
	}
	return payload.currentProjectId;
}

function runtimeStateStreamReducer(
	state: RuntimeStateStreamStore,
	action: RuntimeStateStreamAction,
): RuntimeStateStreamStore {
	if (action.type === "requested_workspace_changed") {
		return {
			...state,
			workspaceState: null,
			workspaceMetadata: null,
			latestTaskChatMessage: null,
			taskChatMessagesByTaskId: {},
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: false,
			latestMcpAuthStatuses: state.latestMcpAuthStatuses,
			clineSessionContextVersion: state.clineSessionContextVersion,
		};
	}
	if (action.type === "stream_connected") {
		return {
			...state,
			streamError: null,
			isRuntimeDisconnected: false,
		};
	}
	if (action.type === "snapshot") {
		const nextWorkspaceState = action.payload.workspaceState
			? {
					...action.payload.workspaceState,
					sessions: mergeTaskSessionSummaries(
						state.workspaceState?.sessions ?? {},
						Object.values(action.payload.workspaceState.sessions ?? {}),
					),
				}
			: null;
		return {
			currentProjectId: action.payload.currentProjectId,
			projects: action.payload.projects,
			workspaceState: nextWorkspaceState,
			workspaceMetadata: action.payload.workspaceMetadata,
			latestTaskChatMessage: null,
			taskChatMessagesByTaskId: {},
			latestTaskReadyForReview: state.latestTaskReadyForReview,
			latestMcpAuthStatuses: state.latestMcpAuthStatuses,
			clineSessionContextVersion: action.payload.clineSessionContextVersion,
			streamError: null,
			isRuntimeDisconnected: false,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "projects_updated") {
		const didProjectChange = action.nextProjectId !== state.currentProjectId;
		return {
			...state,
			currentProjectId: action.nextProjectId,
			projects: action.payload.projects,
			workspaceState: didProjectChange ? null : state.workspaceState,
			workspaceMetadata: didProjectChange ? null : state.workspaceMetadata,
			latestTaskChatMessage: didProjectChange ? null : state.latestTaskChatMessage,
			taskChatMessagesByTaskId: didProjectChange ? {} : state.taskChatMessagesByTaskId,
			latestTaskReadyForReview: didProjectChange ? null : state.latestTaskReadyForReview,
			hasReceivedSnapshot: true,
		};
	}
	if (action.type === "task_chat_message") {
		const currentTaskMessages = state.taskChatMessagesByTaskId[action.payload.taskId] ?? [];
		return {
			...state,
			latestTaskChatMessage: action.payload,
			taskChatMessagesByTaskId: {
				...state.taskChatMessagesByTaskId,
				[action.payload.taskId]: upsertTaskChatMessage(currentTaskMessages, action.payload.message),
			},
		};
	}
	if (action.type === "task_chat_cleared") {
		const { [action.payload.taskId]: _cleared, ...remainingByTaskId } = state.taskChatMessagesByTaskId;
		return {
			...state,
			latestTaskChatMessage: null,
			taskChatMessagesByTaskId: remainingByTaskId,
		};
	}
	if (action.type === "workspace_metadata_updated") {
		return {
			...state,
			workspaceMetadata: action.workspaceMetadata,
		};
	}
	if (action.type === "task_ready_for_review") {
		return {
			...state,
			latestTaskReadyForReview: action.payload,
		};
	}
	if (action.type === "mcp_auth_updated") {
		return {
			...state,
			latestMcpAuthStatuses: action.payload.statuses,
		};
	}
	if (action.type === "cline_session_context_updated") {
		return {
			...state,
			clineSessionContextVersion: action.payload.version,
		};
	}
	if (action.type === "workspace_state_updated") {
		const mergedWorkspaceState = {
			...action.workspaceState,
			sessions: mergeTaskSessionSummaries(
				state.workspaceState?.sessions ?? {},
				Object.values(action.workspaceState.sessions ?? {}),
			),
		};
		return {
			...state,
			workspaceState: mergedWorkspaceState,
		};
	}
	if (action.type === "task_sessions_updated") {
		if (!state.workspaceState) {
			return state;
		}
		return {
			...state,
			workspaceState: {
				...state.workspaceState,
				sessions: mergeTaskSessionSummaries(state.workspaceState.sessions, action.summaries),
			},
		};
	}
	if (action.type === "stream_error") {
		return {
			...state,
			streamError: action.message,
			isRuntimeDisconnected: false,
		};
	}
	if (action.type === "stream_disconnected") {
		return {
			...state,
			streamError: action.message,
			isRuntimeDisconnected: true,
		};
	}
	return state;
}

export function useRuntimeStateStream(requestedWorkspaceId: string | null): UseRuntimeStateStreamResult {
	const [state, dispatch] = useReducer(
		runtimeStateStreamReducer,
		requestedWorkspaceId,
		createInitialRuntimeStateStreamStore,
	);
	useEffect(() => {
		let cancelled = false;
		let socket: WebSocket | null = null;
		let reconnectTimer: number | null = null;
		let reconnectAttempt = 0;
		let activeWorkspaceId = requestedWorkspaceId;
		let requestedWorkspaceForConnection = requestedWorkspaceId;

		dispatch({ type: "requested_workspace_changed" });

		const cleanupSocket = () => {
			if (socket) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onerror = null;
				socket.onclose = null;
				socket.close();
				socket = null;
			}
		};

		const scheduleReconnect = () => {
			if (cancelled) {
				return;
			}
			if (reconnectTimer !== null) {
				return;
			}
			const delay = Math.min(STREAM_RECONNECT_MAX_DELAY_MS, STREAM_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt);
			reconnectAttempt += 1;
			reconnectTimer = window.setTimeout(() => {
				connect();
			}, delay);
		};

		const connect = () => {
			if (cancelled) {
				return;
			}
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			cleanupSocket();
			try {
				socket = new WebSocket(getRuntimeStreamUrl(requestedWorkspaceForConnection));
			} catch (error) {
				dispatch({
					type: "stream_disconnected",
					message: error instanceof Error ? error.message : String(error),
				});
				scheduleReconnect();
				return;
			}
			socket.onopen = () => {
				reconnectAttempt = 0;
				dispatch({ type: "stream_connected" });
			};
			socket.onmessage = (event) => {
				try {
					const payload = JSON.parse(String(event.data)) as RuntimeStateStreamMessage;
					if (payload.type === "snapshot") {
						activeWorkspaceId = payload.currentProjectId;
						dispatch({ type: "snapshot", payload });
						return;
					}
					if (payload.type === "projects_updated") {
						const previousWorkspaceId = activeWorkspaceId;
						const nextProjectId = resolveProjectIdAfterProjectsUpdate(activeWorkspaceId, payload);
						activeWorkspaceId = nextProjectId;
						dispatch({
							type: "projects_updated",
							payload,
							nextProjectId,
						});
						if (nextProjectId && nextProjectId !== previousWorkspaceId) {
							requestedWorkspaceForConnection = nextProjectId;
							dispatch({ type: "requested_workspace_changed" });
							connect();
						}
						return;
					}
					if (payload.type === "workspace_state_updated") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						dispatch({
							type: "workspace_state_updated",
							workspaceState: payload.workspaceState,
						});
						return;
					}
					if (payload.type === "workspace_metadata_updated") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						dispatch({
							type: "workspace_metadata_updated",
							workspaceMetadata: payload.workspaceMetadata,
						});
						return;
					}
					if (payload.type === "task_chat_message") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						dispatch({
							type: "task_chat_message",
							payload,
						});
						return;
					}
					if (payload.type === "task_chat_cleared") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						dispatch({
							type: "task_chat_cleared",
							payload,
						});
						return;
					}
					if (payload.type === "task_sessions_updated") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						dispatch({
							type: "task_sessions_updated",
							summaries: payload.summaries,
						});
						return;
					}
					if (payload.type === "task_ready_for_review") {
						if (payload.workspaceId !== activeWorkspaceId) {
							return;
						}
						dispatch({
							type: "task_ready_for_review",
							payload,
						});
						return;
					}
					if (payload.type === "mcp_auth_updated") {
						dispatch({
							type: "mcp_auth_updated",
							payload,
						});
						return;
					}
					if (payload.type === "cline_session_context_updated") {
						dispatch({
							type: "cline_session_context_updated",
							payload,
						});
						return;
					}
					if (payload.type === "error") {
						dispatch({
							type: "stream_error",
							message: payload.message,
						});
					}
				} catch {
					// Ignore malformed stream messages.
				}
			};
			socket.onclose = () => {
				if (cancelled) {
					return;
				}
				dispatch({
					type: "stream_disconnected",
					message: "Runtime stream disconnected.",
				});
				scheduleReconnect();
			};
			socket.onerror = () => {
				if (cancelled) {
					return;
				}
				dispatch({
					type: "stream_disconnected",
					message: "Runtime stream connection failed.",
				});
			};
		};

		connect();

		return () => {
			cancelled = true;
			if (reconnectTimer != null) {
				window.clearTimeout(reconnectTimer);
			}
			cleanupSocket();
		};
	}, [requestedWorkspaceId]);

	return {
		currentProjectId: state.currentProjectId,
		projects: state.projects,
		workspaceState: state.workspaceState,
		workspaceMetadata: state.workspaceMetadata,
		latestTaskChatMessage: state.latestTaskChatMessage,
		taskChatMessagesByTaskId: state.taskChatMessagesByTaskId,
		latestTaskReadyForReview: state.latestTaskReadyForReview,
		latestMcpAuthStatuses: state.latestMcpAuthStatuses,
		clineSessionContextVersion: state.clineSessionContextVersion,
		streamError: state.streamError,
		isRuntimeDisconnected: state.isRuntimeDisconnected,
		hasReceivedSnapshot: state.hasReceivedSnapshot,
	};
}
