import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef, useState } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import { initialBoardData } from "@/kanban/data/board-data";
import type { BoardCard, BoardColumn as BoardColumnModel, CardSelection } from "@/kanban/types";

function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
	const result = Array.from(list);
	const removed = result.splice(startIndex, 1)[0];
	if (removed !== undefined) {
		result.splice(endIndex, 0, removed);
	}
	return result;
}

export function KanbanBoard({
	onCardSelect,
}: {
	onCardSelect?: (selection: CardSelection) => void;
}): React.ReactElement {
	const [data, setData] = useState(initialBoardData);
	const dragOccurredRef = useRef(false);

	const handleAddCard = useCallback((columnId: string, title: string) => {
		setData((prev) => ({
			...prev,
			columns: prev.columns.map((col) =>
				col.id === columnId
					? {
							...col,
							cards: [
								...col.cards,
								{ id: crypto.randomUUID(), title, body: "" },
							],
						}
					: col,
			),
		}));
	}, []);

	const handleCardClick = useCallback(
		(card: BoardCard, column: BoardColumnModel) => {
			if (dragOccurredRef.current || !onCardSelect) return;
			onCardSelect({
				card,
				column,
				allColumns: data.columns,
			});
		},
		[onCardSelect],
	);

	function onDragStart() {
		dragOccurredRef.current = true;
	}

	function onDragEnd(result: DropResult) {
		requestAnimationFrame(() => {
			dragOccurredRef.current = false;
		});
		const { source, destination, type } = result;

		if (!destination) {
			return;
		}

		if (source.droppableId === destination.droppableId && source.index === destination.index) {
			return;
		}

		if (type === "COLUMN") {
			const reorderedColumns = reorder(data.columns, source.index, destination.index);
			setData({ ...data, columns: reorderedColumns });
			return;
		}

		const sourceColumnIndex = data.columns.findIndex((c) => c.id === source.droppableId);
		const destColumnIndex = data.columns.findIndex((c) => c.id === destination.droppableId);
		const sourceColumn = data.columns[sourceColumnIndex];
		const destColumn = data.columns[destColumnIndex];

		if (!sourceColumn || !destColumn) {
			return;
		}

		if (sourceColumn.id === destColumn.id) {
			const reorderedCards = reorder(sourceColumn.cards, source.index, destination.index);
			const columns = Array.from(data.columns);
			columns[sourceColumnIndex] = { ...sourceColumn, cards: reorderedCards };
			setData({ ...data, columns });
		} else {
			const sourceCards = Array.from(sourceColumn.cards);
			const moved = sourceCards.splice(source.index, 1)[0];
			if (!moved) {
				return;
			}
			const destCards = Array.from(destColumn.cards);
			destCards.splice(destination.index, 0, moved);

			const columns = Array.from(data.columns);
			columns[sourceColumnIndex] = { ...sourceColumn, cards: sourceCards };
			columns[destColumnIndex] = { ...destColumn, cards: destCards };
			setData({ ...data, columns });
		}
	}

	return (
		<DragDropContext onDragStart={onDragStart} onDragEnd={onDragEnd}>
			<Droppable droppableId="board" type="COLUMN" direction="horizontal">
				{(provided) => (
					<section
						ref={provided.innerRef}
						{...provided.droppableProps}
						className="flex min-h-0 flex-1 overflow-hidden"
					>
						{data.columns.map((column, index) => (
							<BoardColumn
								key={column.id}
								column={column}
								index={index}
								onAddCard={(title) => handleAddCard(column.id, title)}
								onCardClick={(card) => handleCardClick(card, column)}
							/>
						))}
						{provided.placeholder}
					</section>
				)}
			</Droppable>
		</DragDropContext>
	);
}
