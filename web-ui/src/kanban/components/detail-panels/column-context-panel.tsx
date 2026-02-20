import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors } from "@/kanban/data/column-colors";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard as BoardCardModel, BoardColumn, CardSelection } from "@/kanban/types";

function ColumnSection({
	column,
	selectedCardId,
	defaultOpen,
	onCardClick,
	taskSessions,
	onCreateTask,
	inlineTaskCreator,
}: {
	column: BoardColumn;
	selectedCardId: string;
	defaultOpen: boolean;
	onCardClick: (card: BoardCardModel) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	inlineTaskCreator?: ReactNode;
}): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	const accentColor = columnAccentColors[column.id] ?? "#71717a";
	const Chevron = open ? ChevronDown : ChevronRight;
	const canCreate = column.id === "backlog" && onCreateTask;

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="flex h-11 w-full cursor-pointer items-center justify-between px-3"
				style={{ backgroundColor: `${accentColor}65` }}
			>
				<div className="flex items-center gap-2">
					<Chevron className="size-3.5 text-muted-foreground" />
					<span className="text-sm font-semibold text-foreground">{column.title}</span>
					<span className="text-xs font-medium text-white/60">{column.cards.length}</span>
				</div>
			</button>
			{open ? (
				<Droppable droppableId={column.id} type="CARD">
					{(provided, snapshot) => {
						const columnStyle = snapshot.isDraggingOver
							? {
									backgroundColor: `${accentColor}15`,
									boxShadow: `inset 2px 0 0 0 ${accentColor}66, inset -2px 0 0 0 ${accentColor}66`,
								}
							: undefined;
						return (
							<div
								ref={provided.innerRef}
								{...provided.droppableProps}
								className="p-2"
								style={columnStyle}
							>
							{canCreate && !inlineTaskCreator ? (
								<button
									type="button"
									onClick={onCreateTask}
									className="mb-2 flex w-full shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground hover:border-muted-foreground/80"
								>
									<Plus className="size-4" />
									Create task
								</button>
							) : null}
							{inlineTaskCreator}
							{column.cards.map((card, index) => (
								<BoardCard
									key={card.id}
									card={card}
									index={index}
									sessionSummary={taskSessions[card.id]}
									selected={card.id === selectedCardId}
									accentColor={accentColor}
									onClick={() => onCardClick(card)}
								/>
							))}
							{provided.placeholder}
							{column.cards.length === 0 ? (
								<p className="px-1 py-2 text-xs text-muted-foreground/80">No cards</p>
							) : null}
							</div>
						);
					}}
				</Droppable>
			) : null}
		</div>
	);
}

export function ColumnContextPanel({
	selection,
	onCardSelect,
	taskSessions,
	onTaskDragEnd,
	onCreateTask,
	inlineTaskCreator,
}: {
	selection: CardSelection;
	onCardSelect: (taskId: string) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	inlineTaskCreator?: ReactNode;
}): React.ReactElement {
	return (
		<section className="flex min-h-0 w-1/5 flex-col border-r border-border bg-background">
			<DragDropContext onDragEnd={onTaskDragEnd}>
				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
					{selection.allColumns.map((column) => (
						<ColumnSection
							key={column.id}
							column={column}
							selectedCardId={selection.card.id}
							defaultOpen={column.id !== "trash"}
							onCardClick={(card) => onCardSelect(card.id)}
							taskSessions={taskSessions}
							onCreateTask={column.id === "backlog" ? onCreateTask : undefined}
							inlineTaskCreator={column.id === "backlog" ? inlineTaskCreator : undefined}
						/>
					))}
				</div>
			</DragDropContext>
		</section>
	);
}
