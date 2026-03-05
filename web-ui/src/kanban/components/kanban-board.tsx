import { DragDropContext, type BeforeCapture, type DragStart, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import { findCardColumnId } from "@/kanban/state/drag-rules";
import type { BoardCard, BoardColumnId, BoardData, ReviewTaskWorkspaceSnapshot } from "@/kanban/types";

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
	commitTaskLoadingById,
	openPrTaskLoadingById,
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
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
	onDragEnd: (result: DropResult) => void;
}): React.ReactElement {
	const dragOccurredRef = useRef(false);
	const [activeDragSourceColumnId, setActiveDragSourceColumnId] = useState<BoardColumnId | null>(null);

	const handleBeforeCapture = useCallback((start: BeforeCapture) => {
		setActiveDragSourceColumnId(findCardColumnId(data.columns, start.draggableId));
	}, [data]);

	const handleDragStart = useCallback((_start: DragStart) => {
		dragOccurredRef.current = true;
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			setActiveDragSourceColumnId(null);
			requestAnimationFrame(() => {
				dragOccurredRef.current = false;
			});
			onDragEnd(result);
		},
		[onDragEnd],
	);

	return (
		<DragDropContext onBeforeCapture={handleBeforeCapture} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
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
						commitTaskLoadingById={column.id === "review" ? commitTaskLoadingById : undefined}
						openPrTaskLoadingById={column.id === "review" ? openPrTaskLoadingById : undefined}
						reviewWorkspaceSnapshots={column.id === "review" || column.id === "in_progress" ? reviewWorkspaceSnapshots : undefined}
						activeDragSourceColumnId={activeDragSourceColumnId}
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
