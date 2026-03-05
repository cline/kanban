import type { BoardColumn, BoardColumnId } from "@/kanban/types";

export function findCardColumnId(columns: ReadonlyArray<BoardColumn>, taskId: string): BoardColumnId | null {
	for (const column of columns) {
		if (column.cards.some((card) => card.id === taskId)) {
			return column.id;
		}
	}
	return null;
}

export function isCardDropDisabled(
	columnId: BoardColumnId,
	activeDragSourceColumnId: BoardColumnId | null,
): boolean {
	if (columnId === "review") {
		return true;
	}
	if (!activeDragSourceColumnId) {
		return false;
	}
	if (columnId === "backlog") {
		return activeDragSourceColumnId !== "backlog";
	}
	if (columnId === "in_progress") {
		return activeDragSourceColumnId !== "backlog" && activeDragSourceColumnId !== "in_progress";
	}
	if (columnId === "trash") {
		return activeDragSourceColumnId === "trash";
	}
	return false;
}
