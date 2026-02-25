import { Button, Card, Classes, Colors, Elevation, Spinner } from "@blueprintjs/core";
import { Draggable } from "@hello-pangea/dnd";
import type { MouseEvent } from "react";
import { createPortal } from "react-dom";

import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard as BoardCardModel, BoardColumnId } from "@/kanban/types";

export function BoardCard({
	card,
	index,
	columnId,
	sessionSummary,
	selected = false,
	onClick,
	onStart,
	onCommit,
	onOpenPr,
}: {
	card: BoardCardModel;
	index: number;
	columnId: BoardColumnId;
	sessionSummary?: RuntimeTaskSessionSummary;
	selected?: boolean;
	onClick?: () => void;
	onStart?: (taskId: string) => void;
	onCommit?: (taskId: string) => void;
	onOpenPr?: (taskId: string) => void;
}): React.ReactElement {
	const showPreview = columnId === "in_progress" || columnId === "review";
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const renderStatusMarker = () => {
		if (columnId === "in_progress") {
			return <Spinner size={12} />;
		}
		return null;
	};
	const statusMarker = renderStatusMarker();

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={isTrashCard}>
			{(provided, snapshot) => {
				const isDragging = snapshot.isDragging;
				const draggableContent = (
					<div
						ref={provided.innerRef}
						{...provided.draggableProps}
						{...provided.dragHandleProps}
						className="kb-board-card-shell"
						data-task-id={card.id}
						onClick={() => {
							if (!isCardInteractive) {
								return;
							}
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 8,
							cursor: isTrashCard ? "default" : "grab",
						}}
					>
						<Card
							elevation={isDragging ? Elevation.THREE : Elevation.ZERO}
							interactive={isCardInteractive}
							selected={selected}
							compact
						>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								{statusMarker ? (
									<div style={{ display: "inline-flex", alignItems: "center" }}>
										{statusMarker}
									</div>
								) : null}
								<div style={{ flex: "1 1 auto", minWidth: 0 }}>
									<p
										className="kb-line-clamp-1"
										style={{
											margin: 0,
											fontWeight: 500,
											color: isTrashCard ? Colors.GRAY3 : undefined,
											textDecoration: isTrashCard ? "line-through" : undefined,
										}}
									>
										{card.title}
									</p>
								</div>
								{columnId === "backlog" ? (
									<Button
										icon="play"
										intent="primary"
										variant="minimal"
										size="small"
										aria-label="Start task"
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onStart?.(card.id);
										}}
									/>
								) : null}
							</div>
							{card.description ? (
								<p
									className={`${isTrashCard ? "" : Classes.TEXT_MUTED} kb-line-clamp-5`}
									style={{
										margin: "4px 0 0",
										fontSize: "var(--bp-typography-size-body-small)",
										lineHeight: 1.4,
										color: isTrashCard ? Colors.GRAY1 : undefined,
									}}
								>
									{card.description}
								</p>
							) : null}
							{showPreview && sessionSummary?.lastActivityLine ? (
								<div className="kb-task-preview-pane">
									<p className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT} kb-line-clamp-2 kb-task-preview-text`}>
										{sessionSummary.lastActivityLine}
									</p>
								</div>
							) : null}
							{columnId === "review" ? (
								<div style={{ display: "flex", gap: 6, marginTop: 8 }}>
									<Button
										text="Commit"
										size="small"
										variant="solid"
										intent="primary"
										style={{ flex: "1 1 0" }}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onCommit?.(card.id);
										}}
									/>
									<Button
										text="Open PR"
										size="small"
										variant="solid"
										intent="primary"
										style={{ flex: "1 1 0" }}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onOpenPr?.(card.id);
										}}
									/>
								</div>
							) : null}
						</Card>
					</div>
				);

				if (isDragging && typeof document !== "undefined") {
					return createPortal(draggableContent, document.body);
				}
				return draggableContent;
			}}
		</Draggable>
	);
}
