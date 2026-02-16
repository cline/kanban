import { useCallback, useState } from "react";
import type { ReactElement } from "react";

import { CardDetailView } from "@/kanban/components/card-detail-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { TopBar } from "@/kanban/components/top-bar";
import type { CardSelection } from "@/kanban/types";

export default function App(): ReactElement {
	const [selectedCard, setSelectedCard] = useState<CardSelection | null>(null);

	const handleBack = useCallback(() => {
		setSelectedCard(null);
	}, []);

	return (
		<div className="flex min-h-svh min-w-0 flex-col bg-zinc-950 text-zinc-100">
			<TopBar
				onBack={selectedCard ? handleBack : undefined}
				subtitle={selectedCard?.column.title}
			/>
			<div className={selectedCard ? "hidden" : "flex min-h-0 flex-1 overflow-hidden"}>
				<KanbanBoard onCardSelect={setSelectedCard} />
			</div>
			{selectedCard ? (
				<CardDetailView selection={selectedCard} onBack={handleBack} onCardSelect={setSelectedCard} />
			) : null}
		</div>
	);
}
