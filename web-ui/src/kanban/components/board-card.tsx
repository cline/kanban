import { Draggable } from "@hello-pangea/dnd";

import type { BoardCard as BoardCardModel } from "@/kanban/types";

export function BoardCard({
	card,
	index,
	onClick,
}: {
	card: BoardCardModel;
	index: number;
	onClick?: () => void;
}): React.ReactElement {
	return (
		<Draggable draggableId={card.id} index={index}>
			{(provided, snapshot) => (
				<article
					ref={provided.innerRef}
					{...provided.draggableProps}
					{...provided.dragHandleProps}
					onClick={() => {
						if (!snapshot.isDragging && onClick) {
							onClick();
						}
					}}
					className={`mb-2 rounded border-2 bg-zinc-800 p-3 shadow-md ${
						snapshot.isDragging
							? "shadow-lg"
							: "cursor-grab border-zinc-700 card-interactive"
					}`}
					style={{
						...provided.draggableProps.style,
						...(snapshot.isDragging ? { borderColor: "var(--col-accent)" } : undefined),
					}}
				>
					<p className="text-sm font-medium leading-snug text-zinc-100">{card.title}</p>
					{card.body ? (
						<p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400">{card.body}</p>
					) : null}
				</article>
			)}
		</Draggable>
	);
}
