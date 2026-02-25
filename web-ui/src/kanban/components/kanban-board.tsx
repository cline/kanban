import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef } from "react";
import type { ReactNode } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard, BoardData, ReviewTaskWorkspaceSnapshot } from "@/kanban/types";

export function KanbanBoard({
	data,
	taskSessions,
	onCardSelect,
	onCreateTask,
	onStartTask,
	onClearTrash,
	inlineTaskCreator,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onMoveToTrashTask,
	reviewWorkspaceSnapshots,
	onDragEnd,
}: {
	data: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCardSelect: (taskId: string) => void;
	onCreateTask: () => void;
	onStartTask?: (taskId: string) => void;
	onClearTrash?: () => void;
	inlineTaskCreator?: ReactNode;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
	onDragEnd: (result: DropResult) => void;
}): React.ReactElement {
	const dragOccurredRef = useRef(false);

	const handleDragStart = useCallback(() => {
		dragOccurredRef.current = true;
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			requestAnimationFrame(() => {
				dragOccurredRef.current = false;
			});
			onDragEnd(result);
		},
		[onDragEnd],
	);

	return (
		<DragDropContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
			<section className="kb-board">
				{data.columns.map((column) => (
					<BoardColumn
						key={column.id}
						column={column}
						taskSessions={taskSessions}
						onCreateTask={column.id === "backlog" ? onCreateTask : undefined}
						onStartTask={column.id === "backlog" ? onStartTask : undefined}
						onClearTrash={column.id === "trash" ? onClearTrash : undefined}
						inlineTaskCreator={column.id === "backlog" ? inlineTaskCreator : undefined}
						editingTaskId={column.id === "backlog" ? editingTaskId : null}
						inlineTaskEditor={column.id === "backlog" ? inlineTaskEditor : undefined}
						onEditTask={column.id === "backlog" ? onEditTask : undefined}
						onCommitTask={column.id === "review" ? onCommitTask : undefined}
						onOpenPrTask={column.id === "review" ? onOpenPrTask : undefined}
						onMoveToTrashTask={column.id === "review" ? onMoveToTrashTask : undefined}
						reviewWorkspaceSnapshots={column.id === "review" || column.id === "in_progress" ? reviewWorkspaceSnapshots : undefined}
						onCardClick={(card) => {
							if (!dragOccurredRef.current) {
								onCardSelect(card.id);
							}
						}}
					/>
				))}
			</section>
		</DragDropContext>
	);
}
