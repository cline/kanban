import { Draggable, Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors } from "@/kanban/data/column-colors";
import type { BoardCard as BoardCardModel, BoardColumn as BoardColumnModel } from "@/kanban/types";

export function BoardColumn({
	column,
	index,
	onAddCard,
	onCardClick,
}: {
	column: BoardColumnModel;
	index: number;
	onAddCard?: (title: string) => void;
	onCardClick?: (card: BoardCardModel) => void;
}): React.ReactElement {
	const [isAdding, setIsAdding] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const scrollableRef = useRef<HTMLDivElement | null>(null);

	const accentColor = columnAccentColors[column.id] ?? "#71717a";
	const canAdd = column.id === "backlog" && onAddCard;

	useEffect(() => {
		if (isAdding && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isAdding]);

	function handleSubmit() {
		const trimmed = newTitle.trim();
		if (trimmed && onAddCard) {
			onAddCard(trimmed);
		}
		setNewTitle("");
		setIsAdding(false);
	}

	return (
		<Draggable draggableId={column.id} index={index}>
			{(columnProvided, columnSnapshot) => (
				<section
					ref={columnProvided.innerRef}
					{...columnProvided.draggableProps}
					className={`flex min-h-0 min-w-0 flex-1 flex-col border-r border-zinc-800 bg-zinc-900 ${
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
								<span className="text-sm font-semibold text-zinc-200">{column.title}</span>
								<span className="text-xs font-medium text-white/60">{column.cards.length}</span>
							</div>
						</div>

						<Droppable droppableId={column.id} type="CARD">
							{(cardProvided, cardSnapshot) => (
								<div
									ref={(el) => {
										cardProvided.innerRef(el);
										scrollableRef.current = el;
									}}
									{...cardProvided.droppableProps}
									className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2"
									style={
										cardSnapshot.isDraggingOver
											? { backgroundColor: `${accentColor}15`, boxShadow: `inset 2px 0 0 0 ${accentColor}66, inset -2px 0 0 0 ${accentColor}66` }
											: undefined
									}
								>
									{column.cards.map((card, cardIndex) => (
										<BoardCard
											key={card.id}
											card={card}
											index={cardIndex}
											onClick={() => onCardClick?.(card)}
										/>
									))}
									{cardProvided.placeholder}

									{canAdd ? (
										isAdding ? (
											<input
												ref={inputRef}
												value={newTitle}
												onChange={(e) => setNewTitle(e.target.value)}
												onKeyDown={(e) => {
													if (e.key === "Enter") {
														handleSubmit();
													}
													if (e.key === "Escape") {
														setNewTitle("");
														setIsAdding(false);
													}
												}}
												onBlur={handleSubmit}
												placeholder="Task title..."
												className="w-full shrink-0 rounded-lg border-2 border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
											/>
										) : (
											<button
												type="button"
												onClick={() => setIsAdding(true)}
												className="flex w-full shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-300"
											>
												<Plus className="size-4" />
												New task
											</button>
										)
									) : null}
								</div>
							)}
						</Droppable>
					</div>
				</section>
			)}
		</Draggable>
	);
}
