import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorderWithEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { reorder } from "@atlaskit/pragmatic-drag-and-drop/reorder";
import { useCallback, useEffect, useState } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import { initialBoardData } from "@/kanban/data/board-data";
import {
	isCardData,
	isCardDropTargetData,
	isColumnData,
	isDraggingCard,
	isDraggingColumn,
} from "@/kanban/dnd/data";
import type { BoardColumn as BoardColumnModel } from "@/kanban/types";

export function KanbanBoard(): React.ReactElement {
	const [data, setData] = useState(initialBoardData);

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

	useEffect(() => {
		return combine(
			monitorForElements({
				canMonitor: isDraggingCard,
				onDrop({ source, location }) {
					const dragging = source.data;
					if (!isCardData(dragging)) {
						return;
					}

					const innerMost = location.current.dropTargets[0];
					if (!innerMost) {
						return;
					}

					const dropTargetData = innerMost.data;
					const homeColumnIndex = data.columns.findIndex((column) => column.id === dragging.columnId);
					const homeColumn = data.columns[homeColumnIndex];
					if (!homeColumn) {
						return;
					}

					const cardIndexInHome = homeColumn.cards.findIndex((card) => card.id === dragging.card.id);
					if (cardIndexInHome < 0) {
						return;
					}

					if (isCardDropTargetData(dropTargetData)) {
						const destinationColumnIndex = data.columns.findIndex(
							(column) => column.id === dropTargetData.columnId,
						);
						const destinationColumn = data.columns[destinationColumnIndex];
						if (!destinationColumn) {
							return;
						}

						if (homeColumn.id === destinationColumn.id) {
							const cardFinishIndex = homeColumn.cards.findIndex(
								(card) => card.id === dropTargetData.card.id,
							);
							if (cardFinishIndex < 0 || cardFinishIndex === cardIndexInHome) {
								return;
							}

							const reorderedCards = reorderWithEdge({
								axis: "vertical",
								list: homeColumn.cards,
								startIndex: cardIndexInHome,
								indexOfTarget: cardFinishIndex,
								closestEdgeOfTarget: extractClosestEdge(dropTargetData),
							});

							const columns = Array.from(data.columns);
							columns[homeColumnIndex] = { ...homeColumn, cards: reorderedCards };
							setData({ ...data, columns });
							return;
						}

						const indexOfTarget = destinationColumn.cards.findIndex(
							(card) => card.id === dropTargetData.card.id,
						);
						if (indexOfTarget < 0) {
							return;
						}

						const closestEdge = extractClosestEdge(dropTargetData);
						const finalIndex = closestEdge === "bottom" ? indexOfTarget + 1 : indexOfTarget;

						const homeCards = Array.from(homeColumn.cards);
						homeCards.splice(cardIndexInHome, 1);

						const destinationCards = Array.from(destinationColumn.cards);
						destinationCards.splice(finalIndex, 0, dragging.card);

						const columns = Array.from(data.columns);
						columns[homeColumnIndex] = { ...homeColumn, cards: homeCards };
						columns[destinationColumnIndex] = { ...destinationColumn, cards: destinationCards };
						setData({ ...data, columns });
						return;
					}

					if (isColumnData(dropTargetData)) {
						const destinationColumnIndex = data.columns.findIndex(
							(column) => column.id === dropTargetData.column.id,
						);
						const destinationColumn = data.columns[destinationColumnIndex];
						if (!destinationColumn) {
							return;
						}

						if (homeColumn.id === destinationColumn.id) {
							const reorderedCards = reorder({
								list: homeColumn.cards,
								startIndex: cardIndexInHome,
								finishIndex: homeColumn.cards.length - 1,
							});
							const columns = Array.from(data.columns);
							columns[homeColumnIndex] = { ...homeColumn, cards: reorderedCards };
							setData({ ...data, columns });
							return;
						}

						const homeCards = Array.from(homeColumn.cards);
						homeCards.splice(cardIndexInHome, 1);
						const destinationCards = Array.from(destinationColumn.cards);
						destinationCards.push(dragging.card);

						const columns = Array.from(data.columns);
						columns[homeColumnIndex] = { ...homeColumn, cards: homeCards };
						columns[destinationColumnIndex] = { ...destinationColumn, cards: destinationCards };
						setData({ ...data, columns });
					}
				},
			}),
			monitorForElements({
				canMonitor: isDraggingColumn,
				onDrop({ source, location }) {
					const dragging = source.data;
					if (!isColumnData(dragging)) {
						return;
					}

					const innerMost = location.current.dropTargets[0];
					if (!innerMost) {
						return;
					}

					const destination = innerMost.data;
					if (!isColumnData(destination)) {
						return;
					}

					const homeIndex = data.columns.findIndex((column) => column.id === dragging.column.id);
					const destinationIndex = data.columns.findIndex((column) => column.id === destination.column.id);

					if (homeIndex < 0 || destinationIndex < 0 || homeIndex === destinationIndex) {
						return;
					}

					const reorderedColumns: BoardColumnModel[] = reorder({
						list: data.columns,
						startIndex: homeIndex,
						finishIndex: destinationIndex,
					});
					setData({ ...data, columns: reorderedColumns });
				},
			}),
		);
	}, [data]);

	return (
		<section className="grid min-h-0 flex-1 grid-cols-5 overflow-hidden">
			{data.columns.map((column) => (
				<BoardColumn
					key={column.id}
					column={column}
					onAddCard={(title) => handleAddCard(column.id, title)}
				/>
			))}
		</section>
	);
}
