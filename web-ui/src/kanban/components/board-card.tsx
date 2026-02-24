import { Card, Classes, Colors, Elevation, Text } from "@blueprintjs/core";
import { Draggable } from "@hello-pangea/dnd";
import { createPortal } from "react-dom";

import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard as BoardCardModel } from "@/kanban/types";

export function BoardCard({
	card,
	index,
	sessionSummary,
	selected = false,
	onClick,
}: {
	card: BoardCardModel;
	index: number;
	sessionSummary?: RuntimeTaskSessionSummary;
	selected?: boolean;
	onClick?: () => void;
}): React.ReactElement {
	return (
		<Draggable draggableId={card.id} index={index}>
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
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 8,
							cursor: "grab",
						}}
					>
						<Card
							elevation={isDragging ? Elevation.THREE : Elevation.ZERO}
							interactive
							selected={selected}
							compact
						>
							<Text ellipsize={false}>
								<p className="kb-line-clamp-2" style={{ margin: 0, fontWeight: 500 }}>
									{card.title}
								</p>
							</Text>
							{card.description ? (
								<p className={`${Classes.TEXT_MUTED} kb-line-clamp-2`} style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.4 }}>
									{card.description}
								</p>
							) : null}
							{sessionSummary?.lastActivityLine ? (
								<p className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT} kb-line-clamp-2`} style={{ margin: "8px 0 0", paddingTop: 8, borderTop: `1px solid ${Colors.DARK_GRAY5}`, fontSize: 12 }}>
									{sessionSummary.lastActivityLine}
								</p>
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
