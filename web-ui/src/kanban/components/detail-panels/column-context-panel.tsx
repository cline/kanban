import { Button, Classes, Collapse, Colors, Icon } from "@blueprintjs/core";
import { DragDropContext, Droppable, type DropResult } from "@hello-pangea/dnd";
import { useState } from "react";
import type { ReactNode } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors, columnLightColors, panelSeparatorColor } from "@/kanban/data/column-colors";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type {
	BoardCard as BoardCardModel,
	BoardColumn,
	CardSelection,
	ReviewTaskWorkspaceSnapshot,
} from "@/kanban/types";

function ColumnSection({
	column,
	selectedCardId,
	defaultOpen,
	onCardClick,
	taskSessions,
	onCreateTask,
	onStartTask,
	onClearTrash,
	inlineTaskCreator,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onMoveToTrashTask,
	reviewWorkspaceSnapshots,
}: {
	column: BoardColumn;
	selectedCardId: string;
	defaultOpen: boolean;
	onCardClick: (card: BoardCardModel) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onClearTrash?: () => void;
	inlineTaskCreator?: ReactNode;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
}): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	const accentColor = columnAccentColors[column.id] ?? Colors.GRAY1;
	const lightColor = columnLightColors[column.id] ?? Colors.GRAY5;
	const canCreate = column.id === "backlog" && onCreateTask;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType =
		column.id === "backlog" || column.id === "in_progress"
			? "CARD-WORKFLOW-A"
			: "CARD-WORKFLOW-B";

	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", background: accentColor, height: 40 }}>
				<Button
					variant="minimal"
					alignText="left"
					icon={<Icon icon={open ? "chevron-down" : "chevron-right"} color={lightColor} />}
					onClick={() => setOpen((prev) => !prev)}
					style={{ color: lightColor, height: 40, flex: "1 1 auto", minWidth: 0 }}
					text={
						<span style={{ display: "flex", alignItems: "center", gap: 8 }}>
							<span style={{ fontWeight: 600, color: Colors.WHITE }}>{column.title}</span>
							<span style={{ color: lightColor }}>{column.cards.length}</span>
						</span>
					}
				/>
				{canClearTrash ? (
					<Button
						icon="trash"
						variant="minimal"
						size="small"
						intent="danger"
						onClick={onClearTrash}
						disabled={column.cards.length === 0}
						aria-label="Clear trash"
						title={column.cards.length > 0 ? "Clear trash permanently" : "Trash is empty"}
						style={{ marginRight: 4 }}
					/>
				) : null}
			</div>
			<Collapse isOpen={open}>
				<Droppable droppableId={column.id} type={cardDropType}>
					{(provided) => {
						return (
							<div
								ref={provided.innerRef}
								{...provided.droppableProps}
								style={{
									display: "flex",
									flexDirection: "column",
									padding: 8,
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
								{(() => {
									const items: ReactNode[] = [];
									let draggableIndex = 0;
									for (const card of column.cards) {
										if (column.id === "backlog" && editingTaskId === card.id) {
											items.push(
												<div key={card.id} style={{ marginBottom: 8 }}>
													{inlineTaskEditor}
												</div>,
											);
											continue;
										}
										items.push(
											<BoardCard
												key={card.id}
												card={card}
												index={draggableIndex}
												columnId={column.id}
												sessionSummary={taskSessions[card.id]}
												selected={card.id === selectedCardId}
												onStart={onStartTask}
												onMoveToTrash={onMoveToTrashTask}
												reviewWorkspaceSnapshot={reviewWorkspaceSnapshots?.[card.id]}
												onCommit={onCommitTask}
												onOpenPr={onOpenPrTask}
												onClick={() => {
													if (column.id === "backlog") {
														onEditTask?.(card);
														return;
													}
													onCardClick(card);
												}}
											/>,
										);
										draggableIndex += 1;
									}
									return items;
								})()}
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
	onStartTask,
	onClearTrash,
	inlineTaskCreator,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onMoveToTrashTask,
	reviewWorkspaceSnapshots,
}: {
	selection: CardSelection;
	onCardSelect: (taskId: string) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onClearTrash?: () => void;
	inlineTaskCreator?: ReactNode;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
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
							onStartTask={column.id === "backlog" ? onStartTask : undefined}
							onClearTrash={column.id === "trash" ? onClearTrash : undefined}
							inlineTaskCreator={column.id === "backlog" ? inlineTaskCreator : undefined}
							editingTaskId={column.id === "backlog" ? editingTaskId : null}
							inlineTaskEditor={column.id === "backlog" ? inlineTaskEditor : undefined}
							onEditTask={column.id === "backlog" ? onEditTask : undefined}
							onCommitTask={column.id === "review" ? onCommitTask : undefined}
							onOpenPrTask={column.id === "review" ? onOpenPrTask : undefined}
							onMoveToTrashTask={column.id === "review" ? onMoveToTrashTask : undefined}
							reviewWorkspaceSnapshots={column.id === "review" || column.id === "in_progress" ? reviewWorkspaceSnapshots : undefined}
						/>
					))}
				</div>
			</DragDropContext>
		</div>
	);
}
