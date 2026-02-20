import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { RuntimeStatusBanners } from "@/kanban/components/runtime-status-banners";
import { RuntimeSettingsDialog } from "@/kanban/components/runtime-settings-dialog";
import { TaskInlineCreateCard, type TaskWorkspaceMode } from "@/kanban/components/task-inline-create-card";
import { TaskTrashWarningDialog } from "@/kanban/components/task-trash-warning-dialog";
import { TopBar } from "@/kanban/components/top-bar";
import { createInitialBoardData } from "@/kanban/data/board-data";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import { useRuntimeTaskSessions } from "@/kanban/runtime/use-runtime-task-sessions";
import {
	DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS,
	splitPromptToTitleDescription,
} from "@/kanban/utils/task-prompt";
import type {
	RuntimeGitRepositoryInfo,
	RuntimeShortcutRunResponse,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "@/kanban/runtime/types";
import {
	addTaskToColumn,
	applyDragResult,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
	normalizeBoardData,
} from "@/kanban/state/board-state";
import type { BoardCard, BoardColumnId, BoardData } from "@/kanban/types";

const WORKSPACE_STATE_PERSIST_DEBOUNCE_MS = 300;
const TASK_WORKSPACE_MODE_STORAGE_KEY = "kanbanana.task-workspace-mode";
const TASK_START_IN_PLAN_MODE_STORAGE_KEY = "kanbanana.task-start-in-plan-mode";

interface PendingTrashWarningState {
	taskId: string;
	fileCount: number;
	taskTitle: string;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

function loadPersistedTaskWorkspaceMode(): TaskWorkspaceMode {
	if (typeof window === "undefined") {
		return "worktree";
	}
	try {
		const value = window.localStorage.getItem(TASK_WORKSPACE_MODE_STORAGE_KEY);
		if (value === "local" || value === "worktree") {
			return value;
		}
	} catch {
		// Ignore storage access failures and use defaults.
	}
	return "worktree";
}

function loadPersistedTaskStartInPlanMode(): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	try {
		const value = window.localStorage.getItem(TASK_START_IN_PLAN_MODE_STORAGE_KEY);
		return value === "true";
	} catch {
		// Ignore storage access failures and use defaults.
	}
	return false;
}

function createIdleTaskSession(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		lastActivityLine: null,
		reviewReason: null,
		exitCode: null,
	};
}

