import { Colors } from "@blueprintjs/core";
import type { DropResult } from "@hello-pangea/dnd";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AgentTerminalPanel } from "@/kanban/components/detail-panels/agent-terminal-panel";
import { ColumnContextPanel } from "@/kanban/components/detail-panels/column-context-panel";
import { DiffViewerPanel } from "@/kanban/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/kanban/components/detail-panels/file-tree-panel";
import { useRuntimeWorkspaceChanges } from "@/kanban/runtime/use-runtime-workspace-changes";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard, CardSelection, ReviewTaskWorkspaceSnapshot } from "@/kanban/types";

const WORKSPACE_CHANGES_POLL_INTERVAL_MS = 1500;

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
	onMoveReviewCardToTrash,
	reviewWorkspaceSnapshots,
	onMoveToTrash,
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
	onMoveReviewCardToTrash?: (taskId: string) => void;
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
	onMoveToTrash: () => void;
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const { changes: workspaceChanges, isRuntimeAvailable, refresh } = useRuntimeWorkspaceChanges(
		selection.card.id,
		currentProjectId,
		selection.card.baseRef ?? null,
	);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const availablePaths = useMemo(() => {
		if (!runtimeFiles || runtimeFiles.length === 0) {
			return [];
		}
		return runtimeFiles.map((file) => file.path);
	}, [runtimeFiles]);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement | null;
			const isTypingTarget =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (isTypingTarget) {
				return;
			}

			if (event.key === "Escape") {
				onBack();
				return;
			}

			const cards = selection.column.cards;
			const currentIndex = cards.findIndex((card) => card.id === selection.card.id);
			if (currentIndex === -1) {
				return;
			}

			if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
				event.preventDefault();
				const previousIndex = (currentIndex - 1 + cards.length) % cards.length;
				const previousCard = cards[previousIndex];
				if (previousCard) {
					onCardSelect(previousCard.id);
				}
				return;
			}

			if (event.key === "ArrowDown" || event.key === "ArrowRight") {
				event.preventDefault();
				const nextIndex = (currentIndex + 1) % cards.length;
				const nextCard = cards[nextIndex];
				if (nextCard) {
					onCardSelect(nextCard.id);
				}
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onBack, onCardSelect, selection.card.id, selection.column.cards]);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	useEffect(() => {
		void refresh();
	}, [refresh, sessionSummary?.state]);

	useEffect(() => {
		const state = sessionSummary?.state;
		const shouldPoll = state === "running" || state === "awaiting_review";
		if (!shouldPoll) {
			return;
		}

		const intervalId = window.setInterval(() => {
			if (typeof document !== "undefined" && document.visibilityState !== "visible") {
				return;
			}
			void refresh();
		}, WORKSPACE_CHANGES_POLL_INTERVAL_MS);

		return () => {
			window.clearInterval(intervalId);
		};
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
				reviewWorkspaceSnapshots={reviewWorkspaceSnapshots}
				/>
				<div style={{ display: "flex", flexDirection: "column", width: "80%", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
					<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>
						<AgentTerminalPanel
							taskId={selection.card.id}
							workspaceId={currentProjectId}
							summary={sessionSummary}
							onSummary={onSessionSummary}
							showMoveToTrash={selection.column.id === "review"}
							onMoveToTrash={onMoveToTrash}
						/>
					<DiffViewerPanel
						workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
						selectedPath={selectedPath}
						onSelectedPathChange={setSelectedPath}
					/>
					<FileTreePanel
						workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
						selectedPath={selectedPath}
						onSelectPath={setSelectedPath}
					/>
				</div>
			</div>
		</div>
	);
}
