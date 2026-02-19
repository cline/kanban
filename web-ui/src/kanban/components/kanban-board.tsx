import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import type { BoardData } from "@/kanban/types";

export function KanbanBoard({
	data,
	onCardSelect,
	onCreateTask,
	onDragEnd,
}: {
	data: BoardData;
	onCardSelect: (taskId: string) => void;
	onCreateTask: () => void;
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
			<Droppable droppableId="board" type="COLUMN" direction="horizontal">
				{(provided) => (
					<section
						ref={provided.innerRef}
						{...provided.droppableProps}
						className="flex h-full min-h-0 flex-1 overflow-hidden"
					>
						{data.columns.map((column, index) => (
							<BoardColumn
								key={column.id}
								column={column}
								index={index}
								onCreateTask={column.id === "backlog" ? onCreateTask : undefined}
								onCardClick={(card) => {
									if (!dragOccurredRef.current) {
										onCardSelect(card.id);
									}
								}}
							/>
						))}
						{provided.placeholder}
					</section>
				)}
			</Droppable>
		</DragDropContext>
	);
}
