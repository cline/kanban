import type { DropResult } from "@hello-pangea/dnd";

import { createInitialBoardData } from "@/kanban/data/board-data";
import type { BoardCard, BoardColumn, BoardColumnId, BoardData, CardSelection } from "@/kanban/types";

export interface TaskDraft {
	title: string;
	description?: string;
	prompt?: string;
	startInPlanMode?: boolean;
	baseRef?: string | null;
}

export interface TaskMoveEvent {
	taskId: string;
	fromColumnId: BoardColumnId;
	toColumnId: BoardColumnId;
}

const TASK_ID_LENGTH = 5;

function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
	const result = Array.from(list);
	const [removed] = result.splice(startIndex, 1);
	if (removed !== undefined) {
		result.splice(endIndex, 0, removed);
	}
	return result;
}

function createShortTaskId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, TASK_ID_LENGTH);
}

function createUniqueTaskId(existingIds: Set<string>): string {
	for (let attempt = 0; attempt < 16; attempt += 1) {
		const candidate = createShortTaskId();
		if (!existingIds.has(candidate)) {
			return candidate;
		}
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, TASK_ID_LENGTH);
}

function createTask(draft: TaskDraft, existingIds: Set<string>): BoardCard {
	const now = Date.now();
	const title = draft.title.trim();
	const description = draft.description?.trim() ?? "";
	const prompt = draft.prompt?.trim() || description || title;
	const baseRef =
		typeof draft.baseRef === "string"
			? (draft.baseRef.trim() || null)
			: null;
	return {
		id: createUniqueTaskId(existingIds),
		title,
		description,
		prompt,
		startInPlanMode: Boolean(draft.startInPlanMode),
		baseRef,
		createdAt: now,
		updatedAt: now,
	};
}

function updateTaskTimestamp(task: BoardCard): BoardCard {
	return {
		...task,
		updatedAt: Date.now(),
	};
}

function withUpdatedColumns(board: BoardData, columns: BoardColumn[]): BoardData {
	return {
		...board,
		columns,
	};
}

function normalizeColumnId(id: string): BoardColumnId | null {
	if (id === "backlog" || id === "in_progress" || id === "review" || id === "trash") {
		return id;
	}
	return null;
}

function normalizeCard(rawCard: unknown): BoardCard | null {
	if (!rawCard || typeof rawCard !== "object") {
		return null;
	}

	const card = rawCard as {
		id?: unknown;
		title?: unknown;
		description?: unknown;
		prompt?: unknown;
		startInPlanMode?: unknown;
		baseRef?: unknown;
		createdAt?: unknown;
		updatedAt?: unknown;
	};

	const title = typeof card.title === "string" ? card.title.trim() : "";
	if (!title) {
		return null;
	}

	const description = typeof card.description === "string" ? card.description : "";
	const prompt =
		typeof card.prompt === "string"
			? card.prompt
			: description.trim() || title;

	const now = Date.now();

	return {
		id: typeof card.id === "string" && card.id ? card.id : createShortTaskId(),
		title,
		description,
		prompt,
		startInPlanMode: typeof card.startInPlanMode === "boolean" ? card.startInPlanMode : false,
		baseRef: typeof card.baseRef === "string" ? (card.baseRef.trim() || null) : null,
		createdAt: typeof card.createdAt === "number" ? card.createdAt : now,
		updatedAt: typeof card.updatedAt === "number" ? card.updatedAt : now,
	};
}

