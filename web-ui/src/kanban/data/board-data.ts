import type { BoardColumn, BoardColumnId, BoardData } from "@/kanban/types";

const columnOrder: Array<{ id: BoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "review", title: "Review" },
	{ id: "trash", title: "Trash" },
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
