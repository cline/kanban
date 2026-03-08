import { Alert, Button, Classes, Colors, NonIdealState, Pre, Spinner } from "@blueprintjs/core";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import {
	countTasksByColumn,
	createIdleTaskSession,
} from "@/kanban/app/app-utils";
import { useBoardInteractions } from "@/kanban/app/use-board-interactions";
import { useDocumentVisibility } from "@/kanban/app/use-document-visibility";
import { useGitActions } from "@/kanban/app/use-git-actions";
import { useProjectNavigation } from "@/kanban/app/use-project-navigation";
import { useShortcutActions } from "@/kanban/app/use-shortcut-actions";
import { useTaskEditor } from "@/kanban/app/use-task-editor";
import { useTerminalPanels } from "@/kanban/app/use-terminal-panels";
import { useTaskSessions } from "@/kanban/app/use-task-sessions";
import { useOpenWorkspace } from "@/kanban/app/use-open-workspace";
import { useReviewReadyNotifications } from "@/kanban/app/use-review-ready-notifications";
import { useTaskWorkspaceSnapshots } from "@/kanban/app/use-task-workspace-snapshots";
import { showAppToast } from "@/kanban/components/app-toaster";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { ClearTrashDialog } from "@/kanban/components/clear-trash-dialog";
import { AgentTerminalPanel } from "@/kanban/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/kanban/components/git-history-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { KeyboardShortcutsDialog } from "@/kanban/components/keyboard-shortcuts-dialog";
import { ProjectNavigationPanel } from "@/kanban/components/project-navigation-panel";
import { ResizableBottomPane } from "@/kanban/components/resizable-bottom-pane";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/kanban/components/runtime-settings-dialog";
import { RuntimeStatusBanners } from "@/kanban/components/runtime-status-banners";
import { TaskInlineCreateCard } from "@/kanban/components/task-inline-create-card";
import { TaskTrashWarningDialog } from "@/kanban/components/task-trash-warning-dialog";
import { TopBar, type TopBarTaskGitSummary } from "@/kanban/components/top-bar";
import { createInitialBoardData } from "@/kanban/data/board-data";
import type { PendingTrashWarningState } from "@/kanban/hooks/use-linked-backlog-task-actions";
import type {
	RuntimeGitRepositoryInfo,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorkspaceStateResponse,
} from "@/kanban/runtime/types";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/kanban/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/kanban/runtime/use-workspace-persistence";
import { fetchWorkspaceState, saveWorkspaceState } from "@/kanban/runtime/workspace-state-query";
import {
	findCardSelection,
	normalizeBoardData,
} from "@/kanban/state/board-state";
import type {
	BoardCard,
	BoardData,
} from "@/kanban/types";
import { DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS } from "@/kanban/utils/task-prompt";

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
	const workspaceRefreshRequestIdRef = useRef(0);
	const lastStreamErrorRef = useRef<string | null>(null);
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] = useState<RuntimeTaskWorkspaceInfoResponse | null>(
		null,
	);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [pendingTrashWarning, setPendingTrashWarning] = useState<PendingTrashWarningState | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setSelectedTaskId(null);
		setIsGitHistoryOpen(false);
	}, []);
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceStatusRetrievedAt,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		navigationCurrentProjectId,
		removingProjectId,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleRemoveProject,
		resetProjectNavigationState,
	} = useProjectNavigation({
		onProjectSwitchStart: handleProjectSwitchStart,
		onProjectRemoveError: setWorktreeError,
	});
	const activeNotificationWorkspaceId = navigationCurrentProjectId;
	const isDocumentVisible = useDocumentVisibility();
	const isInitialRuntimeLoad =
		!hasReceivedSnapshot && currentProjectId === null && projects.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const isWorkspaceMetadataPending = currentProjectId !== null && appliedWorkspaceProjectId !== currentProjectId;
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
	const shouldUseNavigationPath = isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;
	const { config: runtimeProjectConfig, refresh: refreshRuntimeProjectConfig } =
		useRuntimeProjectConfig(currentProjectId);
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
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
			if (isSameProject && currentRevision !== null && nextWorkspaceState.revision < currentRevision) {
				return;
			}
			setWorkspacePath(nextWorkspaceState.repoPath);
			setWorkspaceGit(nextWorkspaceState.git);
			setSessions(nextWorkspaceState.sessions ?? {});
			const shouldHydrateBoard = !isSameProject || currentRevision !== nextWorkspaceState.revision;
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

	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
		fetchTaskWorkingChangeCount,
		fetchReviewWorkspaceSnapshot,
	} = useTaskSessions({
		currentProjectId,
		setSessions,
		onWorktreeError: setWorktreeError,
	});

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
	const trashCards = useMemo(() => {
		return board.columns.find((column) => column.id === "trash")?.cards ?? [];
	}, [board.columns]);
	const { workspaceSnapshots, resetWorkspaceSnapshots } = useTaskWorkspaceSnapshots({
		currentProjectId,
		reviewCards,
		inProgressCards,
		trashCards,
		workspaceStatusRetrievedAt,
		isDocumentVisible,
		fetchReviewWorkspaceSnapshot,
	});
	const selectedCardWorkspaceSnapshot = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return workspaceSnapshots[selectedCard.card.id] ?? null;
	}, [selectedCard, workspaceSnapshots]);

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
		selectedCard ? (sessions[selectedCard.card.id]?.updatedAt ?? 0) : 0,
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

	const defaultTaskBranchRef = useMemo(() => {
		if (!workspaceGit) {
			return "";
		}
		return workspaceGit.currentBranch ?? workspaceGit.defaultBranch ?? createTaskBranchOptions[0]?.value ?? "";
	}, [createTaskBranchOptions, workspaceGit]);
	const {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		newTaskAutoReviewEnabled,
		setNewTaskAutoReviewEnabled,
		newTaskAutoReviewMode,
		setNewTaskAutoReviewMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		editTaskAutoReviewEnabled,
		setEditTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		setEditTaskAutoReviewMode,
		editTaskBranchRef,
		setEditTaskBranchRef,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleCreateTask,
		resetTaskEditorState,
	} = useTaskEditor({
		board,
		setBoard,
		currentProjectId,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		selectedAgentId: runtimeProjectConfig?.selectedAgentId ?? null,
		setSelectedTaskId,
		setSelectedTaskWorkspaceInfo,
		onClearWorktreeError: () => setWorktreeError(null),
	});

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isProjectSwitching, resetTaskEditorState]);

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

	const {
		gitSummary,
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError,
		gitHistory,
		runGitAction,
		switchHomeBranch,
		discardHomeWorkingChanges,
		handleCommitTask,
		handleOpenPrTask,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	} = useGitActions({
		currentProjectId,
		board,
		selectedCard,
		selectedTaskWorkspaceInfo,
		workspaceSnapshots,
		runtimeProjectConfig,
		sendTaskSessionInput,
		fetchTaskWorkspaceInfo,
		isGitHistoryOpen,
		isDocumentVisible,
		refreshWorkspaceState,
		workspaceRevision,
		workspaceStatusRetrievedAt,
	});
	const agentCommand = runtimeProjectConfig?.effectiveCommand ?? null;
	const {
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalShellBinary,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	} = useTerminalPanels({
		currentProjectId,
		selectedCard,
		workspaceGit,
		agentCommand,
		homeTerminalTaskId: HOME_TERMINAL_TASK_ID,
		homeTerminalRows: HOME_TERMINAL_ROWS,
		getDetailTerminalTaskId,
		upsertSession,
		sendTaskSessionInput,
		onWorktreeError: setWorktreeError,
	});
	const { runningShortcutId, handleSelectShortcutId, handleRunShortcut } = useShortcutActions({
		currentProjectId,
		selectedShortcutId: runtimeProjectConfig?.selectedShortcutId,
		shortcuts,
		refreshRuntimeProjectConfig,
		prepareTerminalForShortcut,
		prepareWaitForTerminalConnectionReady,
		sendTaskSessionInput,
	});

	const persistWorkspaceStateAsync = useCallback(
		async (input: { workspaceId: string; payload: Parameters<typeof saveWorkspaceState>[1] }) =>
			await saveWorkspaceState(input.workspaceId, input.payload),
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
		if (isRuntimeDisconnected) {
			lastStreamErrorRef.current = streamError;
			setWorktreeError(null);
			return;
		}
		lastStreamErrorRef.current = streamError;
		setWorktreeError(streamError);
	}, [isRuntimeDisconnected, streamError]);

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
		}
		setWorktreeError(null);
		setSelectedTaskId(null);
		setSelectedTaskWorkspaceInfo(null);
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetProjectNavigationState();
		resetTerminalPanelsState();
		resetWorkspaceSnapshots();
	}, [
		currentProjectId,
		resetGitActionState,
		resetProjectNavigationState,
		resetTaskEditorState,
		resetTerminalPanelsState,
		resetWorkspaceSnapshots,
	]);

	useEffect(() => {
		if (isDocumentVisible) {
			void refreshWorkspaceState();
		}
	}, [isDocumentVisible, refreshWorkspaceState]);

	useEffect(() => {
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);


	useHotkeys(
		"mod+j",
		() => {
			if (selectedCard) {
				handleToggleDetailTerminal();
				return;
			}
			handleToggleHomeTerminal();
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[handleToggleDetailTerminal, handleToggleHomeTerminal, selectedCard],
	);

	useHotkeys(
		"mod+m",
		() => {
			if (selectedCard) {
				if (isDetailTerminalOpen) {
					handleToggleExpandDetailTerminal();
				}
				return;
			}
			if (isHomeTerminalOpen) {
				handleToggleExpandHomeTerminal();
			}
		},
		{
			enableOnFormTags: true,
			enableOnContentEditable: true,
			preventDefault: true,
		},
		[
			handleToggleExpandDetailTerminal,
			handleToggleExpandHomeTerminal,
			isDetailTerminalOpen,
			isHomeTerminalOpen,
			selectedCard,
		],
	);

	useHotkeys(
		"c",
		() => {
			handleOpenCreateTask();
		},
		{ preventDefault: true },
		[handleOpenCreateTask],
	);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
		setIsGitHistoryOpen(false);
	}, []);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);

	const {
		handleProgrammaticCardMoveReady,
		confirmMoveTaskToTrash,
		handleCreateDependency,
		handleDeleteDependency,
		handleDragEnd,
		handleStartTask,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleCancelAutomaticTaskAction,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId,
		selectedTaskWorkspaceInfo,
		workspaceSnapshots,
		currentProjectId,
		setSelectedTaskId,
		setSelectedTaskWorkspaceInfo,
		setPendingTrashWarning,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskWorkspace,
		ensureTaskWorkspace,
		startTaskSession,
		fetchTaskWorkingChangeCount,
		fetchTaskWorkspaceInfo,
		sendTaskSessionInput,
		onWorktreeError: setWorktreeError,
		readyForReviewNotificationsEnabled,
		taskGitActionLoadingByTaskId,
		runAutoReviewGitAction,
	});

	const detailSession = selectedCard
		? (sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailShellTaskId = selectedCard ? getDetailTerminalTaskId(selectedCard.card) : null;
	const detailShellSummary = detailShellTaskId ? (sessions[detailShellTaskId] ?? null) : null;
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
	const activeWorkspacePath = selectedCard
		? (activeSelectedTaskWorkspaceInfo?.path ?? selectedCardWorkspaceSnapshot?.path ?? workspacePath ?? undefined)
		: shouldUseNavigationPath
			? (navigationProjectPath ?? undefined)
			: (workspacePath ?? undefined);
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
		!selectedCard && (isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);
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
	const inlineTaskCreator = isInlineTaskCreateOpen ? (
		<TaskInlineCreateCard
			prompt={newTaskPrompt}
			onPromptChange={setNewTaskPrompt}
			onCreate={handleCreateTask}
			onCancel={handleCancelCreateTask}
			startInPlanMode={newTaskStartInPlanMode}
			onStartInPlanModeChange={setNewTaskStartInPlanMode}
			startInPlanModeDisabled={isNewTaskStartInPlanModeDisabled}
			autoReviewEnabled={newTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={setNewTaskAutoReviewEnabled}
			autoReviewMode={newTaskAutoReviewMode}
			onAutoReviewModeChange={setNewTaskAutoReviewMode}
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
			autoReviewEnabled={editTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={setEditTaskAutoReviewEnabled}
			autoReviewMode={editTaskAutoReviewMode}
			onAutoReviewModeChange={setEditTaskAutoReviewMode}
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
					icon="error"
					title="Disconnected from kanbanana"
					description="Run kanbanana again in your terminal, then reload this tab."
				/>
			</div>
		);
	}

	return (
		<div
			className={Classes.DARK}
			style={{ display: "flex", flexDirection: "row", height: "100svh", minWidth: 0, overflow: "hidden" }}
		>
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
					onToggleTerminal={
						hasNoProjects ? undefined : selectedCard ? handleToggleDetailTerminal : handleToggleHomeTerminal
					}
					isTerminalOpen={selectedCard ? isDetailTerminalOpen : isHomeTerminalOpen}
					isTerminalLoading={selectedCard ? isDetailTerminalStarting : isHomeTerminalStarting}
					onOpenSettings={handleOpenSettings}
					onOpenKeyboardShortcuts={() => setIsKeyboardShortcutsOpen(true)}
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
					onToggleGitHistory={hasNoProjects ? undefined : () => setIsGitHistoryOpen((prev) => !prev)}
					isGitHistoryOpen={isGitHistoryOpen}
					hideProjectDependentActions={shouldHideProjectDependentTopBarActions}
				/>
				<RuntimeStatusBanners worktreeError={worktreeError} onDismissWorktreeError={() => setWorktreeError(null)} />
				<div
					style={{
						position: "relative",
						display: "flex",
						flex: "1 1 0",
						minHeight: 0,
						minWidth: 0,
						overflow: "hidden",
					}}
				>
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
						) : hasNoProjects ? (
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
							<div
								style={{ display: "flex", flex: "1 1 0", flexDirection: "column", minHeight: 0, minWidth: 0 }}
							>
								<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, minWidth: 0 }}>
									{isGitHistoryOpen ? (
										<GitHistoryView
											workspaceId={currentProjectId}
											gitHistory={gitHistory}
											onCheckoutBranch={(branch) => {
												void switchHomeBranch(branch);
											}}
											onDiscardWorkingChanges={() => {
												void discardHomeWorkingChanges();
											}}
											isDiscardWorkingChangesPending={isDiscardingHomeWorkingChanges}
										/>
									) : (
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
											dependencies={board.dependencies}
											onCreateDependency={handleCreateDependency}
											onDeleteDependency={handleDeleteDependency}
											onRequestProgrammaticCardMoveReady={
												selectedCard ? undefined : handleProgrammaticCardMoveReady
											}
											onDragEnd={handleDragEnd}
										/>
									)}
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
											onClose={closeHomeTerminal}
												autoFocus
												minimalHeaderTitle="Terminal"
												minimalHeaderSubtitle={homeTerminalShellBinary}
												panelBackgroundColor={Colors.DARK_GRAY2}
												terminalBackgroundColor={Colors.DARK_GRAY2}
												cursorColor={Colors.LIGHT_GRAY5}
												showRightBorder={false}
												isVisible={!selectedCard}
												onConnectionReady={markTerminalConnectionReady}
												agentCommand={agentCommand}
												onSendAgentCommand={handleSendAgentCommandToHomeTerminal}
												isExpanded={isHomeTerminalExpanded}
												onToggleExpand={handleToggleExpandHomeTerminal}
											/>
										</div>
									</ResizableBottomPane>
								) : null}
							</div>
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
								onEditTask={(task) => {
									handleOpenEditTask(task, { preserveDetailSelection: true });
								}}
								onCommitTask={handleCommitTask}
								onOpenPrTask={handleOpenPrTask}
								onAgentCommitTask={handleAgentCommitTask}
								onAgentOpenPrTask={handleAgentOpenPrTask}
								commitTaskLoadingById={commitTaskLoadingById}
								openPrTaskLoadingById={openPrTaskLoadingById}
								agentCommitTaskLoadingById={agentCommitTaskLoadingById}
								agentOpenPrTaskLoadingById={agentOpenPrTaskLoadingById}
								onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
								onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
								reviewWorkspaceSnapshots={workspaceSnapshots}
								onAddReviewComments={(taskId: string, text: string) => {
									void handleAddReviewComments(taskId, text);
								}}
								onSendReviewComments={(taskId: string, text: string) => {
									void handleSendReviewComments(taskId, text);
								}}
								onMoveToTrash={handleMoveToTrash}
								gitHistoryPanel={
									isGitHistoryOpen ? (
										<GitHistoryView workspaceId={currentProjectId} gitHistory={gitHistory} />
									) : undefined
								}
								bottomTerminalOpen={isDetailTerminalOpen}
								bottomTerminalTaskId={detailShellTaskId}
								bottomTerminalSummary={detailShellSummary}
								bottomTerminalSubtitle={detailShellSubtitle}
								onBottomTerminalClose={closeDetailTerminal}
								bottomTerminalPaneHeight={detailTerminalPaneHeight}
								onBottomTerminalPaneHeightChange={setDetailTerminalPaneHeight}
								onBottomTerminalConnectionReady={markTerminalConnectionReady}
								bottomTerminalAgentCommand={agentCommand}
								onBottomTerminalSendAgentCommand={handleSendAgentCommandToDetailTerminal}
								isBottomTerminalExpanded={isDetailTerminalExpanded}
								onBottomTerminalToggleExpand={handleToggleExpandDetailTerminal}
							/>
						</div>
					) : null}
				</div>
			</div>
			<KeyboardShortcutsDialog isOpen={isKeyboardShortcutsOpen} onClose={() => setIsKeyboardShortcutsOpen(false)} />
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
					void confirmMoveTaskToTrash(selection.card, board);
				}}
			/>
			<Alert
				isOpen={gitActionError !== null}
				canEscapeKeyCancel
				canOutsideClickCancel
				confirmButtonText="Close"
				icon="warning-sign"
				intent="danger"
				onCancel={clearGitActionError}
				onConfirm={clearGitActionError}
			>
				<p>{gitActionErrorTitle}</p>
				<p>{gitActionError?.message}</p>
				{gitActionError?.output ? (
					<Pre style={{ maxHeight: 220, overflow: "auto" }}>{gitActionError.output}</Pre>
				) : null}
			</Alert>
		</div>
	);
}
