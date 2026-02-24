import { Button, Colors } from "@blueprintjs/core";
import { Droppable } from "@hello-pangea/dnd";
import type { ReactNode } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors, columnLightColors, panelSeparatorColor } from "@/kanban/data/column-colors";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard as BoardCardModel, BoardColumn as BoardColumnModel } from "@/kanban/types";

export function BoardColumn({
	column,
	taskSessions,
	onCreateTask,
	inlineTaskCreator,
	onCardClick,
}: {
	column: BoardColumnModel;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	inlineTaskCreator?: ReactNode;
	onCardClick?: (card: BoardCardModel) => void;
}): React.ReactElement {
	const accentColor = columnAccentColors[column.id] ?? Colors.GRAY1;
	const lightColor = columnLightColors[column.id] ?? Colors.GRAY5;
	const canCreate = column.id === "backlog" && onCreateTask;

	return (
		<section
			data-column-id={column.id}
			style={{ display: "flex", flex: "1 1 0", flexDirection: "column", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1, borderRight: `1px solid ${panelSeparatorColor}` }}
		>
			<div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minHeight: 0 }}>
				<div
					style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 40, padding: "0 12px", background: accentColor, borderBottom: `1px solid ${Colors.DARK_GRAY5}` }}
				>
					<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
						<span style={{ fontWeight: 600 }}>{column.title}</span>
						<span style={{ color: lightColor }}>{column.cards.length}</span>
					</div>
				</div>

				<Droppable droppableId={column.id} type="CARD">
					{(cardProvided, cardSnapshot) => (
						<div
							ref={cardProvided.innerRef}
							{...cardProvided.droppableProps}
							className="kb-column-cards"
							style={
								cardSnapshot.isDraggingOver
									? { backgroundColor: `${accentColor}10`, boxShadow: `inset 2px 0 0 0 ${accentColor}66, inset -2px 0 0 0 ${accentColor}66` }
									: undefined
							}
						>
							{canCreate && !inlineTaskCreator ? (
								<Button
									icon="plus"
									text="Create task"
									fill
									onClick={onCreateTask}
									style={{ marginBottom: 8, flexShrink: 0 }}
								/>
							) : null}
							{inlineTaskCreator}

							{column.cards.map((card, cardIndex) => (
								<BoardCard
									key={card.id}
									card={card}
									index={cardIndex}
									sessionSummary={taskSessions[card.id]}
									onClick={() => onCardClick?.(card)}
								/>
							))}
							{cardProvided.placeholder}
						</div>
					)}
				</Droppable>
			</div>
		</section>
	);
}
