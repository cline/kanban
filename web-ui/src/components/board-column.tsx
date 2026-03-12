import { Button, Classes, Colors, Icon } from "@blueprintjs/core";
import type { IconName } from "@blueprintjs/icons";
import { Droppable } from "@hello-pangea/dnd";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";

import { BoardCard } from "@/components/board-card";
import { columnAccentColors, columnBgColor, columnLightColors, panelSeparatorColor } from "@/data/column-colors";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { isCardDropDisabled, type ProgrammaticCardMoveInFlight } from "@/state/drag-rules";
import type { BoardCard as BoardCardModel, BoardColumnId, BoardColumn as BoardColumnModel } from "@/types";

const COL_ICON_NAMES: Record<string, IconName> = {
	backlog: "folder-open",
	in_progress: "play",
	review: "tick-circle",
	trash: "archive",
};

export function BoardColumn({
	column,
	taskSessions,
	onCreateTask,
	onStartTask,
	onStartAllTasks,
	onClearTrash,
	inlineTaskCreator,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onCancelAutomaticTaskAction,
	onMoveToTrashTask,
	onRestoreFromTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	moveToTrashLoadingById,
	onCardClick,
	activeDragTaskId,
	activeDragSourceColumnId,
	programmaticCardMoveInFlight,
	onDependencyPointerDown,
	onDependencyPointerEnter,
	dependencySourceTaskId,
	dependencyTargetTaskId,
	isDependencyLinking,
}: {
	column: BoardColumnModel;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	inlineTaskCreator?: ReactNode;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCardModel) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	onRestoreFromTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onCardClick?: (card: BoardCardModel) => void;
	activeDragTaskId?: string | null;
	activeDragSourceColumnId?: BoardColumnId | null;
	programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null;
	onDependencyPointerDown?: (taskId: string, event: ReactMouseEvent<HTMLElement>) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	dependencySourceTaskId?: string | null;
	dependencyTargetTaskId?: string | null;
	isDependencyLinking?: boolean;
}): React.ReactElement {
	const accentColor = columnAccentColors[column.id] ?? "rgba(80, 100, 130, 0.60)";
	const lightColor = columnLightColors[column.id] ?? "rgba(120, 150, 185, 0.60)";
	const colIcon: IconName = COL_ICON_NAMES[column.id] ?? "folder-open";
	const canCreate = column.id === "backlog" && onCreateTask;
	const canStartAllTasks = column.id === "backlog" && onStartAllTasks;
	const canClearTrash = column.id === "trash" && onClearTrash;
	const cardDropType = "CARD";
	const isDropDisabled = isCardDropDisabled(column.id, activeDragSourceColumnId ?? null, {
		activeDragTaskId,
		programmaticCardMoveInFlight,
	});
	const createTaskButtonText = (
		<span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
			<span>Create task</span>
			<span aria-hidden className={Classes.TEXT_MUTED}>
				(c)
			</span>
		</span>
	);

	return (
		<section
			data-column-id={column.id}
			style={{
				display: "flex",
				flex: "1 1 0",
				flexDirection: "column",
				minWidth: 0,
				minHeight: 0,
				background: columnBgColor,
				borderRight: `1px solid ${panelSeparatorColor}`,
				// Thin top accent strip per column
				borderTop: `2px solid ${accentColor}`,
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", flex: "1 1 0", minHeight: 0 }}>
				{/* Column header */}
				<div className="kb-column-header">
					{/* Left: icon + path */}
					<div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: "1 1 0" }}>
						<Icon icon={colIcon} size={13} color={accentColor} style={{ flexShrink: 0 }} />
						<span className="kb-column-title-path" style={{ color: accentColor }}>
							{column.title}
						</span>
					</div>
					{/* Right: count + dots + action */}
					<div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
						{column.cards.length > 0 ? (
							<span
								style={{
									fontFamily: "var(--kb-font-mono)",
									fontSize: "var(--bp-typography-size-body-x-small)",
									color: lightColor,
								}}
							>
								[{column.cards.length}]
							</span>
						) : null}
						{/* Window chrome dots — right side */}
						<div className="kb-column-header-dots" aria-hidden>
							<div className="kb-column-header-dot" />
							<div className="kb-column-header-dot" />
							<div className="kb-column-header-dot" />
						</div>
					</div>
					{canStartAllTasks ? (
						<Button
							icon={<Icon icon="play" color={column.cards.length > 0 ? Colors.GRAY4 : Colors.GRAY3} />}
							variant="minimal"
							size="small"
							onClick={onStartAllTasks}
							disabled={column.cards.length === 0}
							aria-label="Start all backlog tasks"
							title={column.cards.length > 0 ? "Start all backlog tasks" : "Backlog is empty"}
						/>
					) : null}
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

				<Droppable droppableId={column.id} type={cardDropType} isDropDisabled={isDropDisabled}>
					{(cardProvided) => (
						<div ref={cardProvided.innerRef} {...cardProvided.droppableProps} className="kb-column-cards">
							{canCreate && !inlineTaskCreator ? (
								<button
									type="button"
									className="kb-create-task-trigger"
									onClick={onCreateTask}
								>
									<span style={{ color: "var(--kb-accent-blue)", fontWeight: 600 }}>+</span>
									<span>New task</span>
								</button>
							) : null}
							{inlineTaskCreator}

							{(() => {
								const items: ReactNode[] = [];
								let draggableIndex = 0;
								for (const card of column.cards) {
									if (column.id === "backlog" && editingTaskId === card.id) {
										items.push(
											<div
												key={card.id}
												data-task-id={card.id}
												data-column-id={column.id}
												style={{ marginBottom: 8 }}
											>
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
											onRestoreFromTrash={onRestoreFromTrashTask}
											onCommit={onCommitTask}
											onOpenPr={onOpenPrTask}
											onCancelAutomaticAction={onCancelAutomaticTaskAction}
											isCommitLoading={commitTaskLoadingById?.[card.id] ?? false}
											isOpenPrLoading={openPrTaskLoadingById?.[card.id] ?? false}
											isMoveToTrashLoading={moveToTrashLoadingById?.[card.id] ?? false}
											onDependencyPointerDown={onDependencyPointerDown}
											onDependencyPointerEnter={onDependencyPointerEnter}
											isDependencySource={dependencySourceTaskId === card.id}
											isDependencyTarget={dependencyTargetTaskId === card.id}
											isDependencyLinking={isDependencyLinking}
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