export function normalizeBoardData(rawBoard: unknown): BoardData | null {
	if (!rawBoard || typeof rawBoard !== "object") {
		return null;
	}

	const candidateColumns = (rawBoard as { columns?: unknown }).columns;
	if (!Array.isArray(candidateColumns)) {
		return null;
	}

	const initial = createInitialBoardData();
	const normalizedColumns = initial.columns.map((column) => ({ ...column, cards: [] as BoardCard[] }));
	const columnById = new Map(normalizedColumns.map((column) => [column.id, column]));

	for (const rawColumn of candidateColumns) {
		if (!rawColumn || typeof rawColumn !== "object") {
			continue;
		}
		const column = rawColumn as { id?: unknown; cards?: unknown };
		if (typeof column.id !== "string") {
			continue;
		}
		const normalizedId = normalizeColumnId(column.id);
		if (!normalizedId) {
			continue;
		}
		const normalizedColumn = columnById.get(normalizedId);
		if (!normalizedColumn || !Array.isArray(column.cards)) {
			continue;
		}
		for (const rawCard of column.cards) {
			const card = normalizeCard(rawCard);
			if (card) {
				normalizedColumn.cards.push(card);
			}
		}
	}

	return { columns: normalizedColumns };
}

export function addTaskToColumn(board: BoardData, columnId: BoardColumnId, draft: TaskDraft): BoardData {
	const title = draft.title.trim();
	if (!title) return board;
	const existingIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			existingIds.add(card.id);
		}
	}

	const columns = board.columns.map((column) => {
		if (column.id !== columnId) {
			return column;
		}
		const task = createTask(draft, existingIds);
		return {
			...column,
			cards: [task, ...column.cards],
		};
	});

	return withUpdatedColumns(board, columns);
}

export function applyDragResult(board: BoardData, result: DropResult): { board: BoardData; moveEvent?: TaskMoveEvent } {
	const { source, destination, type } = result;

	if (!destination) {
		return { board };
	}

	if (source.droppableId === destination.droppableId && source.index === destination.index) {
		return { board };
	}

	if (type === "COLUMN") {
		return { board };
	}

	const sourceColumnIndex = board.columns.findIndex((column) => column.id === source.droppableId);
	const destinationColumnIndex = board.columns.findIndex((column) => column.id === destination.droppableId);
	const sourceColumn = board.columns[sourceColumnIndex];
	const destinationColumn = board.columns[destinationColumnIndex];

	if (!sourceColumn || !destinationColumn) {
		return { board };
	}

	if (sourceColumn.id === destinationColumn.id) {
		const movedCards = reorder(sourceColumn.cards, source.index, destination.index);
		const columns = Array.from(board.columns);
		columns[sourceColumnIndex] = {
			...sourceColumn,
			cards: movedCards,
		};
		return { board: withUpdatedColumns(board, columns) };
	}

	const isAllowedCrossColumnMove =
		(sourceColumn.id === "backlog" && destinationColumn.id === "in_progress") ||
		(sourceColumn.id === "review" && destinationColumn.id === "trash");
	if (!isAllowedCrossColumnMove) {
		return { board };
	}

	const sourceCards = Array.from(sourceColumn.cards);
	const [movedCard] = sourceCards.splice(source.index, 1);
	if (!movedCard) {
		return { board };
	}

	const destinationCards = Array.from(destinationColumn.cards);
	destinationCards.splice(destination.index, 0, updateTaskTimestamp(movedCard));

	const columns = Array.from(board.columns);
	columns[sourceColumnIndex] = {
		...sourceColumn,
		cards: sourceCards,
	};
	columns[destinationColumnIndex] = {
		...destinationColumn,
		cards: destinationCards,
	};

	return {
		board: withUpdatedColumns(board, columns),
		moveEvent: {
			taskId: movedCard.id,
			fromColumnId: sourceColumn.id,
			toColumnId: destinationColumn.id,
		},
	};
}

