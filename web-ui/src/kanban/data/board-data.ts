import type { BoardColumn, BoardColumnId, BoardData } from "@/kanban/types";

const columnOrder: Array<{ id: BoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "todo", title: "To Do" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "ready_for_review", title: "Ready for Review" },
	{ id: "done", title: "Done" },
];

function createEmptyColumn(id: BoardColumnId, title: string): BoardColumn {
	return {
		id,
		title,
		cards: [],
	};
}

export function createInitialBoardData(): BoardData {
	return {
		columns: columnOrder.map((column) => createEmptyColumn(column.id, column.title)),
	};
}
