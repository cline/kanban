import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AcpClient } from "@/kanban/acp/types";
import type {
	ChatSessionState,
	ChatSessionStatus,
	ChatSlashCommand,
	ChatTimelineEntry,
} from "@/kanban/chat/types";
import type { BoardCard } from "@/kanban/types";

const SESSION_STORAGE_KEY = "kanbanana.task-sessions.v1";
const SESSION_PERSIST_DEBOUNCE_MS = 250;

const defaultCommands: ChatSlashCommand[] = [
	{ name: "plan", description: "Create or update a plan for this task", input: { hint: "what to plan" } },
	{ name: "review", description: "Review changes and risks for this task" },
	{ name: "test", description: "Run project tests for this task" },
	{ name: "search", description: "Search codebase for relevant files", input: { hint: "query" } },
];

function createEmptySession(taskId: string): ChatSessionState {
	return {
		sessionId: `task-${taskId}`,
		status: "idle",
		timeline: [],
		availableCommands: defaultCommands,
	};
}

function loadSessions(): Record<string, ChatSessionState> {
	if (typeof window === "undefined") {
		return {};
	}

	const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
	if (!raw) {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as Record<string, ChatSessionState>;
		if (!parsed || typeof parsed !== "object") {
			return {};
		}
		return parsed;
	} catch {
		return {};
	}
}

function upsertTimelineEntry(timeline: ChatTimelineEntry[], nextEntry: ChatTimelineEntry): ChatTimelineEntry[] {
	const existingIndex = timeline.findIndex((entry) => entry.id === nextEntry.id);
	if (existingIndex === -1) {
		return [...timeline, nextEntry];
	}
	const updated = Array.from(timeline);
	updated[existingIndex] = nextEntry;
	return updated;
}

function isBusy(status: ChatSessionStatus): boolean {
	return status !== "idle" && status !== "cancelled";
}

function createOptimisticUserEntry(text: string): ChatTimelineEntry {
	return {
		type: "user_message",
		id: `local-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		timestamp: Date.now(),
		text,
	};
}

export interface UseTaskChatSessionsResult {
	getSession: (taskId: string) => ChatSessionState;
	ensureSession: (taskId: string) => void;
	startTaskRun: (task: BoardCard) => void;
	sendPrompt: (task: BoardCard, text: string) => void;
	cancelPrompt: (taskId: string) => void;
	respondToPermission: (taskId: string, messageId: string, optionId: string) => void;
}

export function useTaskChatSessions({
	acpClient,
	onTaskRunComplete,
}: {
	acpClient: AcpClient;
	onTaskRunComplete: (taskId: string) => void;
}): UseTaskChatSessionsResult {
	const [sessions, setSessions] = useState<Record<string, ChatSessionState>>(() => loadSessions());
	const activeCancelsRef = useRef<Record<string, () => void>>({});

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
		}, SESSION_PERSIST_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [sessions]);

	useEffect(() => {
		return () => {
			for (const cancel of Object.values(activeCancelsRef.current)) {
				cancel();
			}
		};
	}, []);

	const updateSession = useCallback(
		(taskId: string, updater: (session: ChatSessionState) => ChatSessionState) => {
			setSessions((prev) => {
				const current = prev[taskId] ?? createEmptySession(taskId);
				return {
					...prev,
					[taskId]: updater(current),
				};
			});
		},
		[],
	);

	const ensureSession = useCallback((taskId: string) => {
		setSessions((prev) => {
			if (prev[taskId]) {
				return prev;
			}
			return {
				...prev,
				[taskId]: createEmptySession(taskId),
			};
		});
	}, []);

	const runTurn = useCallback(
		(task: BoardCard, prompt: string) => {
			const activeSession = sessions[task.id] ?? createEmptySession(task.id);
			if (isBusy(activeSession.status)) {
				return;
			}

			activeCancelsRef.current[task.id]?.();

			updateSession(task.id, (session) => {
				return {
					...session,
					status: "thinking",
					timeline: [...session.timeline, createOptimisticUserEntry(prompt)],
				};
			});

			const controller = acpClient.runTurn(
				{
					taskId: task.id,
					taskTitle: task.title,
					taskDescription: task.description,
					prompt,
				},
				{
					onStatus: (status) => {
						updateSession(task.id, (session) => ({ ...session, status }));
					},
					onEntry: (entry) => {
						if (entry.type === "user_message") {
							return;
						}
						updateSession(task.id, (session) => ({
							...session,
							timeline: upsertTimelineEntry(session.timeline, entry),
						}));
					},
					onAvailableCommands: (commands) => {
						updateSession(task.id, (session) => ({
							...session,
							availableCommands: commands.map((command) => ({
								name: command.name,
								description: command.description,
								input: command.input?.hint ? { hint: command.input.hint } : undefined,
							})),
						}));
					},
					onComplete: () => {
						updateSession(task.id, (session) => ({ ...session, status: "idle" }));
						onTaskRunComplete(task.id);
					},
					onError: () => {
						updateSession(task.id, (session) => ({
							...session,
							status: "idle",
						}));
					},
				},
			);

			activeCancelsRef.current[task.id] = controller.cancel;

			controller.done.finally(() => {
				if (activeCancelsRef.current[task.id] === controller.cancel) {
					delete activeCancelsRef.current[task.id];
				}
			});
		},
		[acpClient, onTaskRunComplete, sessions, updateSession],
	);

	const startTaskRun = useCallback(
		(task: BoardCard) => {
			const kickoffPrompt = task.description || task.title;
			runTurn(task, kickoffPrompt);
		},
		[runTurn],
	);

	const sendPrompt = useCallback(
		(task: BoardCard, text: string) => {
			runTurn(task, text);
		},
		[runTurn],
	);

	const cancelPrompt = useCallback(
		(taskId: string) => {
			activeCancelsRef.current[taskId]?.();
			delete activeCancelsRef.current[taskId];
			updateSession(taskId, (session) => ({ ...session, status: "cancelled" }));
			setTimeout(() => {
				updateSession(taskId, (session) => ({
					...session,
					status: session.status === "cancelled" ? "idle" : session.status,
				}));
			}, 1200);
		},
		[updateSession],
	);

	const respondToPermission = useCallback(
		(taskId: string, messageId: string, optionId: string) => {
			updateSession(taskId, (session) => ({
				...session,
				timeline: session.timeline.map((entry) => {
					if (entry.type === "permission_request" && entry.id === messageId) {
						return {
							...entry,
							resolved: true,
							selectedOptionId: optionId,
						};
					}
					return entry;
				}),
			}));
		},
		[updateSession],
	);

	const getSession = useMemo(() => {
		return (taskId: string): ChatSessionState => sessions[taskId] ?? createEmptySession(taskId);
	}, [sessions]);

	return {
		getSession,
		ensureSession,
		startTaskRun,
		sendPrompt,
		cancelPrompt,
		respondToPermission,
	};
}
