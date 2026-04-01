import type { DropResult } from "@hello-pangea/dnd";
import { GitCompareArrows, Maximize2, Minimize2, X } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import DynamicPanels from "@/components/DynamicPanels";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ClineAgentChatPanel, type ClineAgentChatPanelHandle } from "@/components/detail-panels/cline-agent-chat-panel";
import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import { type DiffLineComment, DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { ResizableBottomPane } from "@/components/resizable-bottom-pane";
import { Button } from "@/components/ui/button";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { isNativeClineAgentSelected } from "@/runtime/native-agent";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesMode,
} from "@/runtime/types";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";
import { useTaskWorkspaceStateVersionValue } from "@/stores/workspace-metadata-store";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import { type BoardCard, type CardSelection, getTaskAutoReviewCancelButtonLabel } from "@/types";
import { useWindowEvent } from "@/utils/react-use";
import type { LayoutState, TabData } from "./dynamic-panels/layoutTypes";

// ── Constants ──

const DETAIL_DIFF_POLL_INTERVAL_MS = 1_000;
const FILE_TREE_PANEL_FLEX = "0 0 33.3333%";

// ── Well-known tab IDs ──

const TAB_TASKS = "tasks";
const TAB_AGENT = "agent";
const TAB_CHANGES = "changes";

// ── Initial layout: [Tasks | Agent | Changes] ──

const DETAIL_LAYOUT: LayoutState = {
	root: {
		type: "split",
		id: "detail-root",
		direction: "horizontal",
		children: [
			{
				type: "panel",
				id: "panel-tasks",
				tabs: [{ id: TAB_TASKS, title: "Tasks", closable: false }],
				activeTabId: TAB_TASKS,
			},
			{
				type: "panel",
				id: "panel-agent",
				tabs: [{ id: TAB_AGENT, title: "Agent", closable: false }],
				activeTabId: TAB_AGENT,
			},
			{
				type: "panel",
				id: "panel-changes",
				tabs: [{ id: TAB_CHANGES, title: "Changes", closable: false }],
				activeTabId: TAB_CHANGES,
			},
		],
		sizes: [20, 40, 40],
	},
};

// ── Helper components ──

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isEventInsideDialog(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[role='dialog']") !== null;
}

