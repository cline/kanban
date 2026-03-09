import { Alert, Button, Classes, Colors, NonIdealState, Pre, Spinner } from "@blueprintjs/core";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useGitActions } from "@/hooks/use-git-actions";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { parseRemovedProjectPathFromStreamError, useProjectNavigation } from "@/hooks/use-project-navigation";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useSelectedTaskWorkspaceInfo } from "@/hooks/use-selected-task-workspace-info";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useTaskWorkspaceSnapshots } from "@/hooks/use-task-workspace-snapshots";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { showAppToast } from "@/components/app-toaster";
import { CardDetailView } from "@/components/card-detail-view";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/components/git-history-view";
import { KanbanBoard } from "@/components/kanban-board";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { ResizableBottomPane } from "@/components/resizable-bottom-pane";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { RuntimeStatusBanners } from "@/components/runtime-status-banners";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TaskTrashWarningDialog } from "@/components/task-trash-warning-dialog";
import { TopBar } from "@/components/top-bar";
import { createInitialBoardData } from "@/data/board-data";
import type { PendingTrashWarningState } from "@/hooks/use-linked-backlog-task-actions";
import type {
	RuntimeTaskSessionSummary,
} from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import {
	findCardSelection,
} from "@/state/board-state";
import type {
	BoardData,
} from "@/types";
import { DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS } from "@/utils/task-prompt";

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [pendingTrashWarning, setPendingTrashWarning] = useState<PendingTrashWarningState | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const lastStreamErrorRef = useRef<string | null>(null);
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
	const { config: runtimeProjectConfig, refresh: refreshRuntimeProjectConfig } =
		useRuntimeProjectConfig(currentProjectId);
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
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
	const {
		selectedTaskWorkspaceInfo,
		setSelectedTaskWorkspaceInfo,
		activeSelectedTaskWorkspaceInfo,
	} = useSelectedTaskWorkspaceInfo({
		selectedCard,
		sessions,
		workspaceStatusRetrievedAt,
		fetchTaskWorkspaceInfo,
	});
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
	const {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	} = useWorkspaceSync({
		currentProjectId,
		streamedWorkspaceState,
		hasNoProjects,
		isDocumentVisible,
		setBoard,
		setSessions,
		resetWorkspaceSnapshots,
		setCanPersistWorkspaceState,
		onWorktreeError: setWorktreeError,
	});

	const {
		displayedProjects,
		navigationProjectPath,
		shouldShowProjectLoadingState,
		isProjectListLoading,
		shouldUseNavigationPath,
	} = useProjectUiState({
		board,
		canPersistWorkspaceState,
		currentProjectId,
		projects,
		navigationCurrentProjectId,
		selectedTaskId,
		streamError,
		isProjectSwitching,
		isInitialRuntimeLoad,
		isAwaitingWorkspaceSnapshot,
		isWorkspaceMetadataPending,
		hasReceivedSnapshot,
	});

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	const { createTaskBranchOptions, defaultTaskBranchRef } = useTaskBranchOptions({ workspaceGit });
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
		resetWorkspaceSyncState();
	}, [isProjectSwitching, resetWorkspaceSyncState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isProjectSwitching, resetTaskEditorState]);

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
		homeTerminalTaskId,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalShellBinary,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
	detailTerminalTaskId,
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
		upsertSession,
		sendTaskSessionInput,
		onWorktreeError: setWorktreeError,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;
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
		if (!streamError) {
			const previousStreamError = lastStreamErrorRef.current;
			if (previousStreamError) {
				setWorktreeError((current) => (current === previousStreamError ? null : current));
				lastStreamErrorRef.current = null;
			}
			return;
		}
		const removedPath = parseRemovedProjectPathFromStreamError(streamError);
		if (removedPath !== null) {
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
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
		setIsGitHistoryOpen(false);
	}, []);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal,
		handleOpenCreateTask,
	});

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
		handleRestoreTaskFromTrash,
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
	const detailTerminalSummary = detailTerminalTaskId ? (sessions[detailTerminalTaskId] ?? null) : null;
	const detailTerminalSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return activeSelectedTaskWorkspaceInfo?.path ?? selectedCardWorkspaceSnapshot?.path ?? null;
	}, [activeSelectedTaskWorkspaceInfo?.path, selectedCard, selectedCardWorkspaceSnapshot?.path]);

	const runtimeHint = useMemo(() => {
		if (shouldUseNavigationPath || !runtimeProjectConfig) {
			return undefined;
		}
		if (runtimeProjectConfig.effectiveCommand) {
			return undefined;
		}
		const detected = runtimeProjectConfig.detectedCommands?.join(", ");
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

	const navbarTaskGitSummary = useMemo(() => {
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
		return <RuntimeDisconnectedFallback />;
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
									description="Add a git repository to start using Kanban."
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
								style={{
									display: "flex",
									flex: "1 1 0",
									flexDirection: "column",
									minHeight: 0,
									minWidth: 0,
								}}
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
										onRestoreFromTrashTask={handleRestoreTaskFromTrash}
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
												key={`${currentProjectId ?? "none"}:${homeTerminalTaskId}`}
												taskId={homeTerminalTaskId}
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
								onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
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
								bottomTerminalTaskId={detailTerminalTaskId}
								bottomTerminalSummary={detailTerminalSummary}
								bottomTerminalSubtitle={detailTerminalSubtitle}
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
								workspaceInfo: pendingTrashWarning.workspaceInfo,
							}
						: null
				}
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
