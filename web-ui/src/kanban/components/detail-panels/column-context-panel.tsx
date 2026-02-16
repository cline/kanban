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
					<Chevron className="size-3.5 text-zinc-400" />
					<span className="text-sm font-semibold text-zinc-200">{column.title}</span>
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
								className={`mb-2 cursor-pointer rounded border-2 bg-zinc-800 p-3 shadow-md ${
									isSelected
										? "shadow-lg"
										: "border-zinc-700 card-interactive"
								}`}
								style={
									isSelected
										? { borderColor: accentColor }
										: undefined
								}
							>
								<p className="text-sm font-medium leading-snug text-zinc-100">
									{card.title}
								</p>
								{card.body ? (
									<p className="mt-1 line-clamp-2 text-sm leading-relaxed text-zinc-400">
										{card.body}
									</p>
								) : null}
							</article>
						);
					})}
					{column.cards.length === 0 ? (
						<p className="px-1 py-2 text-xs text-zinc-600">No cards</p>
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
	onCardSelect: (selection: CardSelection) => void;
}): React.ReactElement {
	return (
		<section className="flex min-h-0 w-1/5 flex-col border-r border-zinc-800 bg-zinc-900">
			<div className="min-h-0 flex-1 overflow-y-auto">
				{selection.allColumns.map((column) => (
					<ColumnSection
						key={column.id}
						column={column}
						selectedCardId={selection.card.id}
						defaultOpen={column.id === selection.column.id || (column.id !== "backlog" && column.id !== "done")}
						onCardClick={(card) =>
							onCardSelect({
								card,
								column,
								allColumns: selection.allColumns,
							})
						}
					/>
				))}
			</div>
		</section>
	);
}
