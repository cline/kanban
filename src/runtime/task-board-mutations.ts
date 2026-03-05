import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "./api-contract.js";
import { createUniqueTaskId } from "./task-id.js";

export interface RuntimeCreateTaskInput {
	prompt: string;
	startInPlanMode?: boolean;
	baseRef: string;
}

export interface RuntimeCreateTaskResult {
	board: RuntimeBoardData;
	task: RuntimeBoardCard;
}

export interface RuntimeMoveTaskResult {
	moved: boolean;
	board: RuntimeBoardData;
	task: RuntimeBoardCard | null;
	fromColumnId: RuntimeBoardColumnId | null;
}

function collectExistingTaskIds(board: RuntimeBoardData): Set<string> {
	const existingIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			existingIds.add(card.id);
		}
	}
	return existingIds;
}

function findTaskLocation(
	board: RuntimeBoardData,
	taskId: string,
): {
	columnIndex: number;
	taskIndex: number;
	columnId: RuntimeBoardColumnId;
	task: RuntimeBoardCard;
} | null {
	for (const [columnIndex, column] of board.columns.entries()) {
		const taskIndex = column.cards.findIndex((card) => card.id === taskId);
		if (taskIndex === -1) {
			continue;
		}
		const task = column.cards[taskIndex];
		if (!task) {
			continue;
		}
		return {
			columnIndex,
			taskIndex,
			columnId: column.id,
			task,
		};
	}
	return null;
}

export function addTaskToColumn(
	board: RuntimeBoardData,
	columnId: RuntimeBoardColumnId,
	input: RuntimeCreateTaskInput,
	randomUuid: () => string,
	now: number = Date.now(),
): RuntimeCreateTaskResult {
	const prompt = input.prompt.trim();
	if (!prompt) {
		throw new Error("Task prompt is required.");
	}
	const baseRef = input.baseRef.trim();
	if (!baseRef) {
		throw new Error("Task baseRef is required.");
	}
	const existingIds = collectExistingTaskIds(board);
	const task: RuntimeBoardCard = {
		id: createUniqueTaskId(existingIds, randomUuid),
		prompt,
		startInPlanMode: Boolean(input.startInPlanMode),
		baseRef,
		createdAt: now,
		updatedAt: now,
	};

	const targetColumnIndex = board.columns.findIndex((column) => column.id === columnId);
	if (targetColumnIndex === -1) {
		throw new Error(`Column ${columnId} not found.`);
	}

	const columns = board.columns.map((column, index) => {
		if (index !== targetColumnIndex) {
			return column;
		}
		return {
			...column,
			cards: [task, ...column.cards],
		};
	});

	return {
		board: {
			...board,
			columns,
		},
		task,
	};
}

export function getTaskColumnId(board: RuntimeBoardData, taskId: string): RuntimeBoardColumnId | null {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return null;
	}
	const found = findTaskLocation(board, normalizedTaskId);
	return found ? found.columnId : null;
}

export function moveTaskToColumn(
	board: RuntimeBoardData,
	taskId: string,
	targetColumnId: RuntimeBoardColumnId,
	now: number = Date.now(),
): RuntimeMoveTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			moved: false,
			board,
			task: null,
			fromColumnId: null,
		};
	}

	const found = findTaskLocation(board, normalizedTaskId);
	if (!found) {
		return {
			moved: false,
			board,
			task: null,
			fromColumnId: null,
		};
	}
	if (found.columnId === targetColumnId) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}
	const targetColumnIndex = board.columns.findIndex((column) => column.id === targetColumnId);
	if (targetColumnIndex === -1) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}

	const sourceColumn = board.columns[found.columnIndex];
	const targetColumn = board.columns[targetColumnIndex];
	if (!sourceColumn || !targetColumn) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}

	const sourceCards = [...sourceColumn.cards];
	const [task] = sourceCards.splice(found.taskIndex, 1);
	if (!task) {
		return {
			moved: false,
			board,
			task: found.task,
			fromColumnId: found.columnId,
		};
	}
	const movedTask: RuntimeBoardCard = {
		...task,
		updatedAt: now,
	};
	const targetCards =
		targetColumnId === "trash" ? [movedTask, ...targetColumn.cards] : [...targetColumn.cards, movedTask];

	const columns = board.columns.map((column, index) => {
		if (index === found.columnIndex) {
			return {
				...column,
				cards: sourceCards,
			};
		}
		if (index === targetColumnIndex) {
			return {
				...column,
				cards: targetCards,
			};
		}
		return column;
	});

	return {
		moved: true,
		board: {
			...board,
			columns,
		},
		task: movedTask,
		fromColumnId: found.columnId,
	};
}