function WorkspaceChangesLoadingPanel(): React.ReactElement {
	return (
		<div style={{ display: "flex", flex: "1 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
			<div
				style={{
					display: "flex",
					flex: "1 1 0",
					flexDirection: "column",
					borderRight: "1px solid var(--color-divider)",
				}}
			>
				<div style={{ padding: "10px 10px 6px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
						<div className="kb-skeleton" style={{ height: 14, width: "62%", borderRadius: 3 }} />
						<div className="kb-skeleton" style={{ height: 16, width: 42, borderRadius: 999 }} />
					</div>
					<div className="kb-skeleton" style={{ height: 13, width: "92%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "84%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "95%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "79%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "88%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "76%", borderRadius: 3 }} />
				</div>
				<div style={{ flex: "1 1 0" }} />
			</div>
			<div
				style={{
					display: "flex",
					flex: FILE_TREE_PANEL_FLEX,
					flexDirection: "column",
					padding: "10px 8px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className="kb-skeleton" style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "61%", borderRadius: 3 }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className="kb-skeleton" style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "70%", borderRadius: 3 }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className="kb-skeleton" style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "53%", borderRadius: 3 }} />
				</div>
				<div style={{ flex: "1 1 0" }} />
			</div>
		</div>
	);
}

function WorkspaceChangesEmptyPanel({ title }: { title: string }): React.ReactElement {
	return (
		<div style={{ display: "flex", flex: "1 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
			<div className="kb-empty-state-center" style={{ flex: 1 }}>
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
					<GitCompareArrows size={40} />
					<h3 className="font-semibold text-text-secondary">{title}</h3>
				</div>
			</div>
		</div>
	);
}

function DiffToolbar({
	mode,
	onModeChange,
	isExpanded,
	onToggleExpand,
}: {
	mode: RuntimeWorkspaceChangesMode;
	onModeChange: (mode: RuntimeWorkspaceChangesMode) => void;
	isExpanded: boolean;
	onToggleExpand: () => void;
}): React.ReactElement {
	return (
		<div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: "1px solid var(--color-divider)" }}>
			{isExpanded ? (
				<Button
					variant="ghost"
					size="sm"
					icon={<X size={14} />}
					onClick={onToggleExpand}
					className="h-5"
					aria-label="Collapse expanded diff view"
				/>
			) : null}
			<div className="inline-flex items-center gap-0.5 rounded-md p-0.5">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onModeChange("working_copy")}
					className="h-5 rounded-sm text-xs"
					style={
						mode === "working_copy"
							? { backgroundColor: "var(--color-surface-3)", color: "var(--color-text-primary)" }
							: undefined
					}
				>
					All Changes
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onModeChange("last_turn")}
					className="h-5 rounded-sm text-xs"
					style={
						mode === "last_turn"
							? { backgroundColor: "var(--color-surface-3)", color: "var(--color-text-primary)" }
							: undefined
					}
				>
					Last Turn
				</Button>
			</div>
			<Button
				variant="ghost"
				size="sm"
				icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
				onClick={onToggleExpand}
				className="ml-auto h-5"
				aria-label={isExpanded ? "Collapse split diff view" : "Expand split diff view"}
			/>
		</div>
	);
}

// ── Main component ──

export function CardDetailView({
	selection,
	currentProjectId,
	workspacePath,
	selectedAgentId = null,
	runtimeConfig = null,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	onStartTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onAgentCommitTask,
	onAgentOpenPrTask,
	onMoveReviewCardToTrash,
	onRestoreTaskFromTrash,
	onCancelAutomaticTaskAction,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	agentCommitTaskLoadingById,
	agentOpenPrTaskLoadingById,
	moveToTrashLoadingById,
	onAddReviewComments,
	onSendReviewComments,
	onSendClineChatMessage,
	onCancelClineChatTurn,
	onLoadClineChatMessages,
	latestClineChatMessage,
	streamedClineChatMessages,
	onMoveToTrash,
	isMoveToTrashLoading,
	gitHistoryPanel,
	onCloseGitHistory,
	bottomTerminalOpen,
	bottomTerminalTaskId,
	bottomTerminalSummary,
	bottomTerminalSubtitle,
	onBottomTerminalClose,
	bottomTerminalPaneHeight,
	onBottomTerminalPaneHeightChange,
	onBottomTerminalConnectionReady,
	bottomTerminalAgentCommand,
	onBottomTerminalSendAgentCommand,
	isBottomTerminalExpanded,
	onBottomTerminalToggleExpand,
	isDocumentVisible = true,
	onClineSettingsSaved,
}: {
	selection: CardSelection;
	currentProjectId: string | null;
	workspacePath?: string | null;
	selectedAgentId?: RuntimeAgentId | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onAgentCommitTask?: (taskId: string) => void;
	onAgentOpenPrTask?: (taskId: string) => void;
	onMoveReviewCardToTrash?: (taskId: string) => void;
	onRestoreTaskFromTrash?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	agentCommitTaskLoadingById?: Record<string, boolean>;
	agentOpenPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onAddReviewComments?: (taskId: string, text: string) => void;
	onSendReviewComments?: (taskId: string, text: string) => void;
	onSendClineChatMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<ClineChatActionResult>;
	onCancelClineChatTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadClineChatMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	latestClineChatMessage?: ClineChatMessage | null;
	streamedClineChatMessages?: ClineChatMessage[] | null;
	onMoveToTrash: () => void;
	isMoveToTrashLoading?: boolean;
	gitHistoryPanel?: ReactNode;
	onCloseGitHistory?: () => void;
	bottomTerminalOpen: boolean;
	bottomTerminalTaskId: string | null;
	bottomTerminalSummary: RuntimeTaskSessionSummary | null;
	bottomTerminalSubtitle?: string | null;
	onBottomTerminalClose: () => void;
	bottomTerminalPaneHeight?: number;
	onBottomTerminalPaneHeightChange?: (height: number) => void;
	onBottomTerminalConnectionReady?: (taskId: string) => void;
	bottomTerminalAgentCommand?: string | null;
	onBottomTerminalSendAgentCommand?: () => void;
	isBottomTerminalExpanded?: boolean;
	onBottomTerminalToggleExpand?: () => void;
	isDocumentVisible?: boolean;
	onClineSettingsSaved?: () => void;
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffComments, setDiffComments] = useState<Map<string, DiffLineComment>>(new Map());
	const [diffMode, setDiffMode] = useState<RuntimeWorkspaceChangesMode>("working_copy");
	const [isDiffExpanded, setIsDiffExpanded] = useState(false);
	const clineAgentChatPanelRef = useRef<ClineAgentChatPanelHandle | null>(null);

	const taskWorkspaceStateVersion = useTaskWorkspaceStateVersionValue(selection.card.id);
	const lastTurnViewKey =
		diffMode === "last_turn"
			? [
					sessionSummary?.state ?? "none",
					sessionSummary?.latestTurnCheckpoint?.commit ?? "none",
					sessionSummary?.previousTurnCheckpoint?.commit ?? "none",
				].join(":")
			: null;
	const { changes: workspaceChanges, isRuntimeAvailable } = useRuntimeWorkspaceChanges(
		selection.card.id,
		currentProjectId,
		selection.card.baseRef,
		diffMode,
		taskWorkspaceStateVersion,
		isDocumentVisible && !gitHistoryPanel && selection.column.id !== "trash" ? DETAIL_DIFF_POLL_INTERVAL_MS : null,
		lastTurnViewKey,
		true,
	);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const isWorkspaceChangesPending = isRuntimeAvailable && workspaceChanges === null;
	const hasNoWorkspaceFileChanges =
		isRuntimeAvailable && workspaceChanges !== null && runtimeFiles !== null && runtimeFiles.length === 0;
	const emptyDiffTitle = diffMode === "last_turn" ? "No changes since last turn" : "No working changes";
	const showMoveToTrashActions = selection.column.id === "review" || selection.column.id === "in_progress";
	const isTaskTerminalEnabled = selection.column.id === "in_progress" || selection.column.id === "review";
	const showClineAgentChatPanel = isNativeClineAgentSelected(sessionSummary?.agentId ?? selectedAgentId);
	const availablePaths = useMemo(() => {
		if (!runtimeFiles || runtimeFiles.length === 0) {
			return [];
		}
		return runtimeFiles.map((file) => file.path);
	}, [runtimeFiles]);

	const handleSelectAdjacentCard = useCallback(
		(step: number) => {
			const cards = selection.column.cards;
			const currentIndex = cards.findIndex((card) => card.id === selection.card.id);
			if (currentIndex === -1) {
				return;
			}
			const nextIndex = (currentIndex + step + cards.length) % cards.length;
			const nextCard = cards[nextIndex];
			if (nextCard) {
				onCardSelect(nextCard.id);
			}
		},
		[onCardSelect, selection.card.id, selection.column.cards],
	);

	useHotkeys(
		"up,left",
		() => {
			handleSelectAdjacentCard(-1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useWindowEvent(
		"keydown",
		useCallback(
			(event: KeyboardEvent) => {
				if (event.key !== "Escape" || event.defaultPrevented || isEventInsideDialog(event.target)) {
					return;
				}
				if (gitHistoryPanel && onCloseGitHistory) {
					event.preventDefault();
					onCloseGitHistory();
					return;
				}
				if (isTypingTarget(event.target)) {
					return;
				}
				if (isDiffExpanded) {
					event.preventDefault();
					setIsDiffExpanded(false);
				}
			},
			[gitHistoryPanel, isDiffExpanded, onCloseGitHistory],
		),
	);

	useHotkeys(
		"down,right",
		() => {
			handleSelectAdjacentCard(1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	useEffect(() => {
		setDiffComments(new Map());
	}, [selection.card.id]);

	useEffect(() => {
		setDiffMode("working_copy");
	}, [selection.card.id]);

	const handleToggleDiffExpand = useCallback(() => {
		if (!isDiffExpanded && bottomTerminalOpen) {
			onBottomTerminalClose();
		}
		setIsDiffExpanded((previous) => !previous);
	}, [bottomTerminalOpen, isDiffExpanded, onBottomTerminalClose]);

	const handleAddDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				clineAgentChatPanelRef.current?.appendToDraft(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onAddReviewComments?.(selection.card.id, formatted);
		},
		[onAddReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	const handleSendDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				void clineAgentChatPanelRef.current?.sendText(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onSendReviewComments?.(selection.card.id, formatted);
			setIsDiffExpanded(false);
		},
		[onSendReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	// ── Tab content renderer ──

	const renderTabContent = useCallback(
		(tab: TabData): React.ReactNode => {
			switch (tab.id) {
				case TAB_TASKS:
					return (
						<ColumnContextPanel
							selection={selection}
							workspacePath={workspacePath}
							onCardSelect={onCardSelect}
							taskSessions={taskSessions}
							onTaskDragEnd={onTaskDragEnd}
							onCreateTask={onCreateTask}
							onStartTask={onStartTask}
							onStartAllTasks={onStartAllTasks}
							onClearTrash={onClearTrash}
							editingTaskId={editingTaskId}
							inlineTaskEditor={inlineTaskEditor}
							onEditTask={onEditTask}
							onCommitTask={onCommitTask}
							onOpenPrTask={onOpenPrTask}
							onMoveToTrashTask={onMoveReviewCardToTrash}
							onRestoreFromTrashTask={onRestoreTaskFromTrash}
							commitTaskLoadingById={commitTaskLoadingById}
							openPrTaskLoadingById={openPrTaskLoadingById}
							moveToTrashLoadingById={moveToTrashLoadingById}
						/>
					);

				case TAB_AGENT:
					if (showClineAgentChatPanel) {
						return (
							<ClineAgentChatPanel
								ref={clineAgentChatPanelRef}
								taskId={selection.card.id}
								summary={sessionSummary}
								taskColumnId={selection.column.id}
								defaultMode={selection.card.startInPlanMode ? "plan" : "act"}
								workspaceId={currentProjectId}
								runtimeConfig={runtimeConfig}
								onClineSettingsSaved={onClineSettingsSaved}
								onSendMessage={onSendClineChatMessage}
								onCancelTurn={onCancelClineChatTurn}
								onLoadMessages={onLoadClineChatMessages}
								incomingMessages={streamedClineChatMessages}
								incomingMessage={latestClineChatMessage}
								onCommit={onAgentCommitTask ? () => onAgentCommitTask(selection.card.id) : undefined}
								onOpenPr={onAgentOpenPrTask ? () => onAgentOpenPrTask(selection.card.id) : undefined}
								isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
								isOpenPrLoading={agentOpenPrTaskLoadingById?.[selection.card.id] ?? false}
								showMoveToTrash={showMoveToTrashActions}
								onMoveToTrash={onMoveToTrash}
								isMoveToTrashLoading={isMoveToTrashLoading}
								onCancelAutomaticAction={
									selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
										? () => onCancelAutomaticTaskAction(selection.card.id)
										: undefined
								}
								cancelAutomaticActionLabel={
									selection.card.autoReviewEnabled === true
										? getTaskAutoReviewCancelButtonLabel(selection.card.autoReviewMode)
										: null
								}
							/>
						);
					}
					return (
						<AgentTerminalPanel
							taskId={selection.card.id}
							workspaceId={currentProjectId}
							terminalEnabled={isTaskTerminalEnabled}
							summary={sessionSummary}
							onSummary={onSessionSummary}
							onCommit={onAgentCommitTask ? () => onAgentCommitTask(selection.card.id) : undefined}
							onOpenPr={onAgentOpenPrTask ? () => onAgentOpenPrTask(selection.card.id) : undefined}
							isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
							isOpenPrLoading={agentOpenPrTaskLoadingById?.[selection.card.id] ?? false}
							showSessionToolbar={false}
							autoFocus
							showMoveToTrash={showMoveToTrashActions}
							onMoveToTrash={onMoveToTrash}
							isMoveToTrashLoading={isMoveToTrashLoading}
							onCancelAutomaticAction={
								selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
									? () => onCancelAutomaticTaskAction(selection.card.id)
									: undefined
							}
							cancelAutomaticActionLabel={
								selection.card.autoReviewEnabled === true
									? getTaskAutoReviewCancelButtonLabel(selection.card.autoReviewMode)
									: null
							}
							panelBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
							terminalBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
							showRightBorder={false}
							taskColumnId={selection.column.id}
						/>
					);

				case TAB_CHANGES:
					return (
						<div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
							{isRuntimeAvailable ? (
								<DiffToolbar
									mode={diffMode}
									onModeChange={setDiffMode}
									isExpanded={isDiffExpanded}
									onToggleExpand={handleToggleDiffExpand}
								/>
							) : null}
							<div style={{ display: "flex", flex: "1 1 0", minHeight: 0 }}>
								{isWorkspaceChangesPending ? (
									<WorkspaceChangesLoadingPanel />
								) : hasNoWorkspaceFileChanges ? (
									<WorkspaceChangesEmptyPanel title={emptyDiffTitle} />
								) : (
									<>
										<DiffViewerPanel
											workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
											selectedPath={selectedPath}
											onSelectedPathChange={setSelectedPath}
											viewMode={isDiffExpanded ? "split" : "unified"}
											onAddToTerminal={
												onAddReviewComments || showClineAgentChatPanel ? handleAddDiffComments : undefined
											}
											onSendToTerminal={
												onSendReviewComments || showClineAgentChatPanel ? handleSendDiffComments : undefined
											}
											comments={diffComments}
											onCommentsChange={setDiffComments}
										/>
										<FileTreePanel
											workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
											selectedPath={selectedPath}
											onSelectPath={setSelectedPath}
											panelFlex={FILE_TREE_PANEL_FLEX}
										/>
									</>
								)}
							</div>
						</div>
					);

				default:
					return null;
			}
		},
		// All the props/state that any tab content depends on
		[
			selection,
			workspacePath,
			onCardSelect,
			taskSessions,
			onTaskDragEnd,
			onCreateTask,
			onStartTask,
			onStartAllTasks,
			onClearTrash,
			editingTaskId,
			inlineTaskEditor,
			onEditTask,
			onCommitTask,
			onOpenPrTask,
			onMoveReviewCardToTrash,
			onRestoreTaskFromTrash,
			commitTaskLoadingById,
			openPrTaskLoadingById,
			moveToTrashLoadingById,
			showClineAgentChatPanel,
			sessionSummary,
			currentProjectId,
			runtimeConfig,
			onClineSettingsSaved,
			onSendClineChatMessage,
			onCancelClineChatTurn,
			onLoadClineChatMessages,
			streamedClineChatMessages,
			latestClineChatMessage,
			onAgentCommitTask,
			onAgentOpenPrTask,
			agentCommitTaskLoadingById,
			agentOpenPrTaskLoadingById,
			showMoveToTrashActions,
			onMoveToTrash,
			isMoveToTrashLoading,
			onCancelAutomaticTaskAction,
			isTaskTerminalEnabled,
			onSessionSummary,
			isRuntimeAvailable,
			diffMode,
			isDiffExpanded,
			handleToggleDiffExpand,
			isWorkspaceChangesPending,
			hasNoWorkspaceFileChanges,
			emptyDiffTitle,
			runtimeFiles,
			selectedPath,
			onAddReviewComments,
			handleAddDiffComments,
			onSendReviewComments,
			handleSendDiffComments,
			diffComments,
		],
	);

	// ── Render ──

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				flex: "1 1 0",
				minHeight: 0,
				overflow: "hidden",
				background: "var(--color-surface-0)",
			}}
		>
			{gitHistoryPanel ? (
				<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>{gitHistoryPanel}</div>
			) : (
				<>
					<DynamicPanels
						initialLayout={DETAIL_LAYOUT}
						renderTabContent={renderTabContent}
						persistenceKey="card-detail-layout"
						className="flex-1 min-h-0"
					/>
					{bottomTerminalOpen && bottomTerminalTaskId ? (
						<ResizableBottomPane
							minHeight={200}
							initialHeight={bottomTerminalPaneHeight}
							onHeightChange={onBottomTerminalPaneHeightChange}
						>
							<div
								style={{
									display: "flex",
									flex: "1 1 0",
									minWidth: 0,
									paddingLeft: 12,
									paddingRight: 12,
								}}
							>
								<AgentTerminalPanel
									key={`detail-shell-${bottomTerminalTaskId}`}
									taskId={bottomTerminalTaskId}
									workspaceId={currentProjectId}
									summary={bottomTerminalSummary}
									onSummary={onSessionSummary}
									showSessionToolbar={false}
									autoFocus
									onClose={onBottomTerminalClose}
									minimalHeaderTitle="Terminal"
									minimalHeaderSubtitle={bottomTerminalSubtitle}
									panelBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
									terminalBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
									cursorColor={TERMINAL_THEME_COLORS.textPrimary}
									showRightBorder={false}
									onConnectionReady={onBottomTerminalConnectionReady}
									agentCommand={bottomTerminalAgentCommand}
									onSendAgentCommand={onBottomTerminalSendAgentCommand}
									isExpanded={isBottomTerminalExpanded}
									onToggleExpand={onBottomTerminalToggleExpand}
								/>
							</div>
						</ResizableBottomPane>
					) : null}
				</>
			)}
		</div>
	);
}
