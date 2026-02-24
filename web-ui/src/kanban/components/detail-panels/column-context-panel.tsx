import { Button, Classes, Collapse, Colors, Icon } from "@blueprintjs/core";
import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useState } from "react";
import type { ReactNode } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors, columnLightColors, panelSeparatorColor } from "@/kanban/data/column-colors";
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
	const accentColor = columnAccentColors[column.id] ?? Colors.GRAY1;
	const lightColor = columnLightColors[column.id] ?? Colors.GRAY5;
	const canCreate = column.id === "backlog" && onCreateTask;

	return (
		<div>
			<div style={{ background: accentColor, height: 40 }}>
				<Button
					variant="minimal"
					fill
					alignText="left"
					icon={<Icon icon={open ? "chevron-down" : "chevron-right"} color={lightColor} />}
					onClick={() => setOpen((prev) => !prev)}
					style={{ color: lightColor, height: 40 }}
					text={
						<span style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<span style={{ fontWeight: 600, color: Colors.WHITE }}>{column.title}</span>
							<span style={{ color: lightColor }}>{column.cards.length}</span>
						</span>
					}
				/>
			</div>
			<Collapse isOpen={open}>
				<Droppable droppableId={column.id} type="CARD">
					{(provided, snapshot) => {
						const columnStyle = snapshot.isDraggingOver
							? {
									backgroundColor: `${accentColor}10`,
									boxShadow: `inset 2px 0 0 0 ${accentColor}66, inset -2px 0 0 0 ${accentColor}66`,
								}
							: undefined;
						return (
							<div
								ref={provided.innerRef}
								{...provided.droppableProps}
								style={{
									display: "flex",
									flexDirection: "column",
									padding: 8,
									...columnStyle,
								}}
							>
								{canCreate && !inlineTaskCreator ? (
									<Button
										icon="plus"
										text="Create task"
										fill
										onClick={onCreateTask}
										style={{ marginBottom: 8 }}
									/>
								) : null}
								{inlineTaskCreator}
								{column.cards.map((card, index) => (
									<BoardCard
										key={card.id}
										card={card}
										index={index}
										sessionSummary={taskSessions[card.id]}
										selected={card.id === selectedCardId}
										onClick={() => onCardClick(card)}
									/>
								))}
								{provided.placeholder}
								{column.cards.length === 0 ? (
									<p className={Classes.TEXT_MUTED}>No cards</p>
								) : null}
							</div>
						);
					}}
				</Droppable>
			</Collapse>
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
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: "20%",
				minHeight: 0,
				overflowY: "auto",
				background: Colors.DARK_GRAY1,
				borderRight: `1px solid ${panelSeparatorColor}`,
			}}
		>
			<DragDropContext onDragEnd={onTaskDragEnd}>
				<div style={{ flex: "1 1 0", minHeight: 0 }}>
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
		</div>
	);
}
