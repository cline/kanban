import { Alert, Button, Classes, Colors, MenuItem, NonIdealState, Pre, Spinner } from "@blueprintjs/core";
import { Omnibar } from "@blueprintjs/select";
import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";

import {
	buildProjectPathname,
	countTasksByColumn,
	createIdleTaskSession,
	filterTask,
	loadPersistedTaskStartInPlanMode,
	loadPersistedTaskWorkspaceMode,
	parseProjectIdFromPathname,
	persistTaskStartInPlanMode,
	persistTaskWorkspaceMode,
	renderTask,
	type SearchableTask,
} from "@/kanban/app/app-utils";
import { useOpenWorkspace } from "@/kanban/app/use-open-workspace";
import { showAppToast } from "@/kanban/components/app-toaster";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { ClearTrashDialog } from "@/kanban/components/clear-trash-dialog";
import { AgentTerminalPanel } from "@/kanban/components/detail-panels/agent-terminal-panel";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { ProjectNavigationPanel } from "@/kanban/components/project-navigation-panel";
import { ResizableBottomPane } from "@/kanban/components/resizable-bottom-pane";
import { RuntimeStatusBanners } from "@/kanban/components/runtime-status-banners";
import { RuntimeSettingsDialog } from "@/kanban/components/runtime-settings-dialog";
import { TaskInlineCreateCard, type TaskWorkspaceMode } from "@/kanban/components/task-inline-create-card";
import { TaskTrashWarningDialog } from "@/kanban/components/task-trash-warning-dialog";
import { TopBar, type TopBarTaskGitSummary } from "@/kanban/components/top-bar";
import { createInitialBoardData } from "@/kanban/data/board-data";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import { useRuntimeStateStream } from "@/kanban/runtime/use-runtime-state-stream";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";
import {
	fetchWorkspaceState,
	saveWorkspaceState,
} from "@/kanban/runtime/workspace-state-query";
import { useWorkspacePersistence } from "@/kanban/runtime/use-workspace-persistence";
import {
	DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS,
	splitPromptToTitleDescription,
} from "@/kanban/utils/task-prompt";
import type {
	RuntimeProjectAddResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeGitRepositoryInfo,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeGitSyncSummary,
	RuntimeProjectRemoveResponse,
	RuntimeShellSessionStartResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeShortcutRunResponse,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "@/kanban/runtime/types";
import {
	addTaskToColumn,
	applyDragResult,
	clearColumnTasks,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
	normalizeBoardData,
	updateTask,
} from "@/kanban/state/board-state";
import type {
	BoardCard,
	BoardColumnId,
	BoardData,
	ReviewTaskWorkspaceSnapshot,
} from "@/kanban/types";

interface PendingTrashWarningState {
	taskId: string;
	fileCount: number;
	taskTitle: string;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

const REMOVED_PROJECT_ERROR_PREFIX = "Project no longer exists on disk and was removed:";
const HOME_TERMINAL_TASK_ID = "__home_terminal__";
const HOME_TERMINAL_ROWS = 16;
const DETAIL_TERMINAL_TASK_PREFIX = "__detail_terminal__:";

function getDetailTerminalTaskId(card: BoardCard): string {
	if (!card.baseRef) {
		return HOME_TERMINAL_TASK_ID;
	}
	return `${DETAIL_TERMINAL_TASK_PREFIX}${card.id}`;
}

function createNoGitSyncSummary(): RuntimeGitSyncSummary {
	return {
		hasGit: false,
		currentBranch: null,
		upstreamBranch: null,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		aheadCount: 0,
		behindCount: 0,
	};
}

function isRuntimeConnectionFailure(message: string | null): boolean {
	if (!message) {
		return false;
	}
	const normalized = message.toLowerCase();
	return normalized.includes("runtime stream connection failed")
		|| normalized.includes("failed to construct")
		|| normalized.includes("websocket");
}

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspaceGit, setWorkspaceGit] = useState<RuntimeGitRepositoryInfo | null>(null);
	const [appliedWorkspaceProjectId, setAppliedWorkspaceProjectId] = useState<string | null>(null);
	const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null);
	const [workspaceHydrationNonce, setWorkspaceHydrationNonce] = useState(0);
	const workspaceVersionRef = useRef<{ projectId: string | null; revision: number | null }>({
		projectId: null,
		revision: null,
	});
	const homeTerminalProjectIdRef = useRef<string | null>(null);
	const homeTerminalToggleRef = useRef<(() => void) | null>(null);
	const detailTerminalToggleRef = useRef<(() => void) | null>(null);
	const detailTerminalSelectionKeyRef = useRef<string | null>(null);
	const workspaceRefreshRequestIdRef = useRef(0);
	const previousSessionsRef = useRef<Record<string, RuntimeTaskSessionSummary>>({});
	const lastStreamErrorRef = useRef<string | null>(null);
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] =
		useState<RuntimeTaskWorkspaceInfoResponse | null>(null);
	const [workspaceSnapshots, setWorkspaceSnapshots] =
		useState<Record<string, ReviewTaskWorkspaceSnapshot>>({});
	const reviewWorkspaceSnapshotLoadingRef = useRef<Set<string>>(new Set());
	const inProgressWorkspaceSnapshotLoadingRef = useRef<Set<string>>(new Set());
	const reviewWorkspaceSnapshotAttemptedRef = useRef<Set<string>>(new Set());
	const activeReviewTaskIdsRef = useRef<Set<string>>(new Set());
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
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
	const preferredNewTaskWorkspaceModeRef = useRef<TaskWorkspaceMode>(newTaskWorkspaceMode);
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [editTaskPrompt, setEditTaskPrompt] = useState("");
	const [editTaskStartInPlanMode, setEditTaskStartInPlanMode] = useState(false);
	const [editTaskWorkspaceMode, setEditTaskWorkspaceMode] = useState<TaskWorkspaceMode>("local");
	const [editTaskBranchRef, setEditTaskBranchRef] = useState("");
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [gitSummary, setGitSummary] = useState<RuntimeGitSyncSummary | null>(null);
	const [runningGitAction, setRunningGitAction] = useState<RuntimeGitSyncAction | null>(null);
	const [gitActionError, setGitActionError] = useState<{
		action: RuntimeGitSyncAction;
		message: string;
		output: string;
	} | null>(null);
	const [pendingTrashWarning, setPendingTrashWarning] = useState<PendingTrashWarningState | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [runningShortcutId, setRunningShortcutId] = useState<string | null>(null);
	const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);
	const [isHomeTerminalOpen, setIsHomeTerminalOpen] = useState(false);
	const [isHomeTerminalStarting, setIsHomeTerminalStarting] = useState(false);
	const [homeTerminalShellBinary, setHomeTerminalShellBinary] = useState<string | null>(null);
	const [isDetailTerminalOpen, setIsDetailTerminalOpen] = useState(false);
	const [isDetailTerminalStarting, setIsDetailTerminalStarting] = useState(false);
	const [runtimeProjectConfigRefreshNonce, setRuntimeProjectConfigRefreshNonce] = useState(0);
	const [lastShortcutOutput, setLastShortcutOutput] = useState<{
		label: string;
		result: RuntimeShortcutRunResponse;
	} | null>(null);
	const [requestedProjectId, setRequestedProjectId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseProjectIdFromPathname(window.location.pathname);
	});
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => {
		if (typeof document === "undefined") {
			return true;
		}
		return document.visibilityState === "visible";
	});
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceStatusRetrievedAt,
		streamError,
		hasReceivedSnapshot,
	} = useRuntimeStateStream(requestedProjectId);
	const navigationCurrentProjectId = requestedProjectId ?? currentProjectId;
	const hasNoProjects = hasReceivedSnapshot && projects.length === 0 && currentProjectId === null;
	const isProjectSwitching =
		requestedProjectId !== null &&
		requestedProjectId !== currentProjectId &&
		!hasNoProjects;
	const isInitialRuntimeLoad = !hasReceivedSnapshot && currentProjectId === null && projects.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const isWorkspaceMetadataPending =
		currentProjectId !== null &&
		appliedWorkspaceProjectId !== currentProjectId;
	const navigationProjectPath = useMemo(() => {
		if (!navigationCurrentProjectId) {
			return null;
		}
		return projects.find((project) => project.id === navigationCurrentProjectId)?.path ?? null;
	}, [navigationCurrentProjectId, projects]);
	const shouldShowProjectLoadingState =
		selectedTaskId === null &&
		!streamError &&
		(isProjectSwitching || isInitialRuntimeLoad || isAwaitingWorkspaceSnapshot);
	const isProjectListLoading = !hasReceivedSnapshot && !streamError;
	const isRuntimeDisconnected = isRuntimeConnectionFailure(streamError);
	const shouldUseNavigationPath =
		isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;
	const { config: runtimeProjectConfig } = useRuntimeProjectConfig(
		currentProjectId,
		runtimeProjectConfigRefreshNonce,
	);
	// Project list counts are server-driven and can lag behind local board edits by a short
	// persistence/broadcast round-trip, so we optimistically overlay the active project's counts.
	const displayedProjects = useMemo(() => {
		if (!canPersistWorkspaceState || !currentProjectId) {
			return projects;
		}
		const localCounts = countTasksByColumn(board);
		return projects.map((project) =>
			project.id === currentProjectId
				? {
						...project,
						taskCounts: localCounts,
					}
				: project,
		);
	}, [board, canPersistWorkspaceState, currentProjectId, projects]);
	const homeTerminalSummary = sessions[HOME_TERMINAL_TASK_ID] ?? null;

	useEffect(() => {
		if (workspaceVersionRef.current.projectId !== currentProjectId) {
			return;
		}
		workspaceVersionRef.current = {
			projectId: currentProjectId,
			revision: workspaceRevision,
		};
	}, [currentProjectId, workspaceRevision]);

	const applyWorkspaceState = useCallback(
		(nextWorkspaceState: RuntimeWorkspaceStateResponse | null) => {
			if (!nextWorkspaceState) {
				setCanPersistWorkspaceState(false);
				setWorkspacePath(null);
				setWorkspaceGit(null);
				setAppliedWorkspaceProjectId(null);
				setWorkspaceSnapshots({});
				reviewWorkspaceSnapshotLoadingRef.current.clear();
				inProgressWorkspaceSnapshotLoadingRef.current.clear();
				reviewWorkspaceSnapshotAttemptedRef.current.clear();
				activeReviewTaskIdsRef.current = new Set();
				setBoard(createInitialBoardData());
				setSessions({});
				setWorkspaceRevision(null);
				workspaceVersionRef.current = {
					projectId: currentProjectId,
					revision: null,
				};
				return;
			}
			const currentVersion = workspaceVersionRef.current;
			const isSameProject = currentVersion.projectId === currentProjectId;
			const currentRevision = isSameProject ? currentVersion.revision : null;
			if (
				isSameProject &&
				currentRevision !== null &&
				nextWorkspaceState.revision < currentRevision
			) {
				return;
			}
			setWorkspacePath(nextWorkspaceState.repoPath);
			setWorkspaceGit(nextWorkspaceState.git);
			setSessions(nextWorkspaceState.sessions ?? {});
			const shouldHydrateBoard =
				!isSameProject ||
				currentRevision !== nextWorkspaceState.revision;
			if (shouldHydrateBoard) {
				const normalized = normalizeBoardData(nextWorkspaceState.board) ?? createInitialBoardData();
				setBoard(normalized);
				setWorkspaceSnapshots({});
				reviewWorkspaceSnapshotLoadingRef.current.clear();
				inProgressWorkspaceSnapshotLoadingRef.current.clear();
				reviewWorkspaceSnapshotAttemptedRef.current.clear();
				setWorkspaceHydrationNonce((current) => current + 1);
			}
			setWorkspaceRevision(nextWorkspaceState.revision);
			workspaceVersionRef.current = {
				projectId: currentProjectId,
				revision: nextWorkspaceState.revision,
			};
			setAppliedWorkspaceProjectId(currentProjectId);
			setCanPersistWorkspaceState(true);
		},
		[currentProjectId],
	);

	const upsertSession = useCallback((summary: RuntimeTaskSessionSummary) => {
		setSessions((current) => ({
			...current,
			[summary.taskId]: summary,
		}));
	}, []);

	const ensureTaskWorkspace = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		try {
			const response = await workspaceFetch("/api/workspace/worktree/ensure", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: task.id,
					baseRef: task.baseRef ?? null,
				}),
				workspaceId: currentProjectId,
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
	}, [currentProjectId]);

	const startTaskSession = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		try {
			const kickoffPrompt = task.prompt.trim() || task.description.trim() || task.title;
			const response = await workspaceFetch("/api/runtime/task-session/start", {
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
				workspaceId: currentProjectId,
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
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, [currentProjectId, upsertSession]);

	const stopTaskSession = useCallback(async (taskId: string): Promise<void> => {
		try {
			await workspaceFetch("/api/runtime/task-session/stop", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
				workspaceId: currentProjectId,
			});
		} catch {
			// Ignore stop errors during cleanup.
		}
	}, [currentProjectId]);

	const cleanupTaskWorkspace = useCallback(async (taskId: string): Promise<RuntimeWorktreeDeleteResponse | null> => {
		try {
			const response = await workspaceFetch("/api/workspace/worktree/delete", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
				workspaceId: currentProjectId,
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
	}, [currentProjectId]);

	const fetchTaskWorkspaceInfo = useCallback(
		async (task: BoardCard): Promise<RuntimeTaskWorkspaceInfoResponse | null> => {
			try {
				const params = new URLSearchParams({
					taskId: task.id,
				});
				params.set("baseRef", task.baseRef ?? "");
				const response = await workspaceFetch(`/api/workspace/task-context?${params.toString()}`, {
					workspaceId: currentProjectId,
				});
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
		[currentProjectId],
	);

	const fetchTaskWorkingChangeCount = useCallback(async (task: BoardCard): Promise<number | null> => {
		if (!currentProjectId) {
			return null;
		}
		try {
			const params = new URLSearchParams({
				taskId: task.id,
			});
			params.set("baseRef", task.baseRef ?? "");
			const response = await workspaceFetch(`/api/workspace/git/summary?${params.toString()}`, {
				workspaceId: currentProjectId,
			});
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as { error?: string } | null;
				throw new Error(payload?.error ?? `Workspace request failed with ${response.status}`);
			}
			const payload = (await response.json()) as RuntimeGitSummaryResponse;
			if (!payload.ok) {
				throw new Error(payload.error ?? "Workspace summary request failed.");
			}
			return payload.summary.changedFiles;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
			return null;
		}
	}, [currentProjectId]);
	const fetchReviewWorkspaceSnapshot = useCallback(
		async (task: BoardCard): Promise<ReviewTaskWorkspaceSnapshot | null> => {
			if (!currentProjectId) {
				return null;
			}
			const params = new URLSearchParams({
				taskId: task.id,
			});
			params.set("baseRef", task.baseRef ?? "");

			let workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
			try {
				const infoResponse = await workspaceFetch(`/api/workspace/task-context?${params.toString()}`, {
					workspaceId: currentProjectId,
				});
				if (!infoResponse.ok) {
					return null;
				}
				workspaceInfo = (await infoResponse.json()) as RuntimeTaskWorkspaceInfoResponse;
			} catch {
				return null;
			}

			let changedFiles: number | null = null;
			let additions: number | null = null;
			let deletions: number | null = null;
			try {
				const summaryResponse = await workspaceFetch(`/api/workspace/git/summary?${params.toString()}`, {
					workspaceId: currentProjectId,
				});
				if (summaryResponse.ok) {
					const summaryPayload = (await summaryResponse.json()) as RuntimeGitSummaryResponse;
					if (summaryPayload.ok) {
						changedFiles = summaryPayload.summary.changedFiles;
						additions = summaryPayload.summary.additions;
						deletions = summaryPayload.summary.deletions;
					}
				}
			} catch {
				// Swallow errors: this snapshot is informational and should never block review cards.
			}

			return {
				taskId: task.id,
				mode: workspaceInfo.mode,
				path: workspaceInfo.path,
				hasGit: workspaceInfo.hasGit,
				branch: workspaceInfo.branch,
				isDetached: workspaceInfo.isDetached,
				headCommit: workspaceInfo.headCommit,
				changedFiles,
				additions,
				deletions,
			};
		},
		[currentProjectId],
	);
	const selectedCard = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);
	const reviewCards = useMemo(() => {
		return board.columns.find((column) => column.id === "review")?.cards ?? [];
	}, [board.columns]);
	const inProgressCards = useMemo(() => {
		return board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
	}, [board.columns]);
	const activeWorkspaceSnapshotTaskIds = useMemo(() => {
		const ids = new Set<string>();
		for (const card of reviewCards) {
			ids.add(card.id);
		}
		for (const card of inProgressCards) {
			ids.add(card.id);
		}
		return ids;
	}, [inProgressCards, reviewCards]);

	const searchableTasks = useMemo((): SearchableTask[] => {
		return board.columns.flatMap((column) =>
			column.cards.map((card) => ({
				id: card.id,
				title: card.title,
				columnTitle: column.title,
			})),
		);
	}, [board.columns]);
	const trashTaskIds = useMemo(() => {
		const trashColumn = board.columns.find((column) => column.id === "trash");
		return trashColumn ? trashColumn.cards.map((card) => card.id) : [];
	}, [board.columns]);
	const trashTaskCount = trashTaskIds.length;

	useEffect(() => {
		setBoard((currentBoard) => {
			let nextBoard = currentBoard;
				const previousSessions = previousSessionsRef.current;
				for (const summary of Object.values(sessions)) {
					const previous = previousSessions[summary.taskId];
					if (previous && previous.updatedAt > summary.updatedAt) {
						continue;
					}
					const columnId = getTaskColumnId(nextBoard, summary.taskId);
					if (
						summary.state === "awaiting_review" &&
						columnId === "in_progress"
					) {
						const moved = moveTaskToColumn(nextBoard, summary.taskId, "review");
						if (moved.moved) {
							nextBoard = moved.board;
						}
						continue;
					}
					if (
						summary.state === "running" &&
						columnId === "review"
					) {
						const moved = moveTaskToColumn(nextBoard, summary.taskId, "in_progress");
					if (moved.moved) {
						nextBoard = moved.board;
					}
					continue;
				}
					if (
						summary.state === "interrupted" &&
						previous?.state !== "interrupted" &&
						columnId &&
						columnId !== "trash"
					) {
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "trash");
					if (moved.moved) {
						nextBoard = moved.board;
					}
				}
			}
			return nextBoard;
		});
		previousSessionsRef.current = sessions;
	}, [sessions]);

	useEffect(() => {
		setWorkspaceSnapshots((current) => {
			let changed = false;
			const next: Record<string, ReviewTaskWorkspaceSnapshot> = {};
			for (const [taskId, snapshot] of Object.entries(current)) {
				if (activeWorkspaceSnapshotTaskIds.has(taskId)) {
					next[taskId] = snapshot;
					continue;
				}
				changed = true;
			}
			return changed ? next : current;
		});
	}, [activeWorkspaceSnapshotTaskIds]);

	useEffect(() => {
		const reviewTaskIds = new Set(reviewCards.map((card) => card.id));
		activeReviewTaskIdsRef.current = reviewTaskIds;
		reviewWorkspaceSnapshotLoadingRef.current.forEach((taskId) => {
			if (!reviewTaskIds.has(taskId)) {
				reviewWorkspaceSnapshotLoadingRef.current.delete(taskId);
			}
		});
		reviewWorkspaceSnapshotAttemptedRef.current.forEach((taskId) => {
			if (!reviewTaskIds.has(taskId)) {
				reviewWorkspaceSnapshotAttemptedRef.current.delete(taskId);
			}
		});
		if (!currentProjectId) {
			reviewWorkspaceSnapshotLoadingRef.current.clear();
			reviewWorkspaceSnapshotAttemptedRef.current.clear();
			return;
		}
		for (const reviewCard of reviewCards) {
			if (workspaceSnapshots[reviewCard.id]) {
				continue;
			}
			if (reviewWorkspaceSnapshotAttemptedRef.current.has(reviewCard.id)) {
				continue;
			}
			if (reviewWorkspaceSnapshotLoadingRef.current.has(reviewCard.id)) {
				continue;
			}
			reviewWorkspaceSnapshotAttemptedRef.current.add(reviewCard.id);
			reviewWorkspaceSnapshotLoadingRef.current.add(reviewCard.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(reviewCard);
				reviewWorkspaceSnapshotLoadingRef.current.delete(reviewCard.id);
				if (!snapshot || !activeReviewTaskIdsRef.current.has(reviewCard.id)) {
					return;
				}
				setWorkspaceSnapshots((current) => {
					const existing = current[reviewCard.id];
					if (existing && JSON.stringify(existing) === JSON.stringify(snapshot)) {
						return current;
					}
					return {
						...current,
						[reviewCard.id]: snapshot,
					};
				});
			})();
		}
	}, [currentProjectId, fetchReviewWorkspaceSnapshot, reviewCards, workspaceSnapshots]);

	useEffect(() => {
		const inProgressTaskIds = new Set(inProgressCards.map((card) => card.id));
		inProgressWorkspaceSnapshotLoadingRef.current.forEach((taskId) => {
			if (!inProgressTaskIds.has(taskId)) {
				inProgressWorkspaceSnapshotLoadingRef.current.delete(taskId);
			}
		});

		if (!currentProjectId) {
			inProgressWorkspaceSnapshotLoadingRef.current.clear();
			return;
		}
		for (const card of inProgressCards) {
			if (workspaceSnapshots[card.id]) {
				continue;
			}
			if (inProgressWorkspaceSnapshotLoadingRef.current.has(card.id)) {
				continue;
			}
			inProgressWorkspaceSnapshotLoadingRef.current.add(card.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(card);
				inProgressWorkspaceSnapshotLoadingRef.current.delete(card.id);
				if (!snapshot) {
					return;
				}
				setWorkspaceSnapshots((current) => {
					const existing = current[card.id];
					if (existing && JSON.stringify(existing) === JSON.stringify(snapshot)) {
						return current;
					}
					return {
						...current,
						[card.id]: snapshot,
					};
				});
			})();
		}
	}, [currentProjectId, fetchReviewWorkspaceSnapshot, inProgressCards, workspaceSnapshots]);

	useEffect(() => {
		if (!currentProjectId || workspaceStatusRetrievedAt <= 0 || !isDocumentVisible) {
			return;
		}
		for (const card of inProgressCards) {
			if (inProgressWorkspaceSnapshotLoadingRef.current.has(card.id)) {
				continue;
			}
			inProgressWorkspaceSnapshotLoadingRef.current.add(card.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(card);
				inProgressWorkspaceSnapshotLoadingRef.current.delete(card.id);
				if (!snapshot) {
					return;
				}
				setWorkspaceSnapshots((current) => {
					const existing = current[card.id];
					if (existing && JSON.stringify(existing) === JSON.stringify(snapshot)) {
						return current;
					}
					return {
						...current,
						[card.id]: snapshot,
					};
				});
			})();
		}
		for (const card of reviewCards) {
			if (reviewWorkspaceSnapshotLoadingRef.current.has(card.id)) {
				continue;
			}
			reviewWorkspaceSnapshotLoadingRef.current.add(card.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(card);
				reviewWorkspaceSnapshotLoadingRef.current.delete(card.id);
				if (!snapshot) {
					return;
				}
				setWorkspaceSnapshots((current) => {
					const existing = current[card.id];
					if (existing && JSON.stringify(existing) === JSON.stringify(snapshot)) {
						return current;
					}
					return {
						...current,
						[card.id]: snapshot,
					};
				});
			})();
		}
	}, [
		currentProjectId,
		fetchReviewWorkspaceSnapshot,
		inProgressCards,
		isDocumentVisible,
		reviewCards,
		workspaceStatusRetrievedAt,
	]);

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
	}, [
		fetchTaskWorkspaceInfo,
		selectedCard?.card.baseRef,
		selectedCard?.card.id,
		selectedCard ? sessions[selectedCard.card.id]?.updatedAt ?? 0 : 0,
		workspaceStatusRetrievedAt,
	]);

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
	const isWorktreeCapabilityKnown = workspaceGit !== null;
	const defaultTaskBranchRef = useMemo(() => {
		if (!workspaceGit?.hasGit) {
			return "";
		}
		return workspaceGit.currentBranch ?? workspaceGit.defaultBranch ?? createTaskBranchOptions[0]?.value ?? "";
	}, [createTaskBranchOptions, workspaceGit]);

	const refreshWorkspaceState = useCallback(async () => {
		if (!currentProjectId) {
			return;
		}
		const requestId = workspaceRefreshRequestIdRef.current + 1;
		workspaceRefreshRequestIdRef.current = requestId;
		const requestedProjectId = currentProjectId;
		setIsWorkspaceStateRefreshing(true);
		try {
			const refreshed = await fetchWorkspaceState(requestedProjectId);
			if (
				workspaceRefreshRequestIdRef.current !== requestId ||
				workspaceVersionRef.current.projectId !== requestedProjectId
			) {
				return;
			}
			applyWorkspaceState(refreshed);
			setWorktreeError(null);
		} catch (error) {
			if (
				workspaceRefreshRequestIdRef.current !== requestId ||
				workspaceVersionRef.current.projectId !== requestedProjectId
			) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
		} finally {
			if (workspaceRefreshRequestIdRef.current === requestId) {
				setIsWorkspaceStateRefreshing(false);
			}
		}
	}, [applyWorkspaceState, currentProjectId]);

	const refreshGitSummary = useCallback(async () => {
		if (!currentProjectId) {
			setGitSummary(null);
			return;
		}
		try {
			const response = await workspaceFetch("/api/workspace/git/summary", {
				workspaceId: currentProjectId,
			});
			const payload = (await response.json().catch(() => null)) as
				| RuntimeGitSummaryResponse
				| { error?: string }
				| null;
			if (!response.ok || !payload || !("ok" in payload) || !payload.ok || !payload.summary) {
				throw new Error(
					(payload && "error" in payload && typeof payload.error === "string" && payload.error) ||
						`Git summary request failed with ${response.status}.`,
				);
			}
			setGitSummary(payload.summary);
		} catch {
			setGitSummary((current) => current ?? createNoGitSyncSummary());
		}
	}, [currentProjectId]);

	const runGitAction = useCallback(async (action: RuntimeGitSyncAction) => {
		if (!currentProjectId || runningGitAction) {
			return;
		}
		setRunningGitAction(action);
		try {
			const response = await workspaceFetch(`/api/workspace/git/${action}`, {
				method: "POST",
				workspaceId: currentProjectId,
			});
			const payload = (await response.json().catch(() => null)) as
				| RuntimeGitSyncResponse
				| { error?: string; output?: string; summary?: RuntimeGitSyncSummary }
				| null;
			if (!response.ok || !payload || !("ok" in payload) || !payload.ok || !payload.summary) {
				const errorMessage =
					(payload && "error" in payload && typeof payload.error === "string" && payload.error) ||
					`${action} failed with ${response.status}.`;
				const output =
					payload && "output" in payload && typeof payload.output === "string"
						? payload.output
						: "";
				const fallbackSummary =
					payload &&
					"summary" in payload &&
					payload.summary &&
					typeof payload.summary === "object"
						? payload.summary
						: null;
				if (fallbackSummary) {
					setGitSummary(fallbackSummary);
				}
				setGitActionError({
					action,
					message: errorMessage,
					output,
				});
				return;
			}
			setGitSummary(payload.summary);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setGitActionError({
				action,
				message,
				output: "",
			});
		} finally {
			setRunningGitAction(null);
		}
	}, [currentProjectId, runningGitAction]);

	const persistWorkspaceStateAsync = useCallback(
		async (input: {
			workspaceId: string;
			payload: Parameters<typeof saveWorkspaceState>[1];
		}) => await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const handleWorkspaceStateConflict = useCallback(() => {
		showAppToast(
			{
				intent: "warning",
				icon: "warning-sign",
				message: "Workspace changed elsewhere. Synced latest state. Retry your last edit if needed.",
				timeout: 5000,
			},
			"workspace-state-conflict",
		);
	}, []);

	useWorkspacePersistence({
		board,
		sessions,
		currentProjectId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: setWorkspaceRevision,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		if (hasNoProjects) {
			applyWorkspaceState(null);
			return;
		}
		if (!streamedWorkspaceState) {
			return;
		}
		applyWorkspaceState(streamedWorkspaceState);
	}, [applyWorkspaceState, hasNoProjects, streamedWorkspaceState]);

	useEffect(() => {
		if (!streamError) {
			const previousStreamError = lastStreamErrorRef.current;
			if (previousStreamError) {
				setWorktreeError((current) => (current === previousStreamError ? null : current));
				lastStreamErrorRef.current = null;
			}
			return;
		}
		if (streamError.startsWith(REMOVED_PROJECT_ERROR_PREFIX)) {
			const removedPath = streamError.slice(REMOVED_PROJECT_ERROR_PREFIX.length).trim();
			showAppToast(
				{
					intent: "danger",
					icon: "warning-sign",
					message: removedPath
						? `Project no longer exists and was removed: ${removedPath}`
						: "Project no longer exists and was removed.",
					timeout: 6000,
				},
				`project-removed-${removedPath || "unknown"}`,
			);
			lastStreamErrorRef.current = null;
			setWorktreeError(null);
			return;
		}
		if (isRuntimeConnectionFailure(streamError)) {
			lastStreamErrorRef.current = streamError;
			setWorktreeError(null);
			return;
		}
		lastStreamErrorRef.current = streamError;
		setWorktreeError(streamError);
	}, [streamError]);

	useEffect(() => {
		if (workspaceVersionRef.current.projectId !== currentProjectId) {
			workspaceRefreshRequestIdRef.current += 1;
			setCanPersistWorkspaceState(false);
			setWorkspaceRevision(null);
			setIsWorkspaceStateRefreshing(false);
			setAppliedWorkspaceProjectId(null);
			workspaceVersionRef.current = {
				projectId: currentProjectId,
				revision: null,
			};
			previousSessionsRef.current = {};
		}
		setWorktreeError(null);
		setSelectedTaskId(null);
		setSelectedTaskWorkspaceInfo(null);
		setIsInlineTaskCreateOpen(false);
		setEditingTaskId(null);
		setIsClearTrashDialogOpen(false);
		setGitSummary(null);
		setRunningGitAction(null);
		setRemovingProjectId(null);
		setIsHomeTerminalStarting(false);
		setHomeTerminalShellBinary(null);
		setIsDetailTerminalOpen(false);
		setIsDetailTerminalStarting(false);
		detailTerminalSelectionKeyRef.current = null;
		setGitActionError(null);
		setWorkspaceSnapshots({});
		reviewWorkspaceSnapshotLoadingRef.current.clear();
		inProgressWorkspaceSnapshotLoadingRef.current.clear();
		reviewWorkspaceSnapshotAttemptedRef.current.clear();
		activeReviewTaskIdsRef.current = new Set();
	}, [currentProjectId]);

	useEffect(() => {
		if (!currentProjectId) {
			return;
		}
		void refreshGitSummary();
	}, [currentProjectId, refreshGitSummary, workspaceRevision]);

	useEffect(() => {
		if (!currentProjectId || selectedCard || workspaceStatusRetrievedAt <= 0 || !isDocumentVisible) {
			return;
		}
		void refreshGitSummary();
	}, [currentProjectId, isDocumentVisible, refreshGitSummary, selectedCard, workspaceStatusRetrievedAt]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!currentProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		const nextPathname = buildProjectPathname(currentProjectId);
		if (nextUrl.pathname === nextPathname) {
			return;
		}
		window.history.replaceState({}, "", `${nextPathname}${nextUrl.search}${nextUrl.hash}`);
	}, [currentProjectId]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!hasNoProjects || !requestedProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		if (nextUrl.pathname !== "/") {
			window.history.replaceState({}, "", `/${nextUrl.search}${nextUrl.hash}`);
		}
		setRequestedProjectId(null);
	}, [hasNoProjects, requestedProjectId]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const handlePopState = () => {
			const nextProjectId = parseProjectIdFromPathname(window.location.pathname);
			setRequestedProjectId(nextProjectId);
		};
		window.addEventListener("popstate", handlePopState);
		return () => {
			window.removeEventListener("popstate", handlePopState);
		};
	}, []);

	useEffect(() => {
		if (!requestedProjectId || !currentProjectId) {
			return;
		}
		const requestedStillExists = projects.some((project) => project.id === requestedProjectId);
		if (requestedStillExists) {
			return;
		}
		setRequestedProjectId(currentProjectId);
	}, [currentProjectId, projects, requestedProjectId]);

	useEffect(() => {
		if (typeof document === "undefined") {
			return;
		}
		const handleVisibilityChange = () => {
			const visible = document.visibilityState === "visible";
			setIsDocumentVisible(visible);
			if (visible) {
				void refreshWorkspaceState();
			}
		};
		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, [refreshWorkspaceState]);

	useEffect(() => {
		// Keep the user's preferred mode sticky across launches.
		// Do not persist temporary local fallback when worktree capability is unavailable.
		if (!canUseWorktree && newTaskWorkspaceMode === "local") {
			return;
		}
		preferredNewTaskWorkspaceModeRef.current = newTaskWorkspaceMode;
		persistTaskWorkspaceMode(newTaskWorkspaceMode);
	}, [canUseWorktree, newTaskWorkspaceMode]);

	useEffect(() => {
		persistTaskStartInPlanMode(newTaskStartInPlanMode);
	}, [newTaskStartInPlanMode]);

	useEffect(() => {
		if (!isWorktreeCapabilityKnown) {
			return;
		}
		if (!canUseWorktree && newTaskWorkspaceMode === "worktree") {
			setNewTaskWorkspaceMode("local");
			return;
		}
		if (
			canUseWorktree &&
			newTaskWorkspaceMode === "local" &&
			preferredNewTaskWorkspaceModeRef.current === "worktree"
		) {
			setNewTaskWorkspaceMode("worktree");
		}
	}, [canUseWorktree, isWorktreeCapabilityKnown, newTaskWorkspaceMode]);

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
		if (!isWorktreeCapabilityKnown) {
			return;
		}
		if (!canUseWorktree) {
			setNewTaskWorkspaceMode("local");
		}
		if (canUseWorktree && !newTaskBranchRef) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef, isInlineTaskCreateOpen, isWorktreeCapabilityKnown, newTaskBranchRef]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		if (!isWorktreeCapabilityKnown) {
			return;
		}
		if (!canUseWorktree && editTaskWorkspaceMode === "worktree") {
			setEditTaskWorkspaceMode("local");
		}
	}, [canUseWorktree, editTaskWorkspaceMode, editingTaskId, isWorktreeCapabilityKnown]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		if (!canUseWorktree) {
			setEditTaskBranchRef("");
			return;
		}
		if (editTaskWorkspaceMode !== "worktree") {
			return;
		}
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === editTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setEditTaskBranchRef(defaultTaskBranchRef);
	}, [
		canUseWorktree,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		editTaskBranchRef,
		editTaskWorkspaceMode,
		editingTaskId,
	]);

	useEffect(() => {
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const selection = findCardSelection(board, editingTaskId);
		if (!selection || selection.column.id !== "backlog") {
			setEditingTaskId(null);
			setEditTaskPrompt("");
			setEditTaskStartInPlanMode(false);
			setEditTaskWorkspaceMode("local");
			setEditTaskBranchRef("");
		}
	}, [board, editingTaskId]);

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
			const key = event.key.toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key === "j") {
				event.preventDefault();
				if (selectedCard) {
					detailTerminalToggleRef.current?.();
					return;
				}
				homeTerminalToggleRef.current?.();
				return;
			}

			const target = event.target as HTMLElement | null;
			const isTypingTarget =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (isTypingTarget) {
				return;
			}

			if ((event.metaKey || event.ctrlKey) && key === "k") {
				event.preventDefault();
				setIsCommandPaletteOpen((current) => !current);
				return;
			}

			if (!event.metaKey && !event.ctrlKey && key === "c") {
				event.preventDefault();
				setEditingTaskId(null);
				setIsInlineTaskCreateOpen(true);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [selectedCard]);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
	}, []);

	const handleSelectProject = useCallback((projectId: string) => {
		if (!projectId || projectId === currentProjectId) {
			return;
		}
		setCanPersistWorkspaceState(false);
		setRequestedProjectId(projectId);
		setSelectedTaskId(null);
		setIsInlineTaskCreateOpen(false);
		setEditingTaskId(null);
	}, [currentProjectId]);

	const handleAddProject = useCallback(async () => {
		try {
			const pickResponse = await workspaceFetch("/api/projects/pick-directory", {
				method: "POST",
				workspaceId: currentProjectId,
			});
			const picked = (await pickResponse.json().catch(() => null)) as RuntimeProjectDirectoryPickerResponse | null;
			if (!pickResponse.ok || !picked?.ok || !picked.path) {
				if (picked?.error && picked.error !== "No directory was selected.") {
					throw new Error(picked.error);
				}
				return;
			}

			const addResponse = await workspaceFetch("/api/projects/add", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					path: picked.path,
				}),
				workspaceId: currentProjectId,
			});
			const added = (await addResponse.json().catch(() => null)) as RuntimeProjectAddResponse | null;
			if (!addResponse.ok || !added?.ok || !added.project) {
				throw new Error(added?.error ?? `Could not add project (${addResponse.status}).`);
			}
			if (!currentProjectId) {
				setCanPersistWorkspaceState(false);
				setRequestedProjectId(added.project.id);
				setSelectedTaskId(null);
				setIsInlineTaskCreateOpen(false);
				setEditingTaskId(null);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
		}
	}, [currentProjectId]);

	const handleRemoveProject = useCallback(
		async (projectId: string): Promise<boolean> => {
			if (removingProjectId) {
				return false;
			}
			setRemovingProjectId(projectId);
			try {
				const response = await workspaceFetch("/api/projects/remove", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ projectId }),
					workspaceId: currentProjectId,
				});
				const payload = (await response.json().catch(() => null)) as RuntimeProjectRemoveResponse | null;
				if (!response.ok || !payload?.ok) {
					throw new Error(payload?.error ?? `Could not remove project (${response.status}).`);
				}
				if (currentProjectId === projectId) {
					setCanPersistWorkspaceState(false);
					setRequestedProjectId(null);
					setSelectedTaskId(null);
					setIsInlineTaskCreateOpen(false);
					setEditingTaskId(null);
				}
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
				return false;
			} finally {
				setRemovingProjectId((current) => (current === projectId ? null : current));
			}
		},
		[currentProjectId, removingProjectId],
	);

	const startHomeTerminalSession = useCallback(async (): Promise<boolean> => {
		if (!currentProjectId) {
			return false;
		}
		setIsHomeTerminalStarting(true);
		try {
			const response = await workspaceFetch("/api/runtime/shell-session/start", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					taskId: HOME_TERMINAL_TASK_ID,
					rows: HOME_TERMINAL_ROWS,
				}),
				workspaceId: currentProjectId,
			});
			const payload = (await response.json().catch(() => null)) as RuntimeShellSessionStartResponse | null;
			if (!response.ok || !payload?.ok || !payload.summary) {
				throw new Error(payload?.error ?? `Could not start terminal session (${response.status}).`);
			}
			upsertSession(payload.summary);
			setHomeTerminalShellBinary(
				typeof payload.shellBinary === "string" && payload.shellBinary.trim() ? payload.shellBinary : null,
			);
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWorktreeError(message);
			return false;
		} finally {
			setIsHomeTerminalStarting(false);
		}
	}, [currentProjectId, upsertSession]);

	const handleToggleHomeTerminal = useCallback(() => {
		if (isHomeTerminalOpen) {
			setIsHomeTerminalOpen(false);
			homeTerminalProjectIdRef.current = null;
			return;
		}
		if (!currentProjectId) {
			return;
		}
		homeTerminalProjectIdRef.current = currentProjectId;
		setIsHomeTerminalOpen(true);
		void startHomeTerminalSession();
	}, [currentProjectId, isHomeTerminalOpen, startHomeTerminalSession]);

	const startDetailTerminalForCard = useCallback(
		async (card: BoardCard, options?: { showLoading?: boolean }): Promise<boolean> => {
			if (!currentProjectId) {
				return false;
			}
			const showLoading = options?.showLoading ?? false;
			if (showLoading) {
				setIsDetailTerminalStarting(true);
			}
			try {
				const targetTaskId = getDetailTerminalTaskId(card);
				if (targetTaskId === HOME_TERMINAL_TASK_ID) {
					return await startHomeTerminalSession();
				}
				const response = await workspaceFetch("/api/runtime/shell-session/start", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						taskId: targetTaskId,
						rows: HOME_TERMINAL_ROWS,
						workspaceTaskId: card.id,
						baseRef: card.baseRef ?? null,
					}),
					workspaceId: currentProjectId,
				});
				const payload = (await response.json().catch(() => null)) as RuntimeShellSessionStartResponse | null;
				if (!response.ok || !payload?.ok || !payload.summary) {
					throw new Error(payload?.error ?? `Could not start detail terminal session (${response.status}).`);
				}
				upsertSession(payload.summary);
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
				return false;
			} finally {
				if (showLoading) {
					setIsDetailTerminalStarting(false);
				}
			}
		},
		[currentProjectId, startHomeTerminalSession, upsertSession],
	);

	const handleToggleDetailTerminal = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		if (isDetailTerminalOpen) {
			setIsDetailTerminalOpen(false);
			detailTerminalSelectionKeyRef.current = null;
			return;
		}
		setIsDetailTerminalOpen(true);
		void (async () => {
			const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef ?? ""}`;
			detailTerminalSelectionKeyRef.current = selectionKey;
			const started = await startDetailTerminalForCard(selectedCard.card, { showLoading: true });
			if (!started) {
				if (detailTerminalSelectionKeyRef.current === selectionKey) {
					detailTerminalSelectionKeyRef.current = null;
				}
				return;
			}
		})();
	}, [isDetailTerminalOpen, selectedCard, startDetailTerminalForCard]);

	useEffect(() => {
		if (!isDetailTerminalOpen || !selectedCard) {
			detailTerminalSelectionKeyRef.current = null;
			return;
		}
		const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef ?? ""}`;
		if (detailTerminalSelectionKeyRef.current === selectionKey) {
			return;
		}
		detailTerminalSelectionKeyRef.current = selectionKey;
		void startDetailTerminalForCard(selectedCard.card);
	}, [
		isDetailTerminalOpen,
		selectedCard?.card.baseRef,
		selectedCard?.card.id,
		startDetailTerminalForCard,
	]);

	useEffect(() => {
		homeTerminalToggleRef.current = handleToggleHomeTerminal;
		return () => {
			if (homeTerminalToggleRef.current === handleToggleHomeTerminal) {
				homeTerminalToggleRef.current = null;
			}
		};
	}, [handleToggleHomeTerminal]);

	useEffect(() => {
		detailTerminalToggleRef.current = handleToggleDetailTerminal;
		return () => {
			if (detailTerminalToggleRef.current === handleToggleDetailTerminal) {
				detailTerminalToggleRef.current = null;
			}
		};
	}, [handleToggleDetailTerminal]);

	useEffect(() => {
		if (!isHomeTerminalOpen) {
			homeTerminalProjectIdRef.current = null;
			return;
		}
		if (!currentProjectId || homeTerminalProjectIdRef.current === currentProjectId) {
			return;
		}
		homeTerminalProjectIdRef.current = currentProjectId;
		void (async () => {
			const started = await startHomeTerminalSession();
			if (!started) {
				homeTerminalProjectIdRef.current = null;
				setIsHomeTerminalOpen(false);
			}
		})();
	}, [currentProjectId, isHomeTerminalOpen, startHomeTerminalSession]);

	const handleOpenCreateTask = useCallback(() => {
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setIsInlineTaskCreateOpen(true);
	}, []);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setNewTaskPrompt("");
		if (canUseWorktree) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [canUseWorktree, defaultTaskBranchRef]);

	const handleOpenEditTask = useCallback(
		(task: BoardCard) => {
			setSelectedTaskId(null);
			setSelectedTaskWorkspaceInfo(null);
			setIsInlineTaskCreateOpen(false);
			setNewTaskPrompt("");
			const taskPrompt = task.prompt.trim() || [task.title, task.description].filter(Boolean).join("\n\n");
			setEditingTaskId(task.id);
			setEditTaskPrompt(taskPrompt);
			setEditTaskStartInPlanMode(task.startInPlanMode);
			const taskMode: TaskWorkspaceMode = task.baseRef && canUseWorktree ? "worktree" : "local";
			setEditTaskWorkspaceMode(taskMode);
			const fallbackBranch = task.baseRef ?? defaultTaskBranchRef;
			setEditTaskBranchRef(fallbackBranch);
		},
		[canUseWorktree, defaultTaskBranchRef],
	);

	const handleCancelEditTask = useCallback(() => {
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
		setEditTaskWorkspaceMode("local");
		setEditTaskBranchRef("");
	}, []);

	const handleSaveEditedTask = useCallback(() => {
		if (!editingTaskId) {
			return;
		}
		const prompt = editTaskPrompt.trim();
		if (!prompt) {
			return;
		}
		if (editTaskWorkspaceMode === "worktree" && (!canUseWorktree || !(editTaskBranchRef || defaultTaskBranchRef))) {
			return;
		}

		const parsedPrompt = splitPromptToTitleDescription(prompt);
		const title = parsedPrompt.title.trim();
		if (!title) {
			return;
		}

		const baseRef =
			editTaskWorkspaceMode === "worktree" && canUseWorktree
				? (editTaskBranchRef || defaultTaskBranchRef || null)
				: null;

		setBoard((currentBoard) => {
			const updated = updateTask(currentBoard, editingTaskId, {
				title,
				description: parsedPrompt.description,
				prompt,
				startInPlanMode: editTaskStartInPlanMode,
				baseRef,
			});
			return updated.updated ? updated.board : currentBoard;
		});
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setWorktreeError(null);
	}, [
		canUseWorktree,
		defaultTaskBranchRef,
		editTaskBranchRef,
		editTaskPrompt,
		editTaskStartInPlanMode,
		editTaskWorkspaceMode,
		editingTaskId,
	]);

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
				const response = await workspaceFetch("/api/runtime/shortcut/run", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						command: shortcut.command,
					}),
					workspaceId: currentProjectId,
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
		[currentProjectId, runtimeProjectConfig?.shortcuts],
	);

	const kickoffTaskInProgress = useCallback(
		async (task: BoardCard, taskId: string, fromColumnId: BoardColumnId) => {
			const ensured = await ensureTaskWorkspace(task);
			if (!ensured.ok) {
				setWorktreeError(ensured.message ?? "Could not set up task workspace.");
				setBoard((currentBoard) => {
					const currentColumnId = getTaskColumnId(currentBoard, taskId);
					if (currentColumnId !== "in_progress") {
						return currentBoard;
					}
					const reverted = moveTaskToColumn(currentBoard, taskId, fromColumnId);
					return reverted.moved ? reverted.board : currentBoard;
				});
				return;
			}
			const started = await startTaskSession(task);
			if (!started.ok) {
				setWorktreeError(started.message ?? "Could not start task session.");
				setBoard((currentBoard) => {
					const currentColumnId = getTaskColumnId(currentBoard, taskId);
					if (currentColumnId !== "in_progress") {
						return currentBoard;
					}
					const reverted = moveTaskToColumn(currentBoard, taskId, fromColumnId);
					return reverted.moved ? reverted.board : currentBoard;
				});
				return;
			}
			setWorktreeError(null);
		},
		[ensureTaskWorkspace, startTaskSession],
	);

	const handleDragEnd = useCallback(
		(result: DropResult, options?: { selectDroppedTask?: boolean }) => {
			if (options?.selectDroppedTask && result.type.startsWith("CARD") && result.destination) {
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
					void kickoffTaskInProgress(movedSelection.card, moveEvent.taskId, moveEvent.fromColumnId);
				}
			}
		},
		[board, kickoffTaskInProgress, requestMoveTaskToTrash],
	);

	const handleStartTask = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "backlog") {
				return;
			}
			const moved = moveTaskToColumn(board, taskId, "in_progress");
			if (!moved.moved) {
				return;
			}
			setBoard(moved.board);
			const movedSelection = findCardSelection(moved.board, taskId);
			if (movedSelection) {
				void kickoffTaskInProgress(movedSelection.card, taskId, "backlog");
			}
		},
		[board, kickoffTaskInProgress],
	);

	const handleDetailTaskDragEnd = useCallback(
		(result: DropResult) => {
			handleDragEnd(result);
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
	const handleMoveReviewCardToTrash = useCallback(
		(taskId: string) => {
			void requestMoveTaskToTrash(taskId, "review");
		},
		[requestMoveTaskToTrash],
	);
	const handleOpenClearTrash = useCallback(() => {
		if (trashTaskCount === 0) {
			return;
		}
		setIsClearTrashDialogOpen(true);
	}, [trashTaskCount]);
	const handleConfirmClearTrash = useCallback(() => {
		const taskIds = [...trashTaskIds];
		setIsClearTrashDialogOpen(false);
		if (taskIds.length === 0) {
			return;
		}

		setBoard((currentBoard) => clearColumnTasks(currentBoard, "trash").board);
		setSessions((currentSessions) => {
			const nextSessions = { ...currentSessions };
			for (const taskId of taskIds) {
				delete nextSessions[taskId];
			}
			return nextSessions;
		});
		setPendingTrashWarning((currentWarning) =>
			currentWarning && taskIds.includes(currentWarning.taskId) ? null : currentWarning,
		);
		if (selectedTaskId && taskIds.includes(selectedTaskId)) {
			setSelectedTaskId(null);
			setSelectedTaskWorkspaceInfo(null);
		}

		void (async () => {
			await Promise.all(
				taskIds.map(async (taskId) => {
					await stopTaskSession(taskId);
					await cleanupTaskWorkspace(taskId);
				}),
			);
		})();
	}, [cleanupTaskWorkspace, selectedTaskId, stopTaskSession, trashTaskIds]);

	const detailSession = selectedCard ? sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id) : null;
	const detailShellTaskId = selectedCard ? getDetailTerminalTaskId(selectedCard.card) : null;
	const detailShellSummary = detailShellTaskId ? sessions[detailShellTaskId] ?? null : null;
	const detailShellSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		if (!selectedCard.card.baseRef) {
			return homeTerminalShellBinary;
		}
		return selectedTaskWorkspaceInfo?.path ?? null;
	}, [homeTerminalShellBinary, selectedCard, selectedTaskWorkspaceInfo?.path]);
	const runtimeHint = useMemo(() => {
		if (shouldUseNavigationPath || !runtimeProjectConfig) {
			return undefined;
		}
		if (runtimeProjectConfig?.effectiveCommand) {
			return undefined;
		}
		const detected = runtimeProjectConfig?.detectedCommands?.join(", ");
		if (detected) {
			return `No agent configured (${detected})`;
		}
		return "No agent configured";
	}, [runtimeProjectConfig, shouldUseNavigationPath]);
	const repoHint = useMemo(() => {
		if (shouldUseNavigationPath) {
			return undefined;
		}
		if (!workspaceGit || workspaceGit.hasGit) {
			return undefined;
		}
		return "No git detected, worktree isolation disabled";
	}, [shouldUseNavigationPath, workspaceGit]);
	const activeWorkspacePath =
		selectedCard
			? selectedTaskWorkspaceInfo?.path ?? workspacePath ?? undefined
			: shouldUseNavigationPath
				? navigationProjectPath ?? undefined
				: workspacePath ?? undefined;
	const {
		openTargetOptions,
		selectedOpenTargetId,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	} = useOpenWorkspace({
		currentProjectId,
		workspacePath: activeWorkspacePath,
	});
	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard || !selectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (selectedTaskWorkspaceInfo.mode === "local") {
			if (!selectedTaskWorkspaceInfo.hasGit) {
				return "Local workspace (no git)";
			}
			return undefined;
		}
		if (selectedTaskWorkspaceInfo.deleted) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		if (!selectedTaskWorkspaceInfo.hasGit) {
			return "Worktree (no git)";
		}
		return undefined;
	}, [selectedCard, selectedTaskWorkspaceInfo]);
	const navbarWorkspacePath = hasNoProjects ? undefined : activeWorkspacePath;
	const navbarWorkspaceHint = hasNoProjects ? undefined : activeWorkspaceHint;
	const navbarRepoHint = hasNoProjects ? undefined : repoHint;
	const navbarRuntimeHint = hasNoProjects ? undefined : runtimeHint;
	const navbarGitSummary = hasNoProjects || selectedCard ? null : gitSummary;
	const navbarTaskGitSummary = useMemo((): TopBarTaskGitSummary | null => {
		if (hasNoProjects || !selectedCard) {
			return null;
		}
		const snapshot = workspaceSnapshots[selectedCard.card.id];
		const hasTaskGit = Boolean(selectedTaskWorkspaceInfo?.hasGit || snapshot?.hasGit);
		if (!hasTaskGit) {
			return null;
		}
		const mode = selectedTaskWorkspaceInfo?.mode ?? snapshot?.mode;
		return {
			hasGit: true,
			branch: selectedTaskWorkspaceInfo?.branch ?? snapshot?.branch ?? null,
			headCommit: selectedTaskWorkspaceInfo?.headCommit ?? snapshot?.headCommit ?? null,
			changedFiles: snapshot?.changedFiles ?? 0,
			additions: snapshot?.additions ?? 0,
			deletions: snapshot?.deletions ?? 0,
			scopeLabel: mode === "local" ? "Local" : mode === "worktree" ? "Worktree" : null,
		};
	}, [hasNoProjects, selectedCard, selectedTaskWorkspaceInfo, workspaceSnapshots]);
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
	const gitActionErrorTitle = useMemo(() => {
		if (!gitActionError) {
			return "Git action failed";
		}
		if (gitActionError.action === "fetch") {
			return "Fetch failed";
		}
		if (gitActionError.action === "pull") {
			return "Pull failed";
		}
		return "Push failed";
	}, [gitActionError]);
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
			workspaceId={currentProjectId}
			workspaceCurrentBranch={workspaceGit?.currentBranch ?? null}
			canUseWorktree={canUseWorktree}
			branchRef={newTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setNewTaskBranchRef}
			disallowedSlashCommands={[...DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS]}
			mode="create"
			idPrefix="inline-create-task"
		/>
	) : undefined;
	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			onCreate={handleSaveEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			workspaceMode={editTaskWorkspaceMode}
			onWorkspaceModeChange={setEditTaskWorkspaceMode}
			workspaceId={currentProjectId}
			workspaceCurrentBranch={workspaceGit?.currentBranch ?? null}
			canUseWorktree={canUseWorktree}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			disallowedSlashCommands={[...DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS]}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	if (isRuntimeDisconnected) {
		return (
			<div
				className={Classes.DARK}
				style={{
					display: "flex",
					height: "100svh",
					alignItems: "center",
					justifyContent: "center",
					background: Colors.DARK_GRAY1,
					padding: "24px",
				}}
			>
					<NonIdealState
						icon={<span style={{ fontSize: "72px", lineHeight: 1 }}>🍌</span>}
						title="Disconnected from kanbanana"
						description="Run kanbanana again in your terminal, then reload this tab."
					/>
				</div>
			);
		}

	return (
		<div className={Classes.DARK} style={{ display: "flex", flexDirection: "row", height: "100svh", minWidth: 0, overflow: "hidden" }}>
				{!selectedCard ? (
					<ProjectNavigationPanel
						projects={displayedProjects}
						isLoadingProjects={isProjectListLoading}
						currentProjectId={navigationCurrentProjectId}
						removingProjectId={removingProjectId}
						onSelectProject={(projectId) => {
							void handleSelectProject(projectId);
						}}
						onRemoveProject={handleRemoveProject}
						onAddProject={() => {
							void handleAddProject();
						}}
					/>
				) : null}
			<div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
				<TopBar
					onBack={selectedCard ? handleBack : undefined}
					workspacePath={navbarWorkspacePath}
					isWorkspacePathLoading={shouldShowProjectLoadingState}
					workspaceHint={navbarWorkspaceHint}
					repoHint={navbarRepoHint}
					runtimeHint={navbarRuntimeHint}
					gitSummary={navbarGitSummary}
					taskGitSummary={navbarTaskGitSummary}
					runningGitAction={selectedCard || hasNoProjects ? null : runningGitAction}
					onGitFetch={
						selectedCard
							? undefined
							: () => {
									void runGitAction("fetch");
								}
					}
					onGitPull={
						selectedCard
							? undefined
							: () => {
									void runGitAction("pull");
								}
					}
					onGitPush={
						selectedCard
							? undefined
							: () => {
									void runGitAction("push");
								}
					}
					onToggleTerminal={selectedCard ? handleToggleDetailTerminal : handleToggleHomeTerminal}
					isTerminalOpen={selectedCard ? isDetailTerminalOpen : isHomeTerminalOpen}
					isTerminalLoading={selectedCard ? isDetailTerminalStarting : isHomeTerminalStarting}
					onOpenSettings={() => setIsSettingsOpen(true)}
					shortcuts={runtimeProjectConfig?.shortcuts ?? []}
					runningShortcutId={runningShortcutId}
					onRunShortcut={handleRunShortcut}
					openTargetOptions={openTargetOptions}
					selectedOpenTargetId={selectedOpenTargetId}
					onSelectOpenTarget={onSelectOpenTarget}
					onOpenWorkspace={onOpenWorkspace}
					canOpenWorkspace={canOpenWorkspace}
					isOpeningWorkspace={isOpeningWorkspace}
				/>
					<RuntimeStatusBanners
						worktreeError={worktreeError}
						onDismissWorktreeError={() => setWorktreeError(null)}
						shortcutOutput={lastShortcutOutput}
						onClearShortcutOutput={() => setLastShortcutOutput(null)}
					/>
					<div style={{ position: "relative", display: "flex", flex: "1 1 0", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
						<div
							className="kb-home-layout"
							aria-hidden={selectedCard ? true : undefined}
							style={
								selectedCard
									? {
											visibility: "hidden",
									  }
									: undefined
							}
						>
							{shouldShowProjectLoadingState ? (
								<div
									style={{
										display: "flex",
										flex: "1 1 0",
										minHeight: 0,
										alignItems: "center",
										justifyContent: "center",
										background: Colors.DARK_GRAY1,
									}}
								>
									<Spinner size={30} />
								</div>
							) : (
								hasNoProjects ? (
									<div
										style={{
											display: "flex",
											flex: "1 1 0",
											minHeight: 0,
											alignItems: "center",
											justifyContent: "center",
											background: Colors.DARK_GRAY1,
											padding: "calc(var(--bp-surface-spacing) * 6)",
										}}
									>
										<NonIdealState
											icon="folder-open"
											title="No projects yet"
											description="Add a repository to start using Kanbanana."
											action={
												<Button
													intent="primary"
													text="Add project"
													onClick={() => {
														void handleAddProject();
													}}
												/>
											}
										/>
									</div>
								) : (
								<div style={{ display: "flex", flex: "1 1 0", flexDirection: "column", minHeight: 0, minWidth: 0 }}>
									<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, minWidth: 0 }}>
										<KanbanBoard
											data={board}
											taskSessions={sessions}
											onCardSelect={handleCardSelect}
											onCreateTask={handleOpenCreateTask}
											onStartTask={handleStartTask}
											onClearTrash={handleOpenClearTrash}
											inlineTaskCreator={inlineTaskCreator}
											editingTaskId={editingTaskId}
											inlineTaskEditor={inlineTaskEditor}
											onEditTask={handleOpenEditTask}
											onCommitTask={() => {}}
											onOpenPrTask={() => {}}
											onMoveToTrashTask={handleMoveReviewCardToTrash}
											reviewWorkspaceSnapshots={workspaceSnapshots}
											onDragEnd={handleDragEnd}
										/>
									</div>
									{isHomeTerminalOpen ? (
										<ResizableBottomPane>
											<div
												style={{
													display: "flex",
													flex: "1 1 0",
													minWidth: 0,
													paddingLeft: "calc(var(--bp-surface-spacing) * 3)",
													paddingRight: "calc(var(--bp-surface-spacing) * 3)",
												}}
											>
												<AgentTerminalPanel
													key={`${currentProjectId ?? "none"}:${HOME_TERMINAL_TASK_ID}`}
													taskId={HOME_TERMINAL_TASK_ID}
													workspaceId={currentProjectId}
													summary={homeTerminalSummary}
													onSummary={upsertSession}
													showSessionToolbar={false}
													onClose={() => setIsHomeTerminalOpen(false)}
													autoFocus
													minimalHeaderTitle="Terminal"
													minimalHeaderSubtitle={homeTerminalShellBinary}
													panelBackgroundColor={Colors.DARK_GRAY2}
													terminalBackgroundColor={Colors.DARK_GRAY2}
													cursorColor={Colors.LIGHT_GRAY5}
													showRightBorder={false}
													isVisible={!selectedCard}
												/>
											</div>
										</ResizableBottomPane>
									) : null}
								</div>
								)
							)}
						</div>
						{selectedCard && detailSession ? (
							<div style={{ position: "absolute", inset: 0, display: "flex", minHeight: 0, minWidth: 0 }}>
								<CardDetailView
									selection={selectedCard}
									currentProjectId={currentProjectId}
									sessionSummary={detailSession}
									taskSessions={sessions}
									workspaceStatusRetrievedAt={workspaceStatusRetrievedAt}
									onSessionSummary={upsertSession}
									onBack={handleBack}
									onCardSelect={handleCardSelect}
									onTaskDragEnd={handleDetailTaskDragEnd}
									onCreateTask={handleOpenCreateTask}
									onStartTask={handleStartTask}
									onClearTrash={handleOpenClearTrash}
									inlineTaskCreator={inlineTaskCreator}
									editingTaskId={editingTaskId}
									inlineTaskEditor={inlineTaskEditor}
									onEditTask={handleOpenEditTask}
									onCommitTask={() => {}}
									onOpenPrTask={() => {}}
									onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
									reviewWorkspaceSnapshots={workspaceSnapshots}
									onMoveToTrash={handleMoveToTrash}
									bottomTerminalOpen={isDetailTerminalOpen}
									bottomTerminalTaskId={detailShellTaskId}
									bottomTerminalSummary={detailShellSummary}
									bottomTerminalSubtitle={detailShellSubtitle}
									onBottomTerminalClose={() => setIsDetailTerminalOpen(false)}
								/>
							</div>
						) : null}
					</div>
			</div>
				<RuntimeSettingsDialog
					open={isSettingsOpen}
					workspaceId={currentProjectId}
					onOpenChange={setIsSettingsOpen}
					onSaved={() => {
						setRuntimeProjectConfigRefreshNonce((current) => current + 1);
					}}
				/>
			<Omnibar<SearchableTask>
				isOpen={isCommandPaletteOpen}
				onClose={() => setIsCommandPaletteOpen(false)}
				items={searchableTasks}
				itemPredicate={filterTask}
				itemRenderer={renderTask}
				onItemSelect={(task) => {
					setSelectedTaskId(task.id);
					setIsCommandPaletteOpen(false);
				}}
				noResults={<MenuItem disabled text="No tasks found." roleStructure="listoption" />}
				resetOnSelect
			/>
			<ClearTrashDialog
				open={isClearTrashDialogOpen}
				taskCount={trashTaskCount}
				onCancel={() => setIsClearTrashDialogOpen(false)}
				onConfirm={handleConfirmClearTrash}
			/>
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
			<Alert
				isOpen={gitActionError !== null}
				canEscapeKeyCancel
				canOutsideClickCancel
				confirmButtonText="Close"
				icon="warning-sign"
				intent="danger"
				onCancel={() => setGitActionError(null)}
				onConfirm={() => setGitActionError(null)}
			>
				<p>{gitActionErrorTitle}</p>
				<p>{gitActionError?.message}</p>
				{gitActionError?.output ? (
					<Pre style={{ maxHeight: 220, overflow: "auto" }}>
						{gitActionError.output}
					</Pre>
				) : null}
			</Alert>
		</div>
	);
}
