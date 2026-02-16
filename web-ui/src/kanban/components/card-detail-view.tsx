import { useEffect } from "react";

import { AgentChatPanel } from "@/kanban/components/detail-panels/agent-chat-panel";
import { ColumnContextPanel } from "@/kanban/components/detail-panels/column-context-panel";
import { DiffViewerPanel } from "@/kanban/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/kanban/components/detail-panels/file-tree-panel";
import type { CardSelection } from "@/kanban/types";

export function CardDetailView({
	selection,
	onBack,
	onCardSelect,
}: {
	selection: CardSelection;
	onBack: () => void;
	onCardSelect: (selection: CardSelection) => void;
}): React.ReactElement {
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onBack();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onBack]);

	return (
		<div className="flex min-h-0 flex-1 overflow-hidden bg-zinc-950">
			<ColumnContextPanel selection={selection} onCardSelect={onCardSelect} />
			<div className="flex min-h-0 w-4/5 min-w-0">
				<AgentChatPanel />
				<DiffViewerPanel />
				<FileTreePanel />
			</div>
		</div>
	);
}
