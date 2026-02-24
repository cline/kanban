import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef } from "react";
import type { ReactNode } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardData } from "@/kanban/types";

export function KanbanBoard({
	data,
	taskSessions,
	onCardSelect,
	onCreateTask,
	inlineTaskCreator,
	onDragEnd,
}: {
	data: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCardSelect: (taskId: string) => void;
	onCreateTask: () => void;
	inlineTaskCreator?: ReactNode;
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
						inlineTaskCreator={column.id === "backlog" ? inlineTaskCreator : undefined}
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
