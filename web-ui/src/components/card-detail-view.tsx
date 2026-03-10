import { Classes, Colors, NonIdealState } from "@blueprintjs/core";
import type { DropResult } from "@hello-pangea/dnd";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import { type DiffLineComment, DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { ResizableBottomPane } from "@/components/resizable-bottom-pane";
import { panelSeparatorColor } from "@/data/column-colors";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";
import {
	type BoardCard,
	type CardSelection,
	getTaskAutoReviewActionLabel,
	type ReviewTaskWorkspaceSnapshot,
} from "@/types";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function WorkspaceChangesLoadingPanel(): React.ReactElement {
	return (
		<div style={{ display: "flex", flex: "1.6 1 0", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1 }}>
			<div
				style={{
					display: "flex",
					flex: "1 1 0",
					flexDirection: "column",
					borderRight: `1px solid ${panelSeparatorColor}`,
				}}
			>
				<div
					style={{
						padding: "10px 10px 6px",
					}}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
						<div className={Classes.SKELETON} style={{ height: 14, width: "62%", borderRadius: 3 }} />
						<div className={Classes.SKELETON} style={{ height: 16, width: 42, borderRadius: 999 }} />
					</div>
					<div
						className={Classes.SKELETON}
						style={{ height: 13, width: "92%", borderRadius: 3, marginBottom: 7 }}
					/>
					<div
						className={Classes.SKELETON}
						style={{ height: 13, width: "84%", borderRadius: 3, marginBottom: 7 }}
					/>
					<div
						className={Classes.SKELETON}
						style={{ height: 13, width: "95%", borderRadius: 3, marginBottom: 7 }}
					/>
					<div
						className={Classes.SKELETON}
						style={{ height: 13, width: "79%", borderRadius: 3, marginBottom: 7 }}
					/>
					<div
						className={Classes.SKELETON}
						style={{ height: 13, width: "88%", borderRadius: 3, marginBottom: 7 }}
					/>
					<div className={Classes.SKELETON} style={{ height: 13, width: "76%", borderRadius: 3 }} />
				</div>
				<div style={{ flex: "1 1 0" }} />
			</div>
			<div
				style={{
					display: "flex",
					flex: "0.6 1 0",
					flexDirection: "column",
					padding: "10px 8px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className={Classes.SKELETON} style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className={Classes.SKELETON} style={{ height: 13, width: "61%", borderRadius: 3 }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className={Classes.SKELETON} style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className={Classes.SKELETON} style={{ height: 13, width: "70%", borderRadius: 3 }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className={Classes.SKELETON} style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className={Classes.SKELETON} style={{ height: 13, width: "53%", borderRadius: 3 }} />
				</div>
				<div style={{ flex: "1 1 0" }} />
			</div>
		</div>
	);
}

function WorkspaceChangesEmptyPanel(): React.ReactElement {
	return (
		<div style={{ display: "flex", flex: "1.6 1 0", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1 }}>
			<div className="kb-empty-state-center" style={{ flex: 1 }}>
				<NonIdealState icon="comparison" title="No working changes" />
			</div>
		</div>
	);
}

export function CardDetailView({
	selection,
	currentProjectId,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onBack,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	onStartTask,
	onClearTrash,
	inlineTaskCreator,
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
	reviewWorkspaceSnapshots,
	onAddReviewComments,
	onSendReviewComments,
	onMoveToTrash,
	gitHistoryPanel,
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
}: {
	selection: CardSelection;
	currentProjectId: string | null;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onBack: () => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onClearTrash?: () => void;
	inlineTaskCreator?: ReactNode;
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
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
	onAddReviewComments?: (taskId: string, text: string) => void;
	onSendReviewComments?: (taskId: string, text: string) => void;
	onMoveToTrash: () => void;
	gitHistoryPanel?: ReactNode;
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
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffComments, setDiffComments] = useState<Map<string, DiffLineComment>>(new Map());
	const {
		changes: workspaceChanges,
		isRuntimeAvailable,
		refresh,
	} = useRuntimeWorkspaceChanges(selection.card.id, currentProjectId, selection.card.baseRef);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const isWorkspaceChangesPending = isRuntimeAvailable && workspaceChanges === null;
	const hasNoWorkspaceFileChanges =
		isRuntimeAvailable && workspaceChanges !== null && runtimeFiles !== null && runtimeFiles.length === 0;
	const selectedReviewWorkspaceSnapshot = reviewWorkspaceSnapshots?.[selection.card.id];
	const showReviewGitActions =
		selection.column.id === "review" && (selectedReviewWorkspaceSnapshot?.changedFiles ?? 0) > 0;
	const showMoveToTrashActions = selection.column.id === "review" || selection.column.id === "in_progress";
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
		"esc",
		() => {
			onBack();
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[onBack],
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
		void refresh();
	}, [refresh, sessionSummary?.state]);

	return (
		<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden", background: Colors.DARK_GRAY1 }}>
			<ColumnContextPanel
				selection={selection}
				onCardSelect={onCardSelect}
				taskSessions={taskSessions}
				onTaskDragEnd={onTaskDragEnd}
				onCreateTask={onCreateTask}
				onStartTask={onStartTask}
				onClearTrash={onClearTrash}
				inlineTaskCreator={inlineTaskCreator}
				editingTaskId={editingTaskId}
				inlineTaskEditor={inlineTaskEditor}
				onEditTask={onEditTask}
				onCommitTask={onCommitTask}
				onOpenPrTask={onOpenPrTask}
				onMoveToTrashTask={onMoveReviewCardToTrash}
				onRestoreFromTrashTask={onRestoreTaskFromTrash}
				commitTaskLoadingById={commitTaskLoadingById}
				openPrTaskLoadingById={openPrTaskLoadingById}
				reviewWorkspaceSnapshots={reviewWorkspaceSnapshots}
			/>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					width: "80%",
					minWidth: 0,
					minHeight: 0,
					overflow: "hidden",
				}}
			>
				{gitHistoryPanel ? (
					<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>{gitHistoryPanel}</div>
				) : (
					<>
						<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
							<AgentTerminalPanel
								taskId={selection.card.id}
								workspaceId={currentProjectId}
								summary={sessionSummary}
								onSummary={onSessionSummary}
								onCommit={onAgentCommitTask ? () => onAgentCommitTask(selection.card.id) : undefined}
								onOpenPr={onAgentOpenPrTask ? () => onAgentOpenPrTask(selection.card.id) : undefined}
								isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
								isOpenPrLoading={agentOpenPrTaskLoadingById?.[selection.card.id] ?? false}
								showSessionToolbar={false}
								autoFocus
								showReviewGitActions={showReviewGitActions}
								showMoveToTrash={showMoveToTrashActions}
								onMoveToTrash={onMoveToTrash}
								onCancelAutomaticAction={
									selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
										? () => onCancelAutomaticTaskAction(selection.card.id)
										: undefined
								}
								cancelAutomaticActionLabel={
									selection.card.autoReviewEnabled === true
										? getTaskAutoReviewActionLabel(selection.card.autoReviewMode)
										: null
								}
							/>
							{isWorkspaceChangesPending ? (
								<WorkspaceChangesLoadingPanel />
							) : hasNoWorkspaceFileChanges ? (
								<WorkspaceChangesEmptyPanel />
							) : (
								<>
									<DiffViewerPanel
										workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
										selectedPath={selectedPath}
										onSelectedPathChange={setSelectedPath}
										onAddToTerminal={
											onAddReviewComments
												? (formatted) => onAddReviewComments(selection.card.id, formatted)
												: undefined
										}
										onSendToTerminal={
											onSendReviewComments
												? (formatted) => onSendReviewComments(selection.card.id, formatted)
												: undefined
										}
										comments={diffComments}
										onCommentsChange={setDiffComments}
									/>
									<FileTreePanel
										workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
										selectedPath={selectedPath}
										onSelectPath={setSelectedPath}
									/>
								</>
							)}
						</div>
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
										paddingLeft: "calc(var(--bp-surface-spacing) * 3)",
										paddingRight: "calc(var(--bp-surface-spacing) * 3)",
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
										panelBackgroundColor={Colors.DARK_GRAY2}
										terminalBackgroundColor={Colors.DARK_GRAY2}
										cursorColor={Colors.LIGHT_GRAY5}
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
		</div>
	);
}
