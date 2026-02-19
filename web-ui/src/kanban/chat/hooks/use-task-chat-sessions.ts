import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AcpClient } from "@/kanban/acp/types";
import type {
	ChatSessionState,
	ChatSessionStatus,
	ChatSlashCommand,
	ChatTimelineEntry,
} from "@/kanban/chat/types";
import type { BoardCard } from "@/kanban/types";

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

function normalizeSessionStatus(status: unknown): ChatSessionStatus {
	if (status === "thinking" || status === "tool_running" || status === "cancelled" || status === "idle") {
		return status;
	}
	return "idle";
}

function normalizeAvailableCommands(commands: unknown): ChatSlashCommand[] {
	if (!Array.isArray(commands)) {
		return defaultCommands;
	}
	const normalized: ChatSlashCommand[] = [];
	for (const command of commands) {
		if (!command || typeof command !== "object") {
			continue;
		}
		const candidate = command as { name?: unknown; description?: unknown; input?: unknown };
		if (typeof candidate.name !== "string" || typeof candidate.description !== "string") {
			continue;
		}
		let input: ChatSlashCommand["input"];
		if (candidate.input && typeof candidate.input === "object") {
			const hint = (candidate.input as { hint?: unknown }).hint;
			if (typeof hint === "string") {
				input = { hint };
			}
		}
		normalized.push({
			name: candidate.name,
			description: candidate.description,
			input,
		});
	}
	return normalized.length > 0 ? normalized : defaultCommands;
}

function normalizeSessions(raw: unknown): Record<string, ChatSessionState> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return {};
	}
	const sessions: Record<string, ChatSessionState> = {};
	for (const [taskId, value] of Object.entries(raw as Record<string, unknown>)) {
		if (!value || typeof value !== "object") {
			continue;
		}
		const source = value as {
			sessionId?: unknown;
			status?: unknown;
			timeline?: unknown;
			availableCommands?: unknown;
		};
		sessions[taskId] = {
			sessionId:
				typeof source.sessionId === "string" && source.sessionId
					? source.sessionId
					: `task-${taskId}`,
			status: normalizeSessionStatus(source.status),
			timeline: Array.isArray(source.timeline) ? (source.timeline as ChatTimelineEntry[]) : [],
			availableCommands: normalizeAvailableCommands(source.availableCommands),
		};
	}
	return sessions;
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
	sessions: Record<string, ChatSessionState>;
	getSession: (taskId: string) => ChatSessionState;
	ensureSession: (taskId: string) => void;
	startTaskRun: (task: BoardCard, prompt?: string) => void;
	sendPrompt: (task: BoardCard, text: string) => void;
	cancelPrompt: (taskId: string) => void;
	respondToPermission: (taskId: string, messageId: string, optionId: string) => void;
	hydrateSessions: (nextSessions: unknown) => void;
}

export function useTaskChatSessions({
	acpClient,
	onTaskRunComplete,
}: {
	acpClient: AcpClient;
	onTaskRunComplete: (taskId: string) => void;
}): UseTaskChatSessionsResult {
	const [sessions, setSessions] = useState<Record<string, ChatSessionState>>({});
	const activeCancelsRef = useRef<Record<string, () => void>>({});

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
					baseRef: task.baseRef ?? null,
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
		(task: BoardCard, prompt?: string) => {
			const kickoffPrompt = prompt?.trim() || task.description || task.title;
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

	const hydrateSessions = useCallback((nextSessions: unknown) => {
		setSessions(normalizeSessions(nextSessions));
	}, []);

	const getSession = useMemo(() => {
		return (taskId: string): ChatSessionState => sessions[taskId] ?? createEmptySession(taskId);
	}, [sessions]);

	return {
		sessions,
		getSession,
		ensureSession,
		startTaskRun,
		sendPrompt,
		cancelPrompt,
		respondToPermission,
		hydrateSessions,
	};
}
