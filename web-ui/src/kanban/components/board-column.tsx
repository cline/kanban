import { Button, Colors } from "@blueprintjs/core";
import { Droppable } from "@hello-pangea/dnd";
import type { ReactNode } from "react";

import { BoardCard } from "@/kanban/components/board-card";
import { columnAccentColors, columnLightColors, panelSeparatorColor } from "@/kanban/data/column-colors";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type {
	BoardCard as BoardCardModel,
	BoardColumn as BoardColumnModel,
	ReviewTaskWorkspaceSnapshot,
} from "@/kanban/types";

export function BoardColumn({
	column,
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
	onCardClick,
}: {
	column: BoardColumnModel;
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
	onCardClick?: (card: BoardCardModel) => void;
}): React.ReactElement {
	const accentColor = columnAccentColors[column.id] ?? Colors.GRAY1;
	const lightColor = columnLightColors[column.id] ?? Colors.GRAY5;
	const canCreate = column.id === "backlog" && onCreateTask;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType =
		column.id === "backlog" || column.id === "in_progress"
			? "CARD-WORKFLOW-A"
			: "CARD-WORKFLOW-B";

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
						/>
					) : null}
				</div>

				<Droppable droppableId={column.id} type={cardDropType}>
					{(cardProvided) => (
						<div
							ref={cardProvided.innerRef}
							{...cardProvided.droppableProps}
							className="kb-column-cards"
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
												onCardClick?.(card);
											}}
										/>,
									);
									draggableIndex += 1;
								}
								return items;
							})()}
							{cardProvided.placeholder}
						</div>
					)}
				</Droppable>
			</div>
		</section>
	);
}