export function moveTaskToColumn(
	board: BoardData,
	taskId: string,
	targetColumnId: BoardColumnId,
): { board: BoardData; moved: boolean } {
	let sourceColumnIndex = -1;
	let sourceTaskIndex = -1;

	for (const [columnIndex, column] of board.columns.entries()) {
		const taskIndex = column.cards.findIndex((card) => card.id === taskId);
		if (taskIndex !== -1) {
			sourceColumnIndex = columnIndex;
			sourceTaskIndex = taskIndex;
			break;
		}
	}

	if (sourceColumnIndex === -1 || sourceTaskIndex === -1) {
		return { board, moved: false };
	}

	const destinationColumnIndex = board.columns.findIndex((column) => column.id === targetColumnId);
	if (destinationColumnIndex === -1) {
		return { board, moved: false };
	}

	if (sourceColumnIndex === destinationColumnIndex) {
		return { board, moved: false };
	}

	const sourceColumn = board.columns[sourceColumnIndex];
	const destinationColumn = board.columns[destinationColumnIndex];
	if (!sourceColumn || !destinationColumn) {
		return { board, moved: false };
	}
	const sourceCards = Array.from(sourceColumn.cards);
	const [task] = sourceCards.splice(sourceTaskIndex, 1);
	if (!task) {
		return { board, moved: false };
	}

	const updatedTask = updateTaskTimestamp(task);
	const destinationCards =
		targetColumnId === "trash"
			? [updatedTask, ...destinationColumn.cards]
			: [...destinationColumn.cards, updatedTask];
	const columns = Array.from(board.columns);
	columns[sourceColumnIndex] = { ...sourceColumn, cards: sourceCards };
	columns[destinationColumnIndex] = { ...destinationColumn, cards: destinationCards };

	return {
		board: withUpdatedColumns(board, columns),
		moved: true,
	};
}

export function updateTask(
	board: BoardData,
	taskId: string,
	draft: TaskDraft,
): { board: BoardData; updated: boolean } {
	const title = draft.title.trim();
	if (!title) {
		return { board, updated: false };
	}
	const description = draft.description?.trim() ?? "";
	const prompt = draft.prompt?.trim() || description || title;
	const baseRef =
		typeof draft.baseRef === "string"
			? (draft.baseRef.trim() || null)
			: null;

	let updated = false;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== taskId) {
				return card;
			}
			columnUpdated = true;
			updated = true;
			return {
				...card,
				title,
				description,
				prompt,
				startInPlanMode: Boolean(draft.startInPlanMode),
				baseRef,
				updatedAt: Date.now(),
			};
		});
		return columnUpdated
			? { ...column, cards }
			: column;
	});

	if (!updated) {
		return { board, updated: false };
	}
	return { board: withUpdatedColumns(board, columns), updated: true };
}

export function removeTask(
	board: BoardData,
	taskId: string,
): { board: BoardData; removed: boolean } {
	let removed = false;
	const columns = board.columns.map((column) => {
		const nextCards = column.cards.filter((card) => card.id !== taskId);
		if (nextCards.length !== column.cards.length) {
			removed = true;
			return { ...column, cards: nextCards };
		}
		return column;
	});
	if (!removed) {
		return { board, removed: false };
	}
	return { board: withUpdatedColumns(board, columns), removed: true };
}

export function clearColumnTasks(
	board: BoardData,
	columnId: BoardColumnId,
): { board: BoardData; clearedTaskIds: string[] } {
	const targetColumn = board.columns.find((column) => column.id === columnId);
	if (!targetColumn || targetColumn.cards.length === 0) {
		return { board, clearedTaskIds: [] };
	}

	const clearedTaskIds = targetColumn.cards.map((card) => card.id);
	const columns = board.columns.map((column) =>
		column.id === columnId
			? { ...column, cards: [] }
			: column,
	);

	return {
		board: withUpdatedColumns(board, columns),
		clearedTaskIds,
	};
}

export function findCardSelection(board: BoardData, taskId: string): CardSelection | null {
	for (const column of board.columns) {
		const card = column.cards.find((task) => task.id === taskId);
		if (card) {
			return {
				card,
				column,
				allColumns: board.columns,
			};
		}
	}
	return null;
}

export function getTaskColumnId(board: BoardData, taskId: string): BoardColumnId | null {
	for (const column of board.columns) {
		if (column.cards.some((task) => task.id === taskId)) {
			return column.id;
		}
	}
	return null;
}