function mergeTaskSessions(
	current: Record<string, RuntimeTaskSessionSummary>,
	nextFromRuntime: Record<string, RuntimeTaskSessionSummary>,
): Record<string, RuntimeTaskSessionSummary> {
	let changed = false;
	const next = { ...current };
	for (const [taskId, summary] of Object.entries(nextFromRuntime)) {
		const existing = next[taskId];
		if (!existing || existing.updatedAt <= summary.updatedAt) {
			next[taskId] = summary;
			if (!existing || existing.updatedAt !== summary.updatedAt || existing.state !== summary.state) {
				changed = true;
			}
		}
	}
	return changed ? next : current;
}

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspaceGit, setWorkspaceGit] = useState<RuntimeGitRepositoryInfo | null>(null);
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] =
		useState<RuntimeTaskWorkspaceInfoResponse | null>(null);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => {
		if (typeof document === "undefined") {
			return true;
		}
		return document.visibilityState === "visible";
	});
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskPrompt, setNewTaskPrompt] = useState("");
	const [newTaskStartInPlanMode, setNewTaskStartInPlanMode] = useState<boolean>(() =>
		loadPersistedTaskStartInPlanMode(),
	);
	const [newTaskWorkspaceMode, setNewTaskWorkspaceMode] = useState<TaskWorkspaceMode>(() =>
		loadPersistedTaskWorkspaceMode(),
	);
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [pendingTrashWarning, setPendingTrashWarning] = useState<PendingTrashWarningState | null>(null);
	const [runningShortcutId, setRunningShortcutId] = useState<string | null>(null);
	const [lastShortcutOutput, setLastShortcutOutput] = useState<{
		label: string;
		result: RuntimeShortcutRunResponse;
	} | null>(null);
	const { config: runtimeProjectConfig, refresh: refreshRuntimeProjectConfig } = useRuntimeProjectConfig();
	const { sessions: runtimeTaskSessions, refresh: refreshRuntimeTaskSessions } = useRuntimeTaskSessions();

	const upsertSession = useCallback((summary: RuntimeTaskSessionSummary) => {
		setSessions((current) => ({
			...current,
			[summary.taskId]: summary,
		}));
	}, []);

	const ensureTaskWorkspace = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		try {
			const response = await fetch("/api/workspace/worktree/ensure", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: task.id,
					baseRef: task.baseRef ?? null,
				}),
			});
			const payload = (await response.json().catch(() => null)) as
				| RuntimeWorktreeEnsureResponse
				| { error?: string }
				| null;
			if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
				return {
					ok: false,
					message:
						(payload && "error" in payload && typeof payload.error === "string" && payload.error) ||
						`Worktree setup failed with ${response.status}.`,
				};
			}
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, []);

	const startTaskSession = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		try {
			const kickoffPrompt = task.prompt.trim() || task.description.trim() || task.title;
			const response = await fetch("/api/runtime/task-session/start", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: task.id,
					prompt: kickoffPrompt,
					startInPlanMode: task.startInPlanMode,
					baseRef: task.baseRef ?? null,
				}),
			});
			const payload = (await response.json().catch(() => null)) as
				| { ok?: boolean; error?: string; summary?: RuntimeTaskSessionSummary | null }
				| null;
			if (!response.ok || !payload || !payload.ok || !payload.summary) {
				return {
					ok: false,
					message: payload?.error ?? `Task session start failed with ${response.status}.`,
				};
			}
			upsertSession(payload.summary);
			void refreshRuntimeTaskSessions();
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, [refreshRuntimeTaskSessions, upsertSession]);

	const stopTaskSession = useCallback(async (taskId: string): Promise<void> => {
		try {
			await fetch("/api/runtime/task-session/stop", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
			});
		} catch {
			// Ignore stop errors during cleanup.
		}
	}, []);

	const cleanupTaskWorkspace = useCallback(async (taskId: string): Promise<RuntimeWorktreeDeleteResponse | null> => {
		try {
			const response = await fetch("/api/workspace/worktree/delete", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
			});
			const payload = (await response.json().catch(() => null)) as
				| RuntimeWorktreeDeleteResponse
				| { error?: string }
				| null;
			if (!response.ok || !payload || !("ok" in payload) || !payload.ok) {
				const message =
					(payload && "error" in payload && typeof payload.error === "string" && payload.error) ||
					`Could not clean up task workspace (${response.status}).`;
				setWorktreeError(message);
				return null;
			}
			setWorktreeError(null);
			return payload;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
			return null;
		}
	}, []);

	const fetchTaskWorkspaceInfo = useCallback(
		async (task: BoardCard): Promise<RuntimeTaskWorkspaceInfoResponse | null> => {
			try {
				const params = new URLSearchParams({
					taskId: task.id,
				});
				params.set("baseRef", task.baseRef ?? "");
				const response = await fetch(`/api/workspace/task-context?${params.toString()}`);
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(payload?.error ?? `Task workspace request failed with ${response.status}`);
				}
				return (await response.json()) as RuntimeTaskWorkspaceInfoResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
				return null;
			}
		},
		[],
	);

	const fetchTaskWorkingChangeCount = useCallback(async (task: BoardCard): Promise<number | null> => {
		try {
			const params = new URLSearchParams({
				taskId: task.id,
			});
			params.set("baseRef", task.baseRef ?? "");
			const response = await fetch(`/api/workspace/changes?${params.toString()}`);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(payload?.error ?? `Workspace request failed with ${response.status}`);
			}
			const payload = (await response.json()) as { files?: unknown[] };
			return Array.isArray(payload.files) ? payload.files.length : 0;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
			return null;
		}
	}, []);

	const selectedCard = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);

	const searchableTasks = useMemo(() => {
		return board.columns.flatMap((column) =>
			column.cards.map((card) => ({
				id: card.id,
				title: card.title,
				columnTitle: column.title,
			})),
		);
	}, [board.columns]);

	useEffect(() => {
		setSessions((current) => mergeTaskSessions(current, runtimeTaskSessions));
	}, [runtimeTaskSessions]);

	useEffect(() => {
		setBoard((currentBoard) => {
			let nextBoard = currentBoard;
			for (const summary of Object.values(runtimeTaskSessions)) {
				const columnId = getTaskColumnId(nextBoard, summary.taskId);
				if (summary.state === "awaiting_review" && columnId === "in_progress") {
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "review");
					if (moved.moved) {
						nextBoard = moved.board;
					}
					continue;
				}
				if (summary.state === "interrupted" && columnId && columnId !== "trash") {
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "trash");
					if (moved.moved) {
						nextBoard = moved.board;
					}
				}
			}
			return nextBoard;
		});
	}, [runtimeTaskSessions]);

	useEffect(() => {
		let cancelled = false;
		const loadSelectedTaskWorkspaceInfo = async () => {
			if (!selectedCard) {
				setSelectedTaskWorkspaceInfo(null);
				return;
			}
			const info = await fetchTaskWorkspaceInfo(selectedCard.card);
			if (!cancelled) {
				setSelectedTaskWorkspaceInfo(info);
			}
		};
		void loadSelectedTaskWorkspaceInfo();
		return () => {
			cancelled = true;
		};
	}, [fetchTaskWorkspaceInfo, selectedCard?.card.baseRef, selectedCard?.card.id]);

	const createTaskBranchOptions = useMemo(() => {
		if (!workspaceGit?.hasGit) {
			return [] as Array<{ value: string; label: string }>;
		}

		const options: Array<{ value: string; label: string }> = [];
		const seen = new Set<string>();
		const append = (value: string | null, labelSuffix?: string) => {
			if (!value || seen.has(value)) {
				return;
			}
			seen.add(value);
			options.push({
				value,
				label: labelSuffix ? `${value} ${labelSuffix}` : value,
			});
		};

		append(workspaceGit.currentBranch, "(current)");
		const mainCandidate = workspaceGit.branches.includes("main") ? "main" : workspaceGit.defaultBranch;
		append(mainCandidate, mainCandidate && mainCandidate !== workspaceGit.currentBranch ? "(default)" : undefined);
		for (const branch of workspaceGit.branches) {
			append(branch);
		}
		append(workspaceGit.defaultBranch, workspaceGit.defaultBranch ? "(default)" : undefined);

		return options;
	}, [workspaceGit]);

	const canUseWorktree = createTaskBranchOptions.length > 0;
	const defaultTaskBranchRef = useMemo(() => {
		if (!workspaceGit?.hasGit) {
			return "";
		}
		return workspaceGit.currentBranch ?? workspaceGit.defaultBranch ?? createTaskBranchOptions[0]?.value ?? "";
	}, [createTaskBranchOptions, workspaceGit]);

	const loadWorkspaceStateFromRuntime = useCallback(
		async (options?: { preserveLocalStateOnFailure?: boolean }) => {
			setIsWorkspaceStateRefreshing(true);
			try {
				const response = await fetch("/api/workspace/state");
				if (!response.ok) {
					throw new Error(`Workspace state request failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeWorkspaceStateResponse;
				const normalized = normalizeBoardData(payload.board) ?? createInitialBoardData();
				setWorkspacePath(payload.repoPath);
				setWorkspaceGit(payload.git);
				setBoard(normalized);
				setSessions(payload.sessions ?? {});
				setWorktreeError(null);
				setCanPersistWorkspaceState(true);
			} catch (error) {
				if (!options?.preserveLocalStateOnFailure) {
					setWorkspacePath(null);
					setWorkspaceGit(null);
					setBoard(createInitialBoardData());
					setSessions({});
				}
				setCanPersistWorkspaceState(false);
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
			} finally {
				setIsWorkspaceStateRefreshing(false);
			}
		},
		[],
	);

	useEffect(() => {
		let cancelled = false;
		void loadWorkspaceStateFromRuntime().then(() => {
			if (cancelled) {
				return;
			}
		});
		return () => {
			cancelled = true;
		};
	}, [loadWorkspaceStateFromRuntime]);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		const handleVisibilityChange = () => {
			const visible = document.visibilityState === "visible";
			setIsDocumentVisible(visible);
			if (visible) {
				void loadWorkspaceStateFromRuntime({ preserveLocalStateOnFailure: true });
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [loadWorkspaceStateFromRuntime]);

	useEffect(() => {
		if (!canPersistWorkspaceState || !isDocumentVisible || isWorkspaceStateRefreshing) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			const payload: RuntimeWorkspaceStateSaveRequest = {
				board,
				sessions,
			};
			void fetch("/api/workspace/state", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			})
				.then(() => {})
				.catch(() => {
					// Keep the UI usable even if persistence is temporarily unavailable.
				});
		}, WORKSPACE_STATE_PERSIST_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [
		board,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		sessions,
	]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.setItem(TASK_WORKSPACE_MODE_STORAGE_KEY, newTaskWorkspaceMode);
		} catch {
			// Ignore storage access failures.
		}
	}, [newTaskWorkspaceMode]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.setItem(TASK_START_IN_PLAN_MODE_STORAGE_KEY, String(newTaskStartInPlanMode));
		} catch {
			// Ignore storage access failures.
		}
	}, [newTaskStartInPlanMode]);

	useEffect(() => {
		if (!canUseWorktree && newTaskWorkspaceMode === "worktree") {
			setNewTaskWorkspaceMode("local");
		}
	}, [canUseWorktree, newTaskWorkspaceMode]);

	useEffect(() => {
		if (!canUseWorktree) {
			setNewTaskBranchRef("");
			return;
		}
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === newTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setNewTaskBranchRef(defaultTaskBranchRef);
	}, [canUseWorktree, createTaskBranchOptions, defaultTaskBranchRef, newTaskBranchRef]);

	useEffect(() => {
		if (!isInlineTaskCreateOpen) {
			return;
		}
		if (!canUseWorktree) {
			setNewTaskWorkspaceMode("local");
		}
		if (canUseWorktree && !newTaskBranchRef) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef, isInlineTaskCreateOpen, newTaskBranchRef]);

	useEffect(() => {
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);

	const workspaceTitle = useMemo(() => {
		if (!workspacePath) {
			return null;
		}
		const segments = workspacePath.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
		if (segments.length === 0) {
			return workspacePath;
		}
		return segments[segments.length - 1] ?? workspacePath;
	}, [workspacePath]);

	useEffect(() => {
		document.title = workspaceTitle ? `${workspaceTitle} | Kanbanana` : "Kanbanana";
	}, [workspaceTitle]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const isTypingTarget =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (isTypingTarget) {
				return;
			}

			const key = event.key.toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key === "k") {
				event.preventDefault();
				setIsCommandPaletteOpen((current) => !current);
				return;
			}

			if (!event.metaKey && !event.ctrlKey && key === "c") {
				event.preventDefault();
				setIsInlineTaskCreateOpen(true);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
	}, []);

	const handleOpenCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(true);
	}, []);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setNewTaskPrompt("");
		if (canUseWorktree) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef]);

	const handleCreateTask = useCallback(() => {
		const prompt = newTaskPrompt.trim();
		if (!prompt) {
			return;
		}
		if (newTaskWorkspaceMode === "worktree" && (!canUseWorktree || !(newTaskBranchRef || defaultTaskBranchRef))) {
			return;
		}
		const parsedPrompt = splitPromptToTitleDescription(prompt);
		const title = parsedPrompt.title.trim();
		if (!title) {
			return;
		}
		const baseRef =
			newTaskWorkspaceMode === "worktree" && canUseWorktree
				? (newTaskBranchRef || defaultTaskBranchRef || null)
				: null;
		setBoard((currentBoard) =>
			addTaskToColumn(currentBoard, "backlog", {
				title,
				description: parsedPrompt.description,
				prompt,
				startInPlanMode: newTaskStartInPlanMode,
				baseRef,
			}),
		);
		setNewTaskPrompt("");
		if (canUseWorktree) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
		setIsInlineTaskCreateOpen(false);
		setWorktreeError(null);
	}, [
		canUseWorktree,
		defaultTaskBranchRef,
		newTaskBranchRef,
		newTaskPrompt,
		newTaskStartInPlanMode,
		newTaskWorkspaceMode,
	]);

	const performMoveTaskToTrash = useCallback(
		async (task: BoardCard): Promise<void> => {
			await stopTaskSession(task.id);
			setBoard((currentBoard) => {
				const moved = moveTaskToColumn(currentBoard, task.id, "trash");
				return moved.moved ? moved.board : currentBoard;
			});
			await cleanupTaskWorkspace(task.id);
			if (selectedTaskId === task.id) {
				const info = await fetchTaskWorkspaceInfo(task);
				setSelectedTaskWorkspaceInfo(info);
			}
		},
		[cleanupTaskWorkspace, fetchTaskWorkspaceInfo, selectedTaskId, stopTaskSession],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, _fromColumnId: BoardColumnId): Promise<void> => {
			const selection = findCardSelection(board, taskId);
			if (!selection) {
				return;
			}

			const changeCount = await fetchTaskWorkingChangeCount(selection.card);
			if (changeCount == null) {
				return;
			}

			if (changeCount > 0) {
				const workspaceInfo =
					selectedTaskWorkspaceInfo && selectedTaskWorkspaceInfo.taskId === selection.card.id
						? selectedTaskWorkspaceInfo
						: await fetchTaskWorkspaceInfo(selection.card);
				setPendingTrashWarning({
					taskId,
					fileCount: changeCount,
					taskTitle: selection.card.title,
					workspaceInfo,
				});
				return;
			}

			await performMoveTaskToTrash(selection.card);
		},
		[board, fetchTaskWorkingChangeCount, fetchTaskWorkspaceInfo, performMoveTaskToTrash, selectedTaskWorkspaceInfo],
	);

	const handleRunShortcut = useCallback(
		async (shortcutId: string) => {
			const shortcut = runtimeProjectConfig?.shortcuts.find((item) => item.id === shortcutId);
			if (!shortcut) {
				return;
			}

			setRunningShortcutId(shortcutId);
			try {
				const response = await fetch("/api/runtime/shortcut/run", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						command: shortcut.command,
					}),
				});
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(payload?.error ?? `Shortcut run failed with ${response.status}`);
				}
				const result = (await response.json()) as RuntimeShortcutRunResponse;
				setLastShortcutOutput({
					label: shortcut.label,
					result,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setLastShortcutOutput({
					label: shortcut.label,
					result: {
						exitCode: 1,
						stdout: "",
						stderr: message,
						combinedOutput: message,
						durationMs: 0,
					},
				});
			} finally {
				setRunningShortcutId(null);
			}
		},
		[runtimeProjectConfig?.shortcuts],
	);

	const handleDragEnd = useCallback(
		(result: DropResult, options?: { selectDroppedTask?: boolean }) => {
			if (options?.selectDroppedTask && result.type === "CARD" && result.destination) {
				setSelectedTaskId(result.draggableId);
			}

			const applied = applyDragResult(board, result);

			const moveEvent = applied.moveEvent;
			if (!moveEvent) {
				setBoard(applied.board);
				return;
			}

			if (moveEvent.toColumnId === "trash") {
				void requestMoveTaskToTrash(moveEvent.taskId, moveEvent.fromColumnId);
				return;
			}

			setBoard(applied.board);

			if (moveEvent.toColumnId === "in_progress") {
				const movedSelection = findCardSelection(applied.board, moveEvent.taskId);
				if (movedSelection) {
					void (async () => {
						const ensured = await ensureTaskWorkspace(movedSelection.card);
						if (!ensured.ok) {
							setWorktreeError(ensured.message ?? "Could not set up task workspace.");
							setBoard((currentBoard) => {
								const currentColumnId = getTaskColumnId(currentBoard, moveEvent.taskId);
								if (currentColumnId !== "in_progress") {
									return currentBoard;
								}
								const reverted = moveTaskToColumn(currentBoard, moveEvent.taskId, moveEvent.fromColumnId);
								return reverted.moved ? reverted.board : currentBoard;
							});
							return;
						}
						const started = await startTaskSession(movedSelection.card);
						if (!started.ok) {
							setWorktreeError(started.message ?? "Could not start task session.");
							setBoard((currentBoard) => {
								const currentColumnId = getTaskColumnId(currentBoard, moveEvent.taskId);
								if (currentColumnId !== "in_progress") {
									return currentBoard;
								}
								const reverted = moveTaskToColumn(currentBoard, moveEvent.taskId, moveEvent.fromColumnId);
								return reverted.moved ? reverted.board : currentBoard;
							});
							return;
						}
						setWorktreeError(null);
					})();
				}
			}
		},
		[board, ensureTaskWorkspace, requestMoveTaskToTrash, startTaskSession],
	);

	const handleDetailTaskDragEnd = useCallback(
		(result: DropResult) => {
			handleDragEnd(result, { selectDroppedTask: true });
		},
		[handleDragEnd],
	);

	const handleCardSelect = useCallback((taskId: string) => {
		setSelectedTaskId(taskId);
	}, []);

	const handleMoveToTrash = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		void requestMoveTaskToTrash(selectedCard.card.id, selectedCard.column.id);
	}, [requestMoveTaskToTrash, selectedCard]);

	const detailSession = selectedCard ? sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id) : null;
	const runtimeHint = useMemo(() => {
		if (runtimeProjectConfig?.effectiveCommand) {
			return undefined;
		}
		const detected = runtimeProjectConfig?.detectedCommands?.join(", ");
		if (detected) {
			return `No agent configured (${detected})`;
		}
		return "No agent configured";
	}, [runtimeProjectConfig?.detectedCommands, runtimeProjectConfig?.effectiveCommand]);
	const repoHint = useMemo(() => {
		if (!workspaceGit || workspaceGit.hasGit) {
			return undefined;
		}
		return "No git detected, worktree isolation disabled";
	}, [workspaceGit]);
	const activeWorkspacePath = selectedTaskWorkspaceInfo?.path ?? workspacePath ?? undefined;
	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard || !selectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (selectedTaskWorkspaceInfo.mode === "local") {
			if (!selectedTaskWorkspaceInfo.hasGit) {
				return "Local workspace (no git)";
			}
			if (selectedTaskWorkspaceInfo.isDetached) {
				return `Local detached HEAD (${selectedTaskWorkspaceInfo.headCommit?.slice(0, 8) ?? "unknown"})`;
			}
			if (selectedTaskWorkspaceInfo.branch) {
				return `Local branch: ${selectedTaskWorkspaceInfo.branch}`;
			}
			return "Local workspace";
		}
		if (selectedTaskWorkspaceInfo.deleted) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		if (selectedTaskWorkspaceInfo.isDetached) {
			return `Worktree detached HEAD (${selectedTaskWorkspaceInfo.headCommit?.slice(0, 8) ?? "unknown"})`;
		}
		if (selectedTaskWorkspaceInfo.branch) {
			return `Worktree branch: ${selectedTaskWorkspaceInfo.branch}`;
		}
		return `Worktree base: ${selectedTaskWorkspaceInfo.baseRef ?? "unknown"}`;
	}, [selectedCard, selectedTaskWorkspaceInfo]);
	const trashWarningGuidance = useMemo(() => {
		if (!pendingTrashWarning) {
			return [] as string[];
		}
		const info = pendingTrashWarning.workspaceInfo;
		if (!info) {
			return ["Save your changes before trashing this task."];
		}
		if (info.mode === "local") {
			const branch = info.branch ?? "your current branch";
			return [
				`Commit your changes on ${branch}, then open a PR or keep the branch for later.`,
				"Or cherry-pick the commit into your target branch.",
			];
		}
		if (info.isDetached) {
			return [
				"Create a branch inside this worktree, commit, then open a PR from that branch.",
				"Or commit and cherry-pick the commit onto your target branch (for example main).",
			];
		}
		const branch = info.branch ?? info.baseRef ?? "a branch";
		return [
			`Commit your changes in the worktree branch (${branch}), then open a PR or cherry-pick as needed.`,
			"After preserving the work, you can safely move this task to Trash.",
		];
	}, [pendingTrashWarning]);
	const inlineTaskCreator = isInlineTaskCreateOpen ? (
		<TaskInlineCreateCard
			prompt={newTaskPrompt}
			onPromptChange={setNewTaskPrompt}
			onCreate={handleCreateTask}
			onCancel={handleCancelCreateTask}
			startInPlanMode={newTaskStartInPlanMode}
			onStartInPlanModeChange={setNewTaskStartInPlanMode}
			workspaceMode={newTaskWorkspaceMode}
			onWorkspaceModeChange={setNewTaskWorkspaceMode}
			workspaceCurrentBranch={workspaceGit?.currentBranch ?? null}
			canUseWorktree={canUseWorktree}
			branchRef={newTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setNewTaskBranchRef}
			disallowedSlashCommands={[...DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS]}
		/>
	) : undefined;

	return (
		<div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
			<TopBar
				onBack={selectedCard ? handleBack : undefined}
				subtitle={selectedCard?.column.title}
				workspacePath={activeWorkspacePath}
				workspaceHint={activeWorkspaceHint}
				repoHint={repoHint}
				runtimeHint={runtimeHint}
				onOpenSettings={() => setIsSettingsOpen(true)}
				shortcuts={runtimeProjectConfig?.shortcuts ?? []}
				runningShortcutId={runningShortcutId}
				onRunShortcut={handleRunShortcut}
			/>
			<RuntimeStatusBanners
				worktreeError={worktreeError}
				onDismissWorktreeError={() => setWorktreeError(null)}
				shortcutOutput={lastShortcutOutput}
				onClearShortcutOutput={() => setLastShortcutOutput(null)}
			/>
			<div className={selectedCard ? "hidden" : "flex h-full min-h-0 flex-1 overflow-hidden"}>
				<KanbanBoard
					data={board}
					taskSessions={sessions}
					onCardSelect={handleCardSelect}
					onCreateTask={handleOpenCreateTask}
					inlineTaskCreator={inlineTaskCreator}
					onDragEnd={handleDragEnd}
				/>
			</div>
			{selectedCard && detailSession ? (
				<CardDetailView
					selection={selectedCard}
					sessionSummary={detailSession}
					taskSessions={sessions}
					onSessionSummary={upsertSession}
					onBack={handleBack}
					onCardSelect={handleCardSelect}
					onTaskDragEnd={handleDetailTaskDragEnd}
					onCreateTask={handleOpenCreateTask}
					inlineTaskCreator={inlineTaskCreator}
					onMoveToTrash={handleMoveToTrash}
				/>
			) : null}
			<RuntimeSettingsDialog
				open={isSettingsOpen}
				onOpenChange={setIsSettingsOpen}
				onSaved={() => {
					void refreshRuntimeProjectConfig();
				}}
			/>
			<CommandDialog open={isCommandPaletteOpen} onOpenChange={setIsCommandPaletteOpen}>
				<CommandInput placeholder="Search tasks..." />
				<CommandList>
					<CommandEmpty>No tasks found.</CommandEmpty>
					<CommandGroup heading="Tasks">
						{searchableTasks.map((task) => (
							<CommandItem
								key={task.id}
								onSelect={() => {
									setSelectedTaskId(task.id);
									setIsCommandPaletteOpen(false);
								}}
							>
								<span className="truncate">{task.title}</span>
								<CommandShortcut>{task.columnTitle}</CommandShortcut>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</CommandDialog>
			<TaskTrashWarningDialog
				open={pendingTrashWarning !== null}
				warning={
					pendingTrashWarning
						? {
								taskTitle: pendingTrashWarning.taskTitle,
								fileCount: pendingTrashWarning.fileCount,
								workspacePath: pendingTrashWarning.workspaceInfo?.path ?? null,
							}
						: null
				}
				guidance={trashWarningGuidance}
				onCancel={() => setPendingTrashWarning(null)}
				onConfirm={() => {
					if (!pendingTrashWarning) {
						return;
					}
					const selection = findCardSelection(board, pendingTrashWarning.taskId);
					setPendingTrashWarning(null);
					if (!selection) {
						return;
					}
					void performMoveTaskToTrash(selection.card);
				}}
			/>
		</div>
	);
}
