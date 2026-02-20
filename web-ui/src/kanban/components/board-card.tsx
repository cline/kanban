import { Draggable } from "@hello-pangea/dnd";

import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardCard as BoardCardModel } from "@/kanban/types";

export function BoardCard({
	card,
	index,
	sessionSummary,
	selected = false,
	accentColor,
	onClick,
}: {
	card: BoardCardModel;
	index: number;
	sessionSummary?: RuntimeTaskSessionSummary;
	selected?: boolean;
	accentColor?: string;
	onClick?: () => void;
}): React.ReactElement {
	return (
		<Draggable draggableId={card.id} index={index}>
			{(provided, snapshot) => (
				<article
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
					data-task-id={card.id}
					onClick={() => {
						if (!snapshot.isDragging && onClick) {
							onClick();
						}
					}}
					className={`mb-2 rounded border-2 bg-card p-3 shadow-md ${
						snapshot.isDragging
							? "shadow-lg"
							: selected
								? "cursor-grab shadow-lg"
								: "cursor-grab border-border card-interactive"
					}`}
					style={{
						...provided.draggableProps.style,
						...((snapshot.isDragging || selected)
							? { borderColor: accentColor ?? "var(--col-accent)" }
							: undefined),
					}}
				>
					<p className="text-sm font-medium leading-snug text-foreground line-clamp-2">{card.title}</p>
					{card.description ? (
						<p className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-2">{card.description}</p>
					) : null}
					{sessionSummary?.lastActivityLine ? (
						<p className="mt-2 border-t border-border pt-2 font-mono text-[11px] text-muted-foreground line-clamp-2">
							{sessionSummary.lastActivityLine}
						</p>
					) : null}
				</article>
			)}
		</Draggable>
	);
}
