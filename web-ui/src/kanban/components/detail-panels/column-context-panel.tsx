import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { columnAccentColors } from "@/kanban/data/column-colors";
import type { BoardCard, BoardColumn, CardSelection } from "@/kanban/types";

function ColumnSection({
	column,
	selectedCardId,
	defaultOpen,
	onCardClick,
}: {
	column: BoardColumn;
	selectedCardId: string;
	defaultOpen: boolean;
	onCardClick: (card: BoardCard) => void;
}): React.ReactElement {
	const [open, setOpen] = useState(defaultOpen);
	const accentColor = columnAccentColors[column.id] ?? "#71717a";
	const Chevron = open ? ChevronDown : ChevronRight;

	return (
		<div>
			<button
				type="button"
				onClick={() => setOpen((prev) => !prev)}
				className="flex w-full cursor-pointer items-center justify-between px-3 h-11"
				style={{ backgroundColor: `${accentColor}65` }}
			>
				<div className="flex items-center gap-2">
					<Chevron className="size-3.5 text-muted-foreground" />
					<span className="text-sm font-semibold text-foreground">{column.title}</span>
					<span className="text-xs font-medium text-white/60">{column.cards.length}</span>
				</div>
			</button>
			{open ? (
				<div
					className="p-2"
					style={{ "--col-accent": accentColor } as React.CSSProperties}
				>
					{column.cards.map((card) => {
						const isSelected = card.id === selectedCardId;
						return (
							<article
								key={card.id}
								onClick={() => onCardClick(card)}
								className={`mb-2 cursor-pointer rounded border-2 bg-card p-3 shadow-md ${
									isSelected
										? "shadow-lg"
										: "border-border card-interactive"
								}`}
								style={
									isSelected
										? { borderColor: accentColor }
										: undefined
								}
							>
								<p className="text-sm font-medium leading-snug text-foreground line-clamp-2">
									{card.title}
								</p>
								{card.description ? (
									<p className="mt-1 text-xs leading-snug text-muted-foreground line-clamp-2">
										{card.description}
									</p>
								) : null}
							</article>
						);
					})}
					{column.cards.length === 0 ? (
						<p className="px-1 py-2 text-xs text-muted-foreground/80">No cards</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function ColumnContextPanel({
	selection,
	onCardSelect,
}: {
	selection: CardSelection;
	onCardSelect: (taskId: string) => void;
}): React.ReactElement {
	return (
		<section className="flex min-h-0 w-1/5 flex-col border-r border-border bg-background">
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
				{selection.allColumns.map((column) => (
					<ColumnSection
						key={column.id}
						column={column}
						selectedCardId={selection.card.id}
						defaultOpen={column.id === selection.column.id || (column.id !== "backlog" && column.id !== "trash")}
						onCardClick={(card) => onCardSelect(card.id)}
					/>
				))}
			</div>
		</section>
	);
}
