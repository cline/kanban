import type { DropResult } from "@hello-pangea/dnd";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { AgentTerminalPanel } from "@/kanban/components/detail-panels/agent-terminal-panel";
import { ColumnContextPanel } from "@/kanban/components/detail-panels/column-context-panel";
import { DiffViewerPanel } from "@/kanban/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/kanban/components/detail-panels/file-tree-panel";
import { useRuntimeWorkspaceChanges } from "@/kanban/runtime/use-runtime-workspace-changes";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { CardSelection } from "@/kanban/types";

const WORKSPACE_CHANGES_POLL_INTERVAL_MS = 1500;

export function CardDetailView({
	selection,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onBack,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	inlineTaskCreator,
	onMoveToTrash,
}: {
	selection: CardSelection;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onBack: () => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	inlineTaskCreator?: ReactNode;
	onMoveToTrash: () => void;
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const { changes: workspaceChanges, isRuntimeAvailable, refresh } = useRuntimeWorkspaceChanges(
		selection.card.id,
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
		<div className="flex min-h-0 flex-1 overflow-hidden bg-background">
			<ColumnContextPanel
				selection={selection}
				onCardSelect={onCardSelect}
				taskSessions={taskSessions}
				onTaskDragEnd={onTaskDragEnd}
				onCreateTask={onCreateTask}
				inlineTaskCreator={inlineTaskCreator}
			/>
			<div className="flex h-full min-h-0 w-4/5 min-w-0 flex-col overflow-hidden bg-background">
				<div className="flex min-h-0 flex-1 overflow-hidden">
					<AgentTerminalPanel
						taskId={selection.card.id}
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
