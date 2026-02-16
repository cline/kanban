import type { ReactElement } from "react";

import { KanbanBoard } from "@/kanban/components/kanban-board";
import { TopBar } from "@/kanban/components/top-bar";

export default function App(): ReactElement {
	return (
		<div className="flex min-h-svh min-w-0 flex-col bg-zinc-950 text-zinc-100">
			<TopBar />
			<KanbanBoard />
		</div>
	);
}
