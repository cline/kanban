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
	parseProjectIdFromPathname,
	renderTask,
	TASK_START_IN_PLAN_MODE_STORAGE_KEY,
	type SearchableTask,
} from "@/kanban/app/app-utils";
import { useDocumentVisibility } from "@/kanban/app/use-document-visibility";
import { useReviewReadyNotifications } from "@/kanban/app/use-review-ready-notifications";
import { useTaskWorkspaceSnapshots } from "@/kanban/app/use-task-workspace-snapshots";
import { useOpenWorkspace } from "@/kanban/app/use-open-workspace";
import { showAppToast } from "@/kanban/components/app-toaster";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { ClearTrashDialog } from "@/kanban/components/clear-trash-dialog";
import { AgentTerminalPanel } from "@/kanban/components/detail-panels/agent-terminal-panel";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { ProjectNavigationPanel } from "@/kanban/components/project-navigation-panel";
import { ResizableBottomPane } from "@/kanban/components/resizable-bottom-pane";
import { RuntimeStatusBanners } from "@/kanban/components/runtime-status-banners";
import {
	RuntimeSettingsDialog,
	type RuntimeSettingsSection,
} from "@/kanban/components/runtime-settings-dialog";
import { TaskInlineCreateCard } from "@/kanban/components/task-inline-create-card";
import { TaskTrashWarningDialog } from "@/kanban/components/task-trash-warning-dialog";
import { TopBar, type TopBarTaskGitSummary } from "@/kanban/components/top-bar";
import { createInitialBoardData } from "@/kanban/data/board-data";
import {
	buildTaskGitActionPrompt,
	type TaskGitAction,
} from "@/kanban/git-actions/build-task-git-action-prompt";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import { useRuntimeStateStream } from "@/kanban/runtime/use-runtime-state-stream";
import { useTerminalConnectionReady } from "@/kanban/runtime/use-terminal-connection-ready";
import { saveRuntimeConfig } from "@/kanban/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/kanban/runtime/trpc-client";
import {
	fetchWorkspaceState,
	saveWorkspaceState,
} from "@/kanban/runtime/workspace-state-query";
import { useWorkspacePersistence } from "@/kanban/runtime/use-workspace-persistence";
import {
	DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS,
	splitPromptToTitleDescription,
} from "@/kanban/utils/task-prompt";
import {
	trackTaskCreated,
} from "@/kanban/telemetry/events";
import {
	useBooleanLocalStorageValue,
	useWindowEvent,
} from "@/kanban/hooks/react-use";
import {
	getBrowserNotificationPermission,
	hasPromptedForBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/kanban/utils/notification-permission";
import type {
	RuntimeGitRepositoryInfo,
	RuntimeGitSyncAction,
	RuntimeGitSyncSummary,
	RuntimeWorkspaceStateResponse,
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

type TaskGitActionSource = "card" | "agent";

interface TaskGitActionLoadingState {
	commitSource: TaskGitActionSource | null;
	prSource: TaskGitActionSource | null;
}

const REMOVED_PROJECT_ERROR_PREFIX = "Project no longer exists on disk and was removed:";
const HOME_TERMINAL_TASK_ID = "__home_terminal__";
const HOME_TERMINAL_ROWS = 16;
const DETAIL_TERMINAL_TASK_PREFIX = "__detail_terminal__:";

function getDetailTerminalTaskId(card: BoardCard): string {
	return `${DETAIL_TERMINAL_TASK_PREFIX}${card.id}`;
}

function matchesWorkspaceInfoSelection(
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null,
	card: BoardCard | null,
): workspaceInfo is RuntimeTaskWorkspaceInfoResponse {
	if (!workspaceInfo || !card) {
		return false;
	}
	return workspaceInfo.taskId === card.id && workspaceInfo.baseRef === card.baseRef;
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
	const notificationPermissionPromptInFlightRef = useRef(false);
	const lastStreamErrorRef = useRef<string | null>(null);
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] =
		useState<RuntimeTaskWorkspaceInfoResponse | null>(null);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskPrompt, setNewTaskPrompt] = useState("");
	const [newTaskStartInPlanMode, setNewTaskStartInPlanMode] = useBooleanLocalStorageValue(
		TASK_START_IN_PLAN_MODE_STORAGE_KEY,
		false,
	);
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [lastCreatedTaskBranchByProjectId, setLastCreatedTaskBranchByProjectId] = useState<Record<string, string>>(
		{},
	);
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [editTaskPrompt, setEditTaskPrompt] = useState("");
	const [editTaskStartInPlanMode, setEditTaskStartInPlanMode] = useState(false);
	const [editTaskBranchRef, setEditTaskBranchRef] = useState("");
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [gitSummary, setGitSummary] = useState<RuntimeGitSyncSummary | null>(null);
	const [runningGitAction, setRunningGitAction] = useState<RuntimeGitSyncAction | null>(null);
	const [taskGitActionLoadingByTaskId, setTaskGitActionLoadingByTaskId] =
		useState<Record<string, TaskGitActionLoadingState>>({});
	const [isSwitchingHomeBranch, setIsSwitchingHomeBranch] = useState(false);
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
	const [homeTerminalPaneHeight, setHomeTerminalPaneHeight] = useState<number | undefined>(
		undefined,
	);
	const [isDetailTerminalOpen, setIsDetailTerminalOpen] = useState(false);
	const [isDetailTerminalStarting, setIsDetailTerminalStarting] = useState(false);
	const [detailTerminalPaneHeight, setDetailTerminalPaneHeight] = useState<number | undefined>(
		undefined,
	);
	const [requestedProjectId, setRequestedProjectId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseProjectIdFromPathname(window.location.pathname);
	});
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceStatusRetrievedAt,
		latestTaskReadyForReview,
		streamError,
		hasReceivedSnapshot,
	} = useRuntimeStateStream(requestedProjectId);
	const navigationCurrentProjectId = requestedProjectId ?? currentProjectId;
	const activeNotificationWorkspaceId = navigationCurrentProjectId;
	const isDocumentVisible = useDocumentVisibility();
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
	const { config: runtimeProjectConfig, refresh: refreshRuntimeProjectConfig } =
		useRuntimeProjectConfig(currentProjectId);
	const { markConnectionReady: markTerminalConnectionReady, prepareWaitForConnection: prepareWaitForTerminalConnectionReady } =
		useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled =
		runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});
	const shortcuts = runtimeProjectConfig?.shortcuts ?? [];
	const selectedShortcutId = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeProjectConfig?.selectedShortcutId ?? null;
		if (configured && shortcuts.some((shortcut) => shortcut.id === configured)) {
			return configured;
		}
		return shortcuts[0]?.id ?? null;
	}, [runtimeProjectConfig?.selectedShortcutId, shortcuts]);
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
				resetWorkspaceSnapshots();
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
				if (!isSameProject) {
					resetWorkspaceSnapshots();
				}
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

	const ensureTaskWorkspace = useCallback(async (task: BoardCard): Promise<{
		ok: boolean;
		message?: string;
		response?: Extract<RuntimeWorktreeEnsureResponse, { ok: true }>;
	}> => {
		if (!currentProjectId) {
			return { ok: false, message: "No project selected." };
		}
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.ensureWorktree.mutate({
				taskId: task.id,
				baseRef: task.baseRef,
			});
			if (!payload.ok) {
				return {
					ok: false,
					message: payload.error ?? "Worktree setup failed.",
				};
			}
			return { ok: true, response: payload };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, [currentProjectId]);

	const startTaskSession = useCallback(async (task: BoardCard): Promise<{ ok: boolean; message?: string }> => {
		if (!currentProjectId) {
			return { ok: false, message: "No project selected." };
		}
		try {
			const kickoffPrompt = task.prompt.trim() || task.description.trim() || task.title;
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.runtime.startTaskSession.mutate({
				taskId: task.id,
				prompt: kickoffPrompt,
				startInPlanMode: task.startInPlanMode,
				baseRef: task.baseRef,
			});
			if (!payload.ok || !payload.summary) {
				return {
					ok: false,
					message: payload.error ?? "Task session start failed.",
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
		if (!currentProjectId) {
			return;
		}
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			await trpcClient.runtime.stopTaskSession.mutate({ taskId });
		} catch {
			// Ignore stop errors during cleanup.
		}
	}, [currentProjectId]);

	const sendTaskSessionInput = useCallback(async (
		taskId: string,
		text: string,
		options?: {
			appendNewline?: boolean;
		},
	): Promise<{ ok: boolean; message?: string }> => {
		if (!currentProjectId) {
			return { ok: false, message: "No project selected." };
		}
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.runtime.sendTaskSessionInput.mutate({
				taskId,
				text,
				appendNewline: options?.appendNewline ?? true,
			});
			if (!payload.ok) {
				const errorMessage = payload.error || "Task session input failed.";
				return { ok: false, message: errorMessage };
			}
			if (payload.summary) {
				upsertSession(payload.summary);
			}
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { ok: false, message };
		}
	}, [currentProjectId, upsertSession]);

	const cleanupTaskWorkspace = useCallback(async (
		taskId: string,
	): Promise<RuntimeWorktreeDeleteResponse | null> => {
		if (!currentProjectId) {
			return null;
		}
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.deleteWorktree.mutate({ taskId });
			if (!payload.ok) {
				const message = payload.error ?? "Could not clean up task workspace.";
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
			if (!currentProjectId) {
				return null;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				return await trpcClient.workspace.getTaskContext.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setWorktreeError(message);
				return null;
			}
		},
		[currentProjectId],
	);

	const fetchTaskWorkingChangeCount = useCallback(async (
		task: BoardCard,
	): Promise<number | null> => {
		if (!currentProjectId) {
			return null;
		}
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.getGitSummary.query({
				taskId: task.id,
				baseRef: task.baseRef,
			});
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
			params.set("baseRef", task.baseRef);

			let workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				workspaceInfo = await trpcClient.workspace.getTaskContext.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
			} catch {
				return null;
			}

			let changedFiles: number | null = null;
			let additions: number | null = null;
			let deletions: number | null = null;
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const summaryPayload = await trpcClient.workspace.getGitSummary.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
				if (summaryPayload.ok) {
					changedFiles = summaryPayload.summary.changedFiles;
					additions = summaryPayload.summary.additions;
					deletions = summaryPayload.summary.deletions;
				}
			} catch {
				// Swallow errors: this snapshot is informational and should never block review cards.
			}

			return {
				taskId: task.id,
				path: workspaceInfo.path,
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
	const activeSelectedTaskWorkspaceInfo = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return matchesWorkspaceInfoSelection(selectedTaskWorkspaceInfo, selectedCard.card)
			? selectedTaskWorkspaceInfo
			: null;
	}, [selectedCard, selectedTaskWorkspaceInfo]);
	const reviewCards = useMemo(() => {
		return board.columns.find((column) => column.id === "review")?.cards ?? [];
	}, [board.columns]);
	const inProgressCards = useMemo(() => {
		return board.columns.find((column) => column.id === "in_progress")?.cards ?? [];
	}, [board.columns]);
	const { workspaceSnapshots, resetWorkspaceSnapshots } = useTaskWorkspaceSnapshots({
		currentProjectId,
		reviewCards,
		inProgressCards,
		workspaceStatusRetrievedAt,
		isDocumentVisible,
		fetchReviewWorkspaceSnapshot,
	});
	const setTaskGitActionLoading = useCallback((
		taskId: string,
		action: TaskGitAction,
		source: TaskGitActionSource | null,
	) => {
		setTaskGitActionLoadingByTaskId((current) => {
			const existing = current[taskId] ?? { commitSource: null, prSource: null };
			const key = action === "commit" ? "commitSource" : "prSource";
			if (existing[key] === source) {
				return current;
			}
			const nextEntry: TaskGitActionLoadingState = {
				...existing,
				[key]: source,
			};
			if (nextEntry.commitSource === null && nextEntry.prSource === null) {
				const { [taskId]: _removed, ...rest } = current;
				return rest;
			}
			return {
				...current,
				[taskId]: nextEntry,
			};
		});
	}, []);
	const commitTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.commitSource === "card") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);
	const openPrTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.prSource === "card") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);
	const agentCommitTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.commitSource === "agent") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);
	const agentOpenPrTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.prSource === "agent") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);
	const runTaskGitAction = useCallback(
		async (taskId: string, action: TaskGitAction, source: TaskGitActionSource) => {
			const taskLoadingState = taskGitActionLoadingByTaskId[taskId];
			const actionInFlightSource = action === "commit"
				? taskLoadingState?.commitSource
				: taskLoadingState?.prSource;
			if (actionInFlightSource !== null && actionInFlightSource !== undefined) {
				return;
			}
			setTaskGitActionLoading(taskId, action, source);
			try {
				const selection = findCardSelection(board, taskId);
				if (!selection) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not find the selected task card.",
						timeout: 5000,
					});
					return;
				}
				if (selection.column.id !== "review") {
					showAppToast({
						intent: "warning",
						icon: "warning-sign",
						message: "Commit and PR actions are only available for tasks in Review.",
						timeout: 5000,
					});
					return;
				}

				const snapshotWorkspaceInfo = workspaceSnapshots[taskId]
					? {
							taskId,
							path: workspaceSnapshots[taskId].path,
							exists: true,
							baseRef: selection.card.baseRef,
							branch: workspaceSnapshots[taskId].branch,
							isDetached: workspaceSnapshots[taskId].isDetached,
							headCommit: workspaceSnapshots[taskId].headCommit,
						}
					: null;
				const workspaceInfo = matchesWorkspaceInfoSelection(selectedTaskWorkspaceInfo, selection.card)
					? selectedTaskWorkspaceInfo
					: snapshotWorkspaceInfo ?? await fetchTaskWorkspaceInfo(selection.card);
				if (!workspaceInfo) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not resolve task workspace details.",
						timeout: 6000,
					});
					return;
				}

				const prompt = buildTaskGitActionPrompt({
					action,
					workspaceInfo,
					templates: runtimeProjectConfig
						? {
								commitPromptTemplate: runtimeProjectConfig.commitPromptTemplate,
								openPrPromptTemplate: runtimeProjectConfig.openPrPromptTemplate,
								commitPromptTemplateDefault: runtimeProjectConfig.commitPromptTemplateDefault,
								openPrPromptTemplateDefault: runtimeProjectConfig.openPrPromptTemplateDefault,
							}
						: null,
				});
				const typed = await sendTaskSessionInput(taskId, prompt, { appendNewline: false });
				if (!typed.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: typed.message ?? "Could not send instructions to the task session.",
						timeout: 7000,
					});
					return;
				}
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, 200);
				});
				const submitted = await sendTaskSessionInput(taskId, "\r", { appendNewline: false });
				if (!submitted.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: submitted.message ?? "Could not submit instructions to the task session.",
						timeout: 7000,
					});
					return;
				}
			} finally {
				setTaskGitActionLoading(taskId, action, null);
			}
		},
		[
			board,
			fetchTaskWorkspaceInfo,
			runtimeProjectConfig,
			setTaskGitActionLoading,
			selectedTaskWorkspaceInfo,
			sendTaskSessionInput,
			taskGitActionLoadingByTaskId,
			workspaceSnapshots,
		],
	);
	const handleCommitTask = useCallback((taskId: string) => {
		void runTaskGitAction(taskId, "commit", "card");
	}, [runTaskGitAction]);
	const handleOpenPrTask = useCallback((taskId: string) => {
		void runTaskGitAction(taskId, "pr", "card");
	}, [runTaskGitAction]);
	const handleAgentCommitTask = useCallback((taskId: string) => {
		void runTaskGitAction(taskId, "commit", "agent");
	}, [runTaskGitAction]);
	const handleAgentOpenPrTask = useCallback((taskId: string) => {
		void runTaskGitAction(taskId, "pr", "agent");
	}, [runTaskGitAction]);
	const handleAddReviewComments = useCallback(async (taskId: string, text: string) => {
		const typed = await sendTaskSessionInput(taskId, text, { appendNewline: false });
		if (!typed.ok) {
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message: typed.message ?? "Could not add review comments to the task session.",
				timeout: 7000,
			});
		}
	}, [sendTaskSessionInput]);
	const handleSendReviewComments = useCallback(async (taskId: string, text: string) => {
		const typed = await sendTaskSessionInput(taskId, text, { appendNewline: false });
		if (!typed.ok) {
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message: typed.message ?? "Could not send review comments to the task session.",
				timeout: 7000,
			});
			return;
		}
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 200);
		});
		const submitted = await sendTaskSessionInput(taskId, "\r", { appendNewline: false });
		if (!submitted.ok) {
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message: submitted.message ?? "Could not submit review comments to the task session.",
				timeout: 7000,
			});
		}
	}, [sendTaskSessionInput]);

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
		let cancelled = false;
		const loadSelectedTaskWorkspaceInfo = async () => {
			if (!selectedCard) {
				setSelectedTaskWorkspaceInfo(null);
				return;
			}
			setSelectedTaskWorkspaceInfo((current) => {
				if (matchesWorkspaceInfoSelection(current, selectedCard.card)) {
					return current;
				}
				return null;
			});
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
		if (!workspaceGit) {
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

	const lastCreatedTaskBranchRef = useMemo(() => {
		if (!currentProjectId) {
			return null;
		}
		return lastCreatedTaskBranchByProjectId[currentProjectId] ?? null;
	}, [currentProjectId, lastCreatedTaskBranchByProjectId]);

	const defaultTaskBranchRef = useMemo(() => {
		if (!workspaceGit) {
			return "";
		}
		if (
			lastCreatedTaskBranchRef &&
			createTaskBranchOptions.some((option) => option.value === lastCreatedTaskBranchRef)
		) {
			return lastCreatedTaskBranchRef;
		}
		return workspaceGit.currentBranch ?? workspaceGit.defaultBranch ?? createTaskBranchOptions[0]?.value ?? "";
	}, [createTaskBranchOptions, lastCreatedTaskBranchRef, workspaceGit]);

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
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.getGitSummary.query(null);
			if (!payload.ok || !payload.summary) {
				throw new Error(payload.error ?? "Git summary request failed.");
			}
			setGitSummary(payload.summary);
		} catch {
			// Keep the last known summary; transient failures should not synthesize fake git state.
		}
	}, [currentProjectId]);

	const runGitAction = useCallback(async (action: RuntimeGitSyncAction) => {
		if (!currentProjectId || runningGitAction || isSwitchingHomeBranch) {
			return;
		}
		setRunningGitAction(action);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.runGitSyncAction.mutate({ action });
			if (!payload.ok || !payload.summary) {
				const errorMessage = payload.error ?? `${action} failed.`;
				const output = payload.output ?? "";
				const fallbackSummary = payload.summary ?? null;
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
	}, [currentProjectId, isSwitchingHomeBranch, runningGitAction]);

	const switchHomeBranch = useCallback(async (branch: string) => {
		const normalizedBranch = branch.trim();
		const currentBranch = gitSummary?.currentBranch ?? null;
		if (
			!currentProjectId ||
			isSwitchingHomeBranch ||
			!normalizedBranch ||
			normalizedBranch === currentBranch
		) {
			return;
		}
		setIsSwitchingHomeBranch(true);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.checkoutGitBranch.mutate({
				branch: normalizedBranch,
			});
			if (!payload.ok || !payload.summary) {
				const errorMessage = payload.error ?? "Switch branch failed.";
				const fallbackSummary = payload.summary ?? null;
				if (fallbackSummary) {
					setGitSummary(fallbackSummary);
				}
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not switch to ${normalizedBranch}. ${errorMessage}`,
					timeout: 7000,
				});
				return;
			}
			setGitSummary(payload.summary);
			await refreshWorkspaceState();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message: `Could not switch to ${normalizedBranch}. ${message}`,
				timeout: 7000,
			});
		} finally {
			setIsSwitchingHomeBranch(false);
		}
	}, [currentProjectId, gitSummary?.currentBranch, isSwitchingHomeBranch, refreshWorkspaceState]);

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
		resetWorkspaceSnapshots();
	}, [currentProjectId, resetWorkspaceSnapshots]);

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

	const handlePopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const nextProjectId = parseProjectIdFromPathname(window.location.pathname);
		setRequestedProjectId(nextProjectId);
	}, []);
	useWindowEvent("popstate", handlePopState);

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
		if (isDocumentVisible) {
			void refreshWorkspaceState();
		}
	}, [isDocumentVisible, refreshWorkspaceState]);

	useEffect(() => {
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === newTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setNewTaskBranchRef(defaultTaskBranchRef);
	}, [createTaskBranchOptions, defaultTaskBranchRef, newTaskBranchRef]);

	useEffect(() => {
		if (!isInlineTaskCreateOpen) {
			return;
		}
		if (!newTaskBranchRef) {
			setNewTaskBranchRef(defaultTaskBranchRef);
		}
	}, [defaultTaskBranchRef, isInlineTaskCreateOpen, newTaskBranchRef]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === editTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setEditTaskBranchRef(defaultTaskBranchRef);
	}, [
		createTaskBranchOptions,
		defaultTaskBranchRef,
		editTaskBranchRef,
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
			setEditTaskBranchRef("");
		}
	}, [board, editingTaskId]);

	const handleGlobalKeyDown = useCallback((event: KeyboardEvent) => {
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
	}, [selectedCard]);
	useWindowEvent("keydown", handleGlobalKeyDown);

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
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const picked = await trpcClient.projects.pickDirectory.mutate();
			if (!picked.ok || !picked.path) {
				if (picked?.error && picked.error !== "No directory was selected.") {
					throw new Error(picked.error);
				}
				return;
			}

			const added = await trpcClient.projects.add.mutate({ path: picked.path });
			if (!added.ok || !added.project) {
				throw new Error(added.error ?? "Could not add project.");
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
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message,
				timeout: 7000,
			});
		}
	}, [currentProjectId]);

	const handleRemoveProject = useCallback(
		async (projectId: string): Promise<boolean> => {
			if (removingProjectId) {
				return false;
			}
			setRemovingProjectId(projectId);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.projects.remove.mutate({ projectId });
				if (!payload.ok) {
					throw new Error(payload.error ?? "Could not remove project.");
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
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.runtime.startShellSession.mutate({
				taskId: HOME_TERMINAL_TASK_ID,
				rows: HOME_TERMINAL_ROWS,
				baseRef: workspaceGit?.currentBranch ?? workspaceGit?.defaultBranch ?? "HEAD",
			});
			if (!payload.ok || !payload.summary) {
				throw new Error(payload.error ?? "Could not start terminal session.");
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
	}, [currentProjectId, upsertSession, workspaceGit?.currentBranch, workspaceGit?.defaultBranch]);

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
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.runtime.startShellSession.mutate({
					taskId: targetTaskId,
					rows: HOME_TERMINAL_ROWS,
					workspaceTaskId: card.id,
					baseRef: card.baseRef,
				});
				if (!payload.ok || !payload.summary) {
					throw new Error(payload.error ?? "Could not start detail terminal session.");
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
			const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef}`;
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
		const selectionKey = `${selectedCard.card.id}:${selectedCard.card.baseRef}`;
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
		setNewTaskBranchRef(defaultTaskBranchRef);
	}, [defaultTaskBranchRef]);

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
			const fallbackBranch = task.baseRef || defaultTaskBranchRef;
			setEditTaskBranchRef(fallbackBranch);
		},
		[defaultTaskBranchRef],
	);

	const handleCancelEditTask = useCallback(() => {
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
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
		if (!(editTaskBranchRef || defaultTaskBranchRef)) {
			return;
		}

		const parsedPrompt = splitPromptToTitleDescription(prompt);
		const title = parsedPrompt.title.trim();
		if (!title) {
			return;
		}

		const baseRef = editTaskBranchRef || defaultTaskBranchRef;

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
		defaultTaskBranchRef,
		editTaskBranchRef,
		editTaskPrompt,
		editTaskStartInPlanMode,
		editingTaskId,
	]);

	const handleCreateTask = useCallback(() => {
		const prompt = newTaskPrompt.trim();
		if (!prompt) {
			return;
		}
		if (!(newTaskBranchRef || defaultTaskBranchRef)) {
			return;
		}
		const parsedPrompt = splitPromptToTitleDescription(prompt);
		const title = parsedPrompt.title.trim();
		if (!title) {
			return;
		}
		const baseRef = newTaskBranchRef || defaultTaskBranchRef;
		setBoard((currentBoard) =>
			addTaskToColumn(currentBoard, "backlog", {
				title,
				description: parsedPrompt.description,
				prompt,
				startInPlanMode: newTaskStartInPlanMode,
				baseRef,
			}),
		);
		trackTaskCreated({
			selected_agent_id: runtimeProjectConfig?.selectedAgentId ?? "unknown",
			start_in_plan_mode: newTaskStartInPlanMode,
			prompt_character_count: prompt.length,
		});
		if (currentProjectId) {
			setLastCreatedTaskBranchByProjectId((current) => ({
				...current,
				[currentProjectId]: baseRef,
			}));
		}
		setNewTaskPrompt("");
		setNewTaskBranchRef(baseRef);
		setIsInlineTaskCreateOpen(false);
		setWorktreeError(null);
	}, [
		currentProjectId,
		defaultTaskBranchRef,
		newTaskBranchRef,
		newTaskPrompt,
		newTaskStartInPlanMode,
		runtimeProjectConfig?.selectedAgentId,
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
				setSelectedTaskWorkspaceInfo(
					info ?? {
						taskId: task.id,
						path: "",
						exists: false,
						baseRef: task.baseRef,
						branch: null,
						isDetached: true,
						headCommit: null,
					},
				);
			}
		},
		[cleanupTaskWorkspace, fetchTaskWorkspaceInfo, selectedTaskId, stopTaskSession],
	);

	const requestMoveTaskToTrash = useCallback(
		async (
			taskId: string,
			fromColumnId: BoardColumnId,
			options?: { optimisticMoveApplied?: boolean },
		): Promise<void> => {
			const selection = findCardSelection(board, taskId);
			if (!selection) {
				return;
			}

			const changeCount = await fetchTaskWorkingChangeCount(selection.card);
			if (changeCount == null) {
				await performMoveTaskToTrash(selection.card);
				return;
			}

			if (changeCount > 0) {
				if (options?.optimisticMoveApplied) {
					setBoard((currentBoard) => {
						const currentColumnId = getTaskColumnId(currentBoard, taskId);
						if (currentColumnId !== "trash") {
							return currentBoard;
						}
						const reverted = moveTaskToColumn(currentBoard, taskId, fromColumnId);
						return reverted.moved ? reverted.board : currentBoard;
					});
				}
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

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);

	const saveSelectedShortcutPreference = useCallback(
		async (nextShortcutId: string | null): Promise<boolean> => {
			if (!currentProjectId) {
				return false;
			}
			try {
				await saveRuntimeConfig(currentProjectId, {
					selectedShortcutId: nextShortcutId,
				});
				refreshRuntimeProjectConfig();
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{
						intent: "danger",
						icon: "error",
						message: `Could not save shortcut selection: ${message}`,
						timeout: 5000,
					},
					"shortcut-selection-save-failed",
				);
				return false;
			}
		},
		[currentProjectId, refreshRuntimeProjectConfig],
	);

	const handleSelectShortcutId = useCallback(
		(shortcutId: string) => {
			if (shortcutId === runtimeProjectConfig?.selectedShortcutId) {
				return;
			}
			void saveSelectedShortcutPreference(shortcutId);
		},
		[runtimeProjectConfig?.selectedShortcutId, saveSelectedShortcutPreference],
	);

	const handleRunShortcut = useCallback(
		async (shortcutId: string) => {
			const shortcut = shortcuts.find((item) => item.id === shortcutId);
			if (!shortcut || !currentProjectId) {
				return;
			}

			setRunningShortcutId(shortcutId);
			try {
				let targetTaskId = HOME_TERMINAL_TASK_ID;
				let shouldWaitForConnection = false;
				let waitForTerminalConnectionReady: (() => Promise<void>) | null = null;
				const activeSelection = selectedCard;
				if (activeSelection) {
					targetTaskId = getDetailTerminalTaskId(activeSelection.card);
					const selectionKey = `${activeSelection.card.id}:${activeSelection.card.baseRef}`;
					const detailWasAlreadyOpenForSelection =
						isDetailTerminalOpen && detailTerminalSelectionKeyRef.current === selectionKey;
					shouldWaitForConnection = !detailWasAlreadyOpenForSelection;
					if (shouldWaitForConnection) {
						waitForTerminalConnectionReady = prepareWaitForTerminalConnectionReady(targetTaskId);
					}
					detailTerminalSelectionKeyRef.current = selectionKey;
					setIsDetailTerminalOpen(true);
					const started = await startDetailTerminalForCard(activeSelection.card, { showLoading: true });
					if (!started) {
						if (detailTerminalSelectionKeyRef.current === selectionKey) {
							detailTerminalSelectionKeyRef.current = null;
						}
						throw new Error("Could not open detail terminal.");
					}
				} else {
					const homeWasAlreadyOpenForProject =
						isHomeTerminalOpen && homeTerminalProjectIdRef.current === currentProjectId;
					shouldWaitForConnection = !homeWasAlreadyOpenForProject;
					if (shouldWaitForConnection) {
						waitForTerminalConnectionReady =
							prepareWaitForTerminalConnectionReady(HOME_TERMINAL_TASK_ID);
					}
					homeTerminalProjectIdRef.current = currentProjectId;
					setIsHomeTerminalOpen(true);
					const started = await startHomeTerminalSession();
					if (!started) {
						homeTerminalProjectIdRef.current = null;
						setIsHomeTerminalOpen(false);
						throw new Error("Could not open terminal.");
					}
				}

				if (shouldWaitForConnection && waitForTerminalConnectionReady) {
					await waitForTerminalConnectionReady();
				}
				const runResult = await sendTaskSessionInput(targetTaskId, shortcut.command, { appendNewline: true });
				if (!runResult.ok) {
					throw new Error(runResult.message ?? "Could not run shortcut command.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{
						intent: "danger",
						icon: "error",
						message: `Could not run shortcut "${shortcut.label}": ${message}`,
						timeout: 6000,
					},
					`shortcut-run-failed:${shortcut.id}`,
				);
			} finally {
				setRunningShortcutId(null);
			}
		},
		[
			currentProjectId,
			shortcuts,
			selectedCard,
			isDetailTerminalOpen,
			isHomeTerminalOpen,
			startDetailTerminalForCard,
			startHomeTerminalSession,
			sendTaskSessionInput,
			prepareWaitForTerminalConnectionReady,
		],
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
			if (selectedTaskId === taskId) {
				if (ensured.response) {
					setSelectedTaskWorkspaceInfo({
						taskId,
						path: ensured.response.path,
						exists: true,
						baseRef: ensured.response.baseRef,
						branch: null,
						isDetached: true,
						headCommit: ensured.response.baseCommit,
					});
				}
				const infoAfterEnsure = await fetchTaskWorkspaceInfo(task);
				if (infoAfterEnsure) {
					setSelectedTaskWorkspaceInfo(infoAfterEnsure);
				}
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
		[ensureTaskWorkspace, fetchTaskWorkspaceInfo, selectedTaskId, startTaskSession],
	);

	const maybeRequestNotificationPermissionForTaskStart = useCallback(() => {
		const shouldPromptForNotificationPermission =
			readyForReviewNotificationsEnabled &&
			getBrowserNotificationPermission() === "default" &&
			!hasPromptedForBrowserNotificationPermission() &&
			!notificationPermissionPromptInFlightRef.current;
		if (!shouldPromptForNotificationPermission) {
			return;
		}
		notificationPermissionPromptInFlightRef.current = true;
		void requestBrowserNotificationPermission().finally(() => {
			notificationPermissionPromptInFlightRef.current = false;
		});
	}, [readyForReviewNotificationsEnabled]);

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
				setBoard(applied.board);
				void requestMoveTaskToTrash(moveEvent.taskId, moveEvent.fromColumnId, {
					optimisticMoveApplied: true,
				});
				return;
			}

			setBoard(applied.board);

			if (moveEvent.toColumnId === "in_progress") {
				maybeRequestNotificationPermissionForTaskStart();
				const movedSelection = findCardSelection(applied.board, moveEvent.taskId);
				if (movedSelection) {
					void kickoffTaskInProgress(movedSelection.card, moveEvent.taskId, moveEvent.fromColumnId);
				}
			}
		},
		[board, kickoffTaskInProgress, maybeRequestNotificationPermissionForTaskStart, requestMoveTaskToTrash],
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
			maybeRequestNotificationPermissionForTaskStart();
			if (movedSelection) {
				void kickoffTaskInProgress(movedSelection.card, taskId, "backlog");
			}
		},
		[board, kickoffTaskInProgress, maybeRequestNotificationPermissionForTaskStart],
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
	const selectedCardWorkspaceSnapshot = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return workspaceSnapshots[selectedCard.card.id] ?? null;
	}, [selectedCard, workspaceSnapshots]);
	const detailShellSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return activeSelectedTaskWorkspaceInfo?.path ?? selectedCardWorkspaceSnapshot?.path ?? null;
	}, [activeSelectedTaskWorkspaceInfo?.path, selectedCard, selectedCardWorkspaceSnapshot?.path]);
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
	const activeWorkspacePath =
		selectedCard
			? activeSelectedTaskWorkspaceInfo?.path ?? selectedCardWorkspaceSnapshot?.path ?? workspacePath ?? undefined
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
		if (!selectedCard || !activeSelectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (!activeSelectedTaskWorkspaceInfo.exists) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		return undefined;
	}, [activeSelectedTaskWorkspaceInfo, selectedCard]);
	const navbarWorkspacePath = hasNoProjects ? undefined : activeWorkspacePath;
	const navbarWorkspaceHint = hasNoProjects ? undefined : activeWorkspaceHint;
	const navbarRuntimeHint = hasNoProjects ? undefined : runtimeHint;
	const navbarGitSummary = hasNoProjects || selectedCard ? null : gitSummary;
	const shouldHideProjectDependentTopBarActions =
		!selectedCard &&
		(isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);
	const navbarTaskGitSummary = useMemo((): TopBarTaskGitSummary | null => {
		if (hasNoProjects || !selectedCard) {
			return null;
		}
		if (!activeSelectedTaskWorkspaceInfo && !selectedCardWorkspaceSnapshot) {
			return null;
		}
		return {
			branch: activeSelectedTaskWorkspaceInfo?.branch ?? selectedCardWorkspaceSnapshot?.branch ?? null,
			headCommit: activeSelectedTaskWorkspaceInfo?.headCommit ?? selectedCardWorkspaceSnapshot?.headCommit ?? null,
			changedFiles: selectedCardWorkspaceSnapshot?.changedFiles ?? 0,
			additions: selectedCardWorkspaceSnapshot?.additions ?? 0,
			deletions: selectedCardWorkspaceSnapshot?.deletions ?? 0,
		};
	}, [activeSelectedTaskWorkspaceInfo, hasNoProjects, selectedCard, selectedCardWorkspaceSnapshot]);
	const trashWarningGuidance = useMemo(() => {
		if (!pendingTrashWarning) {
			return [] as string[];
		}
		const info = pendingTrashWarning.workspaceInfo;
		if (!info) {
			return ["Save your changes before trashing this task."];
		}
		if (info.isDetached) {
			return [
				"Create a branch inside this worktree, commit, then open a PR from that branch.",
				"Or commit and cherry-pick the commit onto your target branch (for example main).",
			];
		}
		const branch = info.branch ?? info.baseRef;
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
			workspaceId={currentProjectId}
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
			workspaceId={currentProjectId}
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
					homeBranchOptions={selectedCard || hasNoProjects ? undefined : createTaskBranchOptions}
					selectedHomeBranch={selectedCard || hasNoProjects ? null : gitSummary?.currentBranch ?? null}
					onSelectHomeBranch={
						selectedCard || hasNoProjects
							? undefined
							: (branch) => {
									void switchHomeBranch(branch);
								}
					}
					isSwitchingHomeBranch={selectedCard || hasNoProjects ? false : isSwitchingHomeBranch}
						onToggleTerminal={hasNoProjects ? undefined : selectedCard ? handleToggleDetailTerminal : handleToggleHomeTerminal}
					isTerminalOpen={selectedCard ? isDetailTerminalOpen : isHomeTerminalOpen}
					isTerminalLoading={selectedCard ? isDetailTerminalStarting : isHomeTerminalStarting}
					onOpenSettings={handleOpenSettings}
					shortcuts={shortcuts}
					selectedShortcutId={selectedShortcutId}
					onSelectShortcutId={handleSelectShortcutId}
					runningShortcutId={runningShortcutId}
					onRunShortcut={handleRunShortcut}
					openTargetOptions={openTargetOptions}
					selectedOpenTargetId={selectedOpenTargetId}
					onSelectOpenTarget={onSelectOpenTarget}
					onOpenWorkspace={onOpenWorkspace}
					canOpenWorkspace={canOpenWorkspace}
					isOpeningWorkspace={isOpeningWorkspace}
					hideProjectDependentActions={shouldHideProjectDependentTopBarActions}
				/>
					<RuntimeStatusBanners
						worktreeError={worktreeError}
						onDismissWorktreeError={() => setWorktreeError(null)}
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
											description="Add a git repository to start using Kanbanana."
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
											onCommitTask={handleCommitTask}
											onOpenPrTask={handleOpenPrTask}
											commitTaskLoadingById={commitTaskLoadingById}
											openPrTaskLoadingById={openPrTaskLoadingById}
											onMoveToTrashTask={handleMoveReviewCardToTrash}
											reviewWorkspaceSnapshots={workspaceSnapshots}
											onDragEnd={handleDragEnd}
										/>
									</div>
									{isHomeTerminalOpen ? (
										<ResizableBottomPane
											initialHeight={homeTerminalPaneHeight}
											onHeightChange={setHomeTerminalPaneHeight}
										>
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
													onConnectionReady={markTerminalConnectionReady}
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
									onCommitTask={handleCommitTask}
									onOpenPrTask={handleOpenPrTask}
									onAgentCommitTask={handleAgentCommitTask}
									onAgentOpenPrTask={handleAgentOpenPrTask}
									commitTaskLoadingById={commitTaskLoadingById}
									openPrTaskLoadingById={openPrTaskLoadingById}
									agentCommitTaskLoadingById={agentCommitTaskLoadingById}
									agentOpenPrTaskLoadingById={agentOpenPrTaskLoadingById}
									onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
									reviewWorkspaceSnapshots={workspaceSnapshots}
									onAddReviewComments={(taskId: string, text: string) => { void handleAddReviewComments(taskId, text); }}
									onSendReviewComments={(taskId: string, text: string) => { void handleSendReviewComments(taskId, text); }}
									onMoveToTrash={handleMoveToTrash}
									bottomTerminalOpen={isDetailTerminalOpen}
									bottomTerminalTaskId={detailShellTaskId}
									bottomTerminalSummary={detailShellSummary}
									bottomTerminalSubtitle={detailShellSubtitle}
									onBottomTerminalClose={() => setIsDetailTerminalOpen(false)}
									bottomTerminalPaneHeight={detailTerminalPaneHeight}
									onBottomTerminalPaneHeightChange={setDetailTerminalPaneHeight}
									onBottomTerminalConnectionReady={markTerminalConnectionReady}
								/>
							</div>
						) : null}
					</div>
			</div>
					<RuntimeSettingsDialog
						open={isSettingsOpen}
						workspaceId={currentProjectId}
					initialSection={settingsInitialSection}
					onOpenChange={(nextOpen) => {
						setIsSettingsOpen(nextOpen);
						if (!nextOpen) {
							setSettingsInitialSection(null);
						}
					}}
						onSaved={() => {
							refreshRuntimeProjectConfig();
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
