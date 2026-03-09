import type { BoardColumn, BoardColumnId } from "@/kanban/types";

export interface ProgrammaticCardMoveInFlight {
	taskId: string;
	fromColumnId: BoardColumnId;
	toColumnId: BoardColumnId;
	insertAtTop: boolean;
}

function isMatchingProgrammaticCardMove(
	taskId: string | null | undefined,
	fromColumnId: BoardColumnId,
	toColumnId: BoardColumnId,
	programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null,
): boolean {
	return (
		taskId !== null &&
		taskId !== undefined &&
		programmaticCardMoveInFlight?.taskId === taskId &&
		programmaticCardMoveInFlight.fromColumnId === fromColumnId &&
		programmaticCardMoveInFlight.toColumnId === toColumnId
	);
}

export function isAllowedCrossColumnCardMove(
	fromColumnId: BoardColumnId,
	toColumnId: BoardColumnId,
	options?: {
		taskId?: string | null;
		programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null;
	},
): boolean {
	if (fromColumnId === "backlog" && toColumnId === "in_progress") {
		return true;
	}
	if (toColumnId === "trash" && fromColumnId !== "trash") {
		return true;
	}
	if (fromColumnId === "trash" && toColumnId === "review") {
		return true;
	}
	if (
		(fromColumnId === "in_progress" && toColumnId === "review") ||
		(fromColumnId === "review" && toColumnId === "in_progress")
	) {
		return isMatchingProgrammaticCardMove(
			options?.taskId,
			fromColumnId,
			toColumnId,
			options?.programmaticCardMoveInFlight,
		);
	}
	return false;
}

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
	options?: {
		activeDragTaskId?: string | null;
		programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight | null;
	},
): boolean {
	if (!activeDragSourceColumnId) {
		return false;
	}
	if (columnId === "review") {
		return !isAllowedCrossColumnCardMove(activeDragSourceColumnId, columnId, {
			taskId: options?.activeDragTaskId,
			programmaticCardMoveInFlight: options?.programmaticCardMoveInFlight,
		});
	}
	if (columnId === "backlog") {
		return activeDragSourceColumnId !== "backlog";
	}
	if (columnId === "in_progress") {
		if (activeDragSourceColumnId === "backlog" || activeDragSourceColumnId === "in_progress") {
			return false;
		}
		return !isAllowedCrossColumnCardMove(activeDragSourceColumnId, columnId, {
			taskId: options?.activeDragTaskId,
			programmaticCardMoveInFlight: options?.programmaticCardMoveInFlight,
		});
	}
	if (columnId === "trash") {
		return activeDragSourceColumnId === "trash";
	}
	return false;
}
