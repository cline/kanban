import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BrowserAcpClient } from "@/kanban/acp/browser-acp-client";
import { useTaskChatSessions } from "@/kanban/chat/hooks/use-task-chat-sessions";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { RuntimeSettingsDialog } from "@/kanban/components/runtime-settings-dialog";
import { TopBar } from "@/kanban/components/top-bar";
import { createInitialBoardData } from "@/kanban/data/board-data";
import { useRuntimeAcpHealth } from "@/kanban/runtime/use-runtime-acp-health";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import type {
	RuntimeGitRepositoryInfo,
	RuntimeShortcutRunResponse,
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

const acpClient = new BrowserAcpClient();
const WORKSPACE_STATE_PERSIST_DEBOUNCE_MS = 300;
const TASK_WORKSPACE_MODE_STORAGE_KEY = "kanbanana.task-workspace-mode";

type TaskWorkspaceMode = "local" | "worktree";

interface PendingTrashWarningState {
	taskId: string;
	fromColumnId: BoardColumnId;
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

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspaceGit, setWorkspaceGit] = useState<RuntimeGitRepositoryInfo | null>(null);
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] =
		useState<RuntimeTaskWorkspaceInfoResponse | null>(null);
	const [isWorkspaceStateReady, setIsWorkspaceStateReady] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
	const [newTaskTitle, setNewTaskTitle] = useState("");
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
	const { health: runtimeAcpHealth, refresh: refreshRuntimeAcpHealth } = useRuntimeAcpHealth();
	const { config: runtimeProjectConfig, refresh: refreshRuntimeProjectConfig } = useRuntimeProjectConfig();

	const handleTaskRunComplete = useCallback((taskId: string) => {
		setBoard((currentBoard) => {
			const columnId = getTaskColumnId(currentBoard, taskId);
			if (columnId !== "in_progress") {
				return currentBoard;
			}
			const moved = moveTaskToColumn(currentBoard, taskId, "review");
			return moved.moved ? moved.board : currentBoard;
		});
	}, []);

	const { sessions, hydrateSessions, getSession, ensureSession, startTaskRun, sendPrompt, cancelPrompt, respondToPermission } =
		useTaskChatSessions({
			acpClient,
			onTaskRunComplete: handleTaskRunComplete,
		});

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
		const mainCandidate = workspaceGit.branches.includes("main")
			? "main"
			: workspaceGit.defaultBranch;
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

	useEffect(() => {
		let cancelled = false;
		const loadWorkspaceState = async () => {
			try {
				const response = await fetch("/api/workspace/state");
				if (!response.ok) {
					throw new Error(`Workspace state request failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeWorkspaceStateResponse;
				if (cancelled) {
					return;
				}
				const normalized = normalizeBoardData(payload.board) ?? createInitialBoardData();
				setWorkspacePath(payload.repoPath);
				setWorkspaceGit(payload.git);
				setBoard(normalized);
				hydrateSessions(payload.sessions);
				setWorktreeError(null);
			} catch {
				if (!cancelled) {
					setWorkspacePath(null);
					setWorkspaceGit(null);
					setBoard(createInitialBoardData());
					hydrateSessions({});
				}
			} finally {
				if (!cancelled) {
					setIsWorkspaceStateReady(true);
				}
			}
		};

		void loadWorkspaceState();
		return () => {
			cancelled = true;
		};
	}, [hydrateSessions]);

	useEffect(() => {
		if (!isWorkspaceStateReady) {
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
			}).catch(() => {
				// Keep the UI usable even if persistence is temporarily unavailable.
			});
		}, WORKSPACE_STATE_PERSIST_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [board, isWorkspaceStateReady, sessions]);

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
		if (!isCreateTaskOpen) {
			return;
		}
		if (!canUseWorktree) {
			setNewTaskWorkspaceMode("local");
		}
		if (canUseWorktree && !newTaskBranchRef) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef, isCreateTaskOpen, newTaskBranchRef]);

	useEffect(() => {
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);

	useEffect(() => {
		if (selectedCard) {
			ensureSession(selectedCard.card.id);
		}
	}, [ensureSession, selectedCard]);

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
				setIsCreateTaskOpen(true);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
	}, []);

	const handleOpenCreateTask = useCallback(() => {
		setIsCreateTaskOpen(true);
	}, []);

	const handleCreateTask = useCallback(() => {
		const title = newTaskTitle.trim();
		if (!title) {
			return;
		}
		if (newTaskWorkspaceMode === "worktree" && (!canUseWorktree || !(newTaskBranchRef || defaultTaskBranchRef))) {
			return;
		}
		const baseRef =
			newTaskWorkspaceMode === "worktree" && canUseWorktree
				? (newTaskBranchRef || defaultTaskBranchRef || null)
				: null;
		setBoard((currentBoard) =>
			addTaskToColumn(currentBoard, "backlog", {
				title,
				baseRef,
			}),
		);
		setNewTaskTitle("");
		if (canUseWorktree) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
		setIsCreateTaskOpen(false);
		setWorktreeError(null);
	}, [canUseWorktree, defaultTaskBranchRef, newTaskBranchRef, newTaskTitle, newTaskWorkspaceMode]);

	const performMoveTaskToTrash = useCallback(
		async (task: BoardCard): Promise<void> => {
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
		[cleanupTaskWorkspace, fetchTaskWorkspaceInfo, selectedTaskId],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, fromColumnId: BoardColumnId): Promise<void> => {
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
					fromColumnId,
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
		(result: DropResult) => {
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
						setWorktreeError(null);
						startTaskRun(movedSelection.card);
					})();
				}
				return;
			}
		},
		[board, ensureTaskWorkspace, requestMoveTaskToTrash, startTaskRun],
	);

	const handleCardSelect = useCallback((taskId: string) => {
		setSelectedTaskId(taskId);
	}, []);

	const handleSendPrompt = useCallback(
		(text: string) => {
			if (!selectedCard) {
				return;
			}
			const startedInReview = selectedCard.column.id === "review";
			void (async () => {
				let activeBoard = board;
				let activeTask = selectedCard.card;
				let activeColumnId = selectedCard.column.id;

				if (startedInReview) {
					const moved = moveTaskToColumn(board, selectedCard.card.id, "in_progress");
					if (moved.moved) {
						activeBoard = moved.board;
						setBoard(moved.board);
						const nextSelection = findCardSelection(moved.board, selectedCard.card.id);
						if (nextSelection) {
							activeTask = nextSelection.card;
							activeColumnId = nextSelection.column.id;
						}
					}
				}

				const latestColumnId = getTaskColumnId(activeBoard, activeTask.id) ?? activeColumnId;
				if (latestColumnId !== "in_progress") {
					return;
				}

				const ensured = await ensureTaskWorkspace(activeTask);
				if (!ensured.ok) {
					setWorktreeError(ensured.message ?? "Could not set up task workspace.");
					if (startedInReview) {
						setBoard((currentBoard) => {
							const movedBack = moveTaskToColumn(currentBoard, selectedCard.card.id, "review");
							return movedBack.moved ? movedBack.board : currentBoard;
						});
					}
					return;
				}

				setWorktreeError(null);
				sendPrompt(activeTask, text);
			})();
		},
		[board, ensureTaskWorkspace, selectedCard, sendPrompt],
	);

	const handleMoveToTrash = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		void requestMoveTaskToTrash(selectedCard.card.id, selectedCard.column.id);
	}, [requestMoveTaskToTrash, selectedCard]);

	const detailSession = selectedCard ? getSession(selectedCard.card.id) : null;
	const sendDisabledReason = useMemo(() => {
		if (!selectedCard) {
			return undefined;
		}
		if (selectedCard.column.id === "backlog") {
			return "Move this card to In Progress to start agent work.";
		}
		if (selectedCard.column.id === "trash") {
			return "This card is in Trash. Move it to In Progress to resume work.";
		}
		return undefined;
	}, [selectedCard]);
	const runtimeHint = useMemo(() => {
		if (!runtimeAcpHealth || runtimeAcpHealth.available) {
			return undefined;
		}

		if (runtimeAcpHealth.reason) {
			return runtimeAcpHealth.reason;
		}

		const detected = runtimeAcpHealth.detectedCommands?.join(", ");
		if (detected) {
			return `ACP not configured (${detected})`;
		}
		return "ACP not configured";
	}, [runtimeAcpHealth]);
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
			{worktreeError ? (
				<div className="border-b border-border bg-background px-4 py-2">
					<div className="flex items-center justify-between gap-3">
						<p className="text-xs text-red-300">{worktreeError}</p>
						<button
							type="button"
							onClick={() => setWorktreeError(null)}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Dismiss
						</button>
					</div>
				</div>
			) : null}
			{lastShortcutOutput ? (
				<div className="border-b border-border bg-background px-4 py-2">
					<div className="mb-1 flex items-center justify-between">
						<p className="text-xs text-muted-foreground">
							{lastShortcutOutput.label} finished with exit code {lastShortcutOutput.result.exitCode}
						</p>
						<button
							type="button"
							onClick={() => setLastShortcutOutput(null)}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Clear
						</button>
					</div>
					<pre className="max-h-32 overflow-auto rounded bg-nav p-2 text-xs text-foreground">
						{lastShortcutOutput.result.combinedOutput || "(no output)"}
					</pre>
				</div>
			) : null}
			<div className={selectedCard ? "hidden" : "flex h-full min-h-0 flex-1 overflow-hidden"}>
				<KanbanBoard
					data={board}
					onCardSelect={handleCardSelect}
					onCreateTask={handleOpenCreateTask}
					onDragEnd={handleDragEnd}
				/>
			</div>
			{selectedCard && detailSession ? (
				<CardDetailView
					selection={selectedCard}
					session={detailSession}
					onBack={handleBack}
					onCardSelect={handleCardSelect}
					onSendPrompt={handleSendPrompt}
					onCancelPrompt={() => cancelPrompt(selectedCard.card.id)}
					onPermissionRespond={(messageId, optionId) =>
						respondToPermission(selectedCard.card.id, messageId, optionId)
					}
					onMoveToTrash={handleMoveToTrash}
					sendDisabled={Boolean(sendDisabledReason)}
					sendDisabledReason={sendDisabledReason}
				/>
			) : null}
			<RuntimeSettingsDialog
				open={isSettingsOpen}
				onOpenChange={setIsSettingsOpen}
				onSaved={() => {
					void refreshRuntimeAcpHealth();
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
			<Dialog
				open={pendingTrashWarning !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingTrashWarning(null);
					}
				}}
			>
				<DialogContent className="border-border bg-card text-foreground">
					<DialogHeader>
						<DialogTitle>Unsaved task changes detected</DialogTitle>
						<DialogDescription className="text-muted-foreground">
							{pendingTrashWarning
								? `${pendingTrashWarning.taskTitle} has ${pendingTrashWarning.fileCount} changed file(s).`
								: "This task has uncommitted changes."}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-2 text-sm text-muted-foreground">
						<p>
							Moving to Trash will delete this task worktree. Preserve your work first, then trash the task.
						</p>
						{pendingTrashWarning?.workspaceInfo ? (
							<p className="rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
								{pendingTrashWarning.workspaceInfo.path}
							</p>
						) : null}
						{trashWarningGuidance.map((line) => (
							<p key={line}>{line}</p>
						))}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setPendingTrashWarning(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
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
						>
							Move to Trash Anyway
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			<Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
				<DialogContent className="border-border bg-card text-foreground">
					<DialogHeader>
						<DialogTitle>Create Task</DialogTitle>
						<DialogDescription className="text-muted-foreground">
							New tasks are added to Backlog.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-1">
						<label htmlFor="task-title-input" className="text-xs text-muted-foreground">
							Title
						</label>
						<input
							id="task-title-input"
							value={newTaskTitle}
							onChange={(event) => setNewTaskTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									handleCreateTask();
								}
							}}
							className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
							placeholder="Describe the task"
						/>
					</div>
					<div className="space-y-1">
						<label htmlFor="task-workspace-mode-select" className="text-xs text-muted-foreground">
							Execution mode
						</label>
						<select
							id="task-workspace-mode-select"
							value={newTaskWorkspaceMode}
							onChange={(event) => setNewTaskWorkspaceMode(event.target.value as TaskWorkspaceMode)}
							className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
						>
							<option value="local">
								{workspaceGit?.currentBranch
									? `Local workspace (current branch: ${workspaceGit.currentBranch})`
									: "Local workspace"}
							</option>
							<option value="worktree" disabled={!canUseWorktree}>
								Isolated worktree
							</option>
						</select>
						<p className="text-[11px] text-muted-foreground">
							{newTaskWorkspaceMode === "local"
								? "Runs directly in your current workspace."
								: "Creates an isolated worktree when the task starts."}
						</p>
					</div>
					<div className="space-y-1">
						<label htmlFor="task-branch-select" className="text-xs text-muted-foreground">
							Worktree base branch
						</label>
						<select
							id="task-branch-select"
							value={newTaskBranchRef}
							onChange={(event) => setNewTaskBranchRef(event.target.value)}
							disabled={newTaskWorkspaceMode !== "worktree" || !canUseWorktree}
							className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
						>
							{createTaskBranchOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
							{createTaskBranchOptions.length === 0 ? (
								<option value="">No branches detected</option>
							) : null}
						</select>
						<p className="text-[11px] text-muted-foreground">
							{newTaskWorkspaceMode === "worktree"
								? "Branch/ref used when creating the isolated task worktree."
								: "Disabled while local mode is selected."}
						</p>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setIsCreateTaskOpen(false);
								setNewTaskTitle("");
								if (canUseWorktree) {
									setNewTaskBranchRef(defaultTaskBranchRef);
								}
							}}
						>
							Cancel
						</Button>
						<Button
							onClick={handleCreateTask}
							disabled={
								!newTaskTitle.trim() ||
								(newTaskWorkspaceMode === "worktree" && (!canUseWorktree || !newTaskBranchRef))
							}
						>
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
