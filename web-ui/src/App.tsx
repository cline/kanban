import { FolderOpen } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { CardDetailView } from "@/components/card-detail-view";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/components/git-history-view";
import { KanbanBoard } from "@/components/kanban-board";
import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { ResizableBottomPane } from "@/components/resizable-bottom-pane";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { RuntimeStatusBanners } from "@/components/runtime-status-banners";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TaskStartServicePromptDialog } from "@/components/task-start-service-prompt-dialog";
import { TaskTrashWarningDialog } from "@/components/task-trash-warning-dialog";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useGitActions } from "@/hooks/use-git-actions";
import type { PendingTrashWarningState } from "@/hooks/use-linked-backlog-task-actions";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import { usePrewarmedAgentTerminals } from "@/hooks/use-prewarmed-agent-terminals";
import { parseRemovedProjectPathFromStreamError, useProjectNavigation } from "@/hooks/use-project-navigation";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useTaskStartServicePrompts } from "@/hooks/use-task-start-service-prompts";
import { useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import { findCardSelection } from "@/state/board-state";
import {
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
} from "@/stores/workspace-metadata-store";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [worktreeError, setWorktreeError] = useState<string | null>(null);
	const [pendingTrashWarning, setPendingTrashWarning] = useState<PendingTrashWarningState | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] = useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	const lastStreamErrorRef = useRef<string | null>(null);
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setSelectedTaskId(null);
		setIsGitHistoryOpen(false);
		setPendingTaskStartAfterEditId(null);
		taskEditorResetRef.current();
	}, []);
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceMetadata,
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
	const settingsWorkspaceId = navigationCurrentProjectId ?? currentProjectId;
	const { config: settingsRuntimeProjectConfig, refresh: refreshSettingsRuntimeProjectConfig } =
		useRuntimeProjectConfig(settingsWorkspaceId);
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	const shortcuts = runtimeProjectConfig?.shortcuts ?? [];
	const selectedShortcutLabel = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeProjectConfig?.selectedShortcutLabel ?? null;
		if (configured && shortcuts.some((shortcut) => shortcut.label === configured)) {
			return configured;
		}
		return shortcuts[0]?.label ?? null;
	}, [runtimeProjectConfig?.selectedShortcutLabel, shortcuts]);

	const {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
		fetchTaskWorkingChangeCount,
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
		setCanPersistWorkspaceState,
		onWorktreeError: setWorktreeError,
	});

	useEffect(() => {
		replaceWorkspaceMetadata(workspaceMetadata);
	}, [workspaceMetadata]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceMetadataStore();
	}, [isProjectSwitching]);

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
	const queueTaskStartAfterEdit = useCallback((taskId: string) => {
		setPendingTaskStartAfterEditId(taskId);
	}, []);

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
		isEditTaskStartInPlanModeDisabled,
		editTaskBranchRef,
		setEditTaskBranchRef,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleSaveAndStartEditedTask,
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
		onClearWorktreeError: () => setWorktreeError(null),
		queueTaskStartAfterEdit,
	});

	useEffect(() => {
		taskEditorResetRef.current = resetTaskEditorState;
	}, [resetTaskEditorState]);

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
		runtimeProjectConfig,
		sendTaskSessionInput,
		fetchTaskWorkspaceInfo,
		isGitHistoryOpen,
		refreshWorkspaceState,
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
	usePrewarmedAgentTerminals({
		currentProjectId,
		isWorkspaceReady: !isWorkspaceMetadataPending,
		isRuntimeDisconnected,
		board,
		sessions,
		cursorColor: TERMINAL_THEME_COLORS.textPrimary,
		terminalBackgroundColor: TERMINAL_THEME_COLORS.surfacePrimary,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;
	const { runningShortcutLabel, handleSelectShortcutLabel, handleRunShortcut } = useShortcutActions({
		currentProjectId,
		selectedShortcutLabel: runtimeProjectConfig?.selectedShortcutLabel,
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
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetProjectNavigationState();
		resetTerminalPanelsState();
	}, [
		currentProjectId,
		resetGitActionState,
		resetProjectNavigationState,
		resetTaskEditorState,
		resetTerminalPanelsState,
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
		handleStartAllBacklogTasks,
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
		moveToTrashLoadingById,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId,
		currentProjectId,
		setSelectedTaskId,
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

	const {
		handleCreateAndStartTask,
		handleStartTaskWithServiceSetupPrompt,
		handleStartAllBacklogTasksWithServiceSetupPrompt,
		taskStartServicePromptDialogOpen,
		taskStartServicePromptDialogPrompt,
		taskStartServicePromptDoNotShowAgain,
		setTaskStartServicePromptDoNotShowAgain,
		handleCloseTaskStartServicePrompt,
		handleRunTaskStartServiceInstallCommand,
	} = useTaskStartServicePrompts({
		board,
		currentProjectId,
		selectedAgentId: runtimeProjectConfig?.selectedAgentId,
		taskStartSetupAvailability: runtimeProjectConfig?.taskStartSetupAvailability,
		handleCreateTask,
		handleStartTask,
		handleStartAllBacklogTasks,
		prepareTerminalForShortcut,
		prepareWaitForTerminalConnectionReady,
		sendTaskSessionInput,
	});

	useEffect(() => {
		if (!pendingTaskStartAfterEditId) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterEditId);
		if (!selection || selection.column.id !== "backlog") {
			return;
		}
		handleStartTaskWithServiceSetupPrompt(pendingTaskStartAfterEditId);
		setPendingTaskStartAfterEditId(null);
	}, [board, handleStartTaskWithServiceSetupPrompt, pendingTaskStartAfterEditId]);

	const detailSession = selectedCard
		? (sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailTerminalSummary = detailTerminalTaskId ? (sessions[detailTerminalTaskId] ?? null) : null;
	const detailTerminalSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return (
			getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			null
		);
	}, [selectedCard]);

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
		? (getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef)?.path ??
			getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ??
			workspacePath ??
			undefined)
		: shouldUseNavigationPath
			? (navigationProjectPath ?? undefined)
			: (workspacePath ?? undefined);

	const activeWorkspaceHint = useMemo(() => {
		if (!selectedCard) {
			return undefined;
		}
		const activeSelectedTaskWorkspaceInfo = getTaskWorkspaceInfo(selectedCard.card.id, selectedCard.card.baseRef);
		if (!activeSelectedTaskWorkspaceInfo) {
			return undefined;
		}
		if (!activeSelectedTaskWorkspaceInfo.exists) {
			return selectedCard.column.id === "trash" ? "Task worktree deleted" : "Task worktree not created yet";
		}
		return undefined;
	}, [selectedCard]);

	const navbarWorkspacePath = hasNoProjects ? undefined : activeWorkspacePath;
	const navbarWorkspaceHint = hasNoProjects ? undefined : activeWorkspaceHint;
	const navbarRuntimeHint = hasNoProjects ? undefined : runtimeHint;
	const shouldHideProjectDependentTopBarActions =
		!selectedCard && (isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);

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
			onCreateAndStart={handleCreateAndStartTask}
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
			mode="create"
			idPrefix="inline-create-task"
		/>
	) : undefined;

	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			onCreate={handleSaveEditedTask}
			onCreateAndStart={handleSaveAndStartEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			startInPlanModeDisabled={isEditTaskStartInPlanModeDisabled}
			autoReviewEnabled={editTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={setEditTaskAutoReviewEnabled}
			autoReviewMode={editTaskAutoReviewMode}
			onAutoReviewModeChange={setEditTaskAutoReviewMode}
			workspaceId={currentProjectId}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}

	return (
		<div className="flex h-[100svh] min-w-0 overflow-hidden">
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
			<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
				<TopBar
					onBack={selectedCard ? handleBack : undefined}
					workspacePath={navbarWorkspacePath}
					isWorkspacePathLoading={shouldShowProjectLoadingState}
					workspaceHint={navbarWorkspaceHint}
					runtimeHint={navbarRuntimeHint}
					selectedTaskId={selectedCard?.card.id ?? null}
					selectedTaskBaseRef={selectedCard?.card.baseRef ?? null}
					showHomeGitSummary={!hasNoProjects && !selectedCard}
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
						shortcuts={shortcuts}
					selectedShortcutLabel={selectedShortcutLabel}
					onSelectShortcutLabel={handleSelectShortcutLabel}
					runningShortcutLabel={runningShortcutLabel}
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
				<div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
					<div
						className="kb-home-layout"
						aria-hidden={selectedCard ? true : undefined}
						style={selectedCard ? { visibility: "hidden" } : undefined}
					>
						{shouldShowProjectLoadingState ? (
							<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
								<Spinner size={30} />
							</div>
						) : hasNoProjects ? (
							<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
								<div className="flex flex-col items-center justify-center gap-3 text-text-tertiary">
									<FolderOpen size={48} strokeWidth={1} />
									<h3 className="text-sm font-semibold text-text-primary">No projects yet</h3>
									<p className="text-[13px] text-text-secondary">Add a git repository to start using Kanban.</p>
									<Button
										variant="primary"
										onClick={() => {
											void handleAddProject();
										}}
									>
										Add project
									</Button>
								</div>
							</div>
						) : (
							<div className="flex flex-1 flex-col min-h-0 min-w-0">
								<div className="flex flex-1 min-h-0 min-w-0">
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
											onStartTask={handleStartTaskWithServiceSetupPrompt}
											onStartAllTasks={handleStartAllBacklogTasksWithServiceSetupPrompt}
											onClearTrash={handleOpenClearTrash}
											inlineTaskCreator={inlineTaskCreator}
											editingTaskId={editingTaskId}
											inlineTaskEditor={inlineTaskEditor}
											onEditTask={handleOpenEditTask}
											onCommitTask={handleCommitTask}
											onOpenPrTask={handleOpenPrTask}
											onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
											commitTaskLoadingById={commitTaskLoadingById}
											openPrTaskLoadingById={openPrTaskLoadingById}
											moveToTrashLoadingById={moveToTrashLoadingById}
											onMoveToTrashTask={handleMoveReviewCardToTrash}
											onRestoreFromTrashTask={handleRestoreTaskFromTrash}
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
										<div className="flex flex-1 min-w-0 px-3">
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
										panelBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
										terminalBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
										cursorColor={TERMINAL_THEME_COLORS.textPrimary}
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
						<div className="absolute inset-0 flex min-h-0 min-w-0">
							<CardDetailView
								selection={selectedCard}
								currentProjectId={currentProjectId}
								sessionSummary={detailSession}
								taskSessions={sessions}
								onSessionSummary={upsertSession}
								onBack={handleBack}
								onCardSelect={handleCardSelect}
								onTaskDragEnd={handleDetailTaskDragEnd}
								onCreateTask={handleOpenCreateTask}
								onStartTask={handleStartTaskWithServiceSetupPrompt}
								onStartAllTasks={handleStartAllBacklogTasksWithServiceSetupPrompt}
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
								moveToTrashLoadingById={moveToTrashLoadingById}
								onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
								onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
								onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
								onAddReviewComments={(taskId: string, text: string) => {
									void handleAddReviewComments(taskId, text);
								}}
								onSendReviewComments={(taskId: string, text: string) => {
									void handleSendReviewComments(taskId, text);
								}}
								onMoveToTrash={handleMoveToTrash}
								isMoveToTrashLoading={moveToTrashLoadingById[selectedCard.card.id] ?? false}
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
								isDocumentVisible={isDocumentVisible}
							/>
						</div>
					) : null}
				</div>
			</div>
				<RuntimeSettingsDialog
				open={isSettingsOpen}
				workspaceId={settingsWorkspaceId}
				initialConfig={settingsRuntimeProjectConfig}
				initialSection={settingsInitialSection}
				onOpenChange={(nextOpen) => {
					setIsSettingsOpen(nextOpen);
					if (!nextOpen) {
						setSettingsInitialSection(null);
					}
				}}
				onSaved={() => {
					refreshRuntimeProjectConfig();
					refreshSettingsRuntimeProjectConfig();
				}}
			/>
			<ClearTrashDialog
				open={isClearTrashDialogOpen}
				taskCount={trashTaskCount}
				onCancel={() => setIsClearTrashDialogOpen(false)}
				onConfirm={handleConfirmClearTrash}
			/>
			<TaskStartServicePromptDialog
				open={taskStartServicePromptDialogOpen}
				prompt={taskStartServicePromptDialogPrompt}
				doNotShowAgain={taskStartServicePromptDoNotShowAgain}
				onDoNotShowAgainChange={setTaskStartServicePromptDoNotShowAgain}
				onClose={handleCloseTaskStartServicePrompt}
				onRunInstallCommand={handleRunTaskStartServiceInstallCommand}
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
			<AlertDialog
				open={gitActionError !== null}
				onOpenChange={(open) => {
					if (!open) {
						clearGitActionError();
					}
				}}
			>
				<AlertDialogTitle className="text-sm font-semibold text-text-primary mb-2">
					{gitActionErrorTitle}
				</AlertDialogTitle>
				<p className="text-[13px] text-text-secondary mb-3">{gitActionError?.message}</p>
				{gitActionError?.output ? (
					<pre className="rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap overflow-auto max-h-[220px] mb-4">
						{gitActionError.output}
					</pre>
				) : null}
				<div className="flex justify-end">
					<AlertDialogAction asChild>
						<Button variant="default" onClick={clearGitActionError}>
							Close
						</Button>
					</AlertDialogAction>
				</div>
			</AlertDialog>
		</div>
	);
}
