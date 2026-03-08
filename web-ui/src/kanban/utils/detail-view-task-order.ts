import type { BoardColumnId, BoardData } from "@/kanban/types";

export function isDetailViewColumnId(columnId: BoardColumnId): boolean {
	return columnId === "in_progress" || columnId === "review";
}

export function getNextDetailTaskIdAfterTrashMove(board: BoardData, taskId: string): string | null {
	const detailTaskIds: string[] = [];
	for (const column of board.columns) {
		if (!isDetailViewColumnId(column.id)) {
			continue;
		}
		for (const card of column.cards) {
			detailTaskIds.push(card.id);
		}
	}

	const currentIndex = detailTaskIds.indexOf(taskId);
	if (currentIndex === -1) {
		return detailTaskIds[0] ?? null;
	}

	return detailTaskIds[currentIndex + 1] ?? detailTaskIds[currentIndex - 1] ?? null;
}
