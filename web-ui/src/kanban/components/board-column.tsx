import { Draggable, Droppable } from "@hello-pangea/dnd";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import type { BoardColumn as BoardColumnModel } from "@/kanban/types";

const columnAccentColors: Record<string, string> = {
	backlog: "#71717a",
	planning: "#3b82f6",
	running: "#f59e0b",
	review: "#a855f7",
	done: "#22c55e",
};

export function BoardColumn({
	column,
	index,
	onAddCard,
}: {
	column: BoardColumnModel;
	index: number;
	onAddCard: (title: string) => void;
}): React.ReactElement {
	const [isAdding, setIsAdding] = useState(false);
	const [newTitle, setNewTitle] = useState("");
	const inputRef = useRef<HTMLInputElement | null>(null);
	const scrollableRef = useRef<HTMLDivElement | null>(null);

	const accentColor = columnAccentColors[column.id] ?? "#71717a";

	useEffect(() => {
		if (isAdding && inputRef.current) {
			inputRef.current.focus();
		}
	}, [isAdding]);

	function handleStartAdding() {
		setIsAdding(true);
		requestAnimationFrame(() => {
			if (scrollableRef.current) {
				scrollableRef.current.scrollTop = scrollableRef.current.scrollHeight;
			}
		});
	}

	function handleSubmit() {
		const trimmed = newTitle.trim();
		if (trimmed) {
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
						<button
							type="button"
							onMouseDown={(e) => e.stopPropagation()}
							onClick={handleStartAdding}
							className="rounded p-1 text-zinc-400 transition-colors hover:text-zinc-200"
							aria-label={`Add task to ${column.title}`}
						>
							<Plus className="size-4" />
						</button>
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
										? { boxShadow: `inset 0 0 0 2px ${accentColor}66` }
										: undefined
								}
							>
								{column.cards.map((card, cardIndex) => (
									<BoardCard key={card.id} card={card} index={cardIndex} />
								))}
								{cardProvided.placeholder}

								{isAdding ? (
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
										onClick={handleStartAdding}
										className="flex w-full shrink-0 items-center justify-center rounded-lg border-2 border-zinc-700 py-2 text-zinc-500 transition-colors hover:border-zinc-500 hover:text-zinc-300"
									>
										<Plus className="size-5" />
									</button>
								)}
							</div>
						)}
					</Droppable>
					</div>
				</section>
			)}
		</Draggable>
	);
}
