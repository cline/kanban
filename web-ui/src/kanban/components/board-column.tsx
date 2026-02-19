import { Draggable, Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors } from "@/kanban/data/column-colors";
import type { BoardCard as BoardCardModel, BoardColumn as BoardColumnModel } from "@/kanban/types";

export function BoardColumn({
	column,
	index,
	onCreateTask,
	onCardClick,
}: {
	column: BoardColumnModel;
	index: number;
	onCreateTask?: () => void;
	onCardClick?: (card: BoardCardModel) => void;
}): React.ReactElement {
	const accentColor = columnAccentColors[column.id] ?? "#71717a";
	const canCreate = column.id === "backlog" && onCreateTask;

	return (
		<Draggable draggableId={column.id} index={index}>
			{(columnProvided, columnSnapshot) => (
				<section
					ref={columnProvided.innerRef}
					{...columnProvided.draggableProps}
					data-column-id={column.id}
					className={`flex h-full min-h-0 min-w-0 flex-1 flex-col border-r border-border bg-background ${
						columnSnapshot.isDragging ? "shadow-2xl" : ""
					}`}
				>
					<div
						className="flex min-h-0 flex-1 flex-col"
						style={{ "--col-accent": accentColor } as React.CSSProperties}
					>
						<div
							{...columnProvided.dragHandleProps}
							className="flex h-11 cursor-grab items-center justify-between px-3"
							style={{ backgroundColor: `${accentColor}65` }}
						>
							<div className="flex items-center gap-2">
								<span className="text-sm font-semibold text-foreground">{column.title}</span>
								<span className="text-xs font-medium text-white/60">{column.cards.length}</span>
							</div>
						</div>

						<Droppable droppableId={column.id} type="CARD">
							{(cardProvided, cardSnapshot) => (
								<div
									ref={cardProvided.innerRef}
									{...cardProvided.droppableProps}
									className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-2"
									style={
										cardSnapshot.isDraggingOver
											? { backgroundColor: `${accentColor}15`, boxShadow: `inset 2px 0 0 0 ${accentColor}66, inset -2px 0 0 0 ${accentColor}66` }
											: undefined
									}
								>
									{canCreate ? (
										<button
											type="button"
											onClick={onCreateTask}
											className="mb-2 flex w-full shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-muted-foreground/80"
										>
											<Plus className="size-4" />
											Create task
										</button>
									) : null}

									{column.cards.map((card, cardIndex) => (
										<BoardCard
											key={card.id}
											card={card}
											index={cardIndex}
											onClick={() => onCardClick?.(card)}
										/>
									))}
									{cardProvided.placeholder}
								</div>
							)}
						</Droppable>
					</div>
				</section>
			)}
		</Draggable>
	);
}
