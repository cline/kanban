import type { DropResult } from "@hello-pangea/dnd";

import { createInitialBoardData } from "@/kanban/data/board-data";
import type { BoardCard, BoardColumn, BoardColumnId, BoardData, CardSelection } from "@/kanban/types";

const BOARD_STORAGE_KEY = "kanbanana.board.v1";
const LEGACY_SEED_TASK_IDS = new Set([
	"task-backlog-1",
	"task-backlog-2",
	"task-todo-1",
	"task-progress-1",
	"task-review-1",
	"task-done-1",
]);

export interface TaskDraft {
	title: string;
	description?: string;
}

export interface TaskMoveEvent {
	taskId: string;
	fromColumnId: BoardColumnId;
	toColumnId: BoardColumnId;
}

function reorder<T>(list: T[], startIndex: number, endIndex: number): T[] {
	const result = Array.from(list);
	const [removed] = result.splice(startIndex, 1);
	if (removed !== undefined) {
		result.splice(endIndex, 0, removed);
	}
	return result;
}

function createTask(draft: TaskDraft): BoardCard {
	const now = Date.now();
	const title = draft.title.trim();
	const description = draft.description?.trim() ?? "";
	return {
		id: crypto.randomUUID(),
		title,
		description,
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
	if (id === "backlog" || id === "todo" || id === "in_progress" || id === "ready_for_review" || id === "done") {
		return id;
	}
	if (id === "planning") return "todo";
	if (id === "running") return "in_progress";
	if (id === "review") return "ready_for_review";
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
		body?: unknown;
		createdAt?: unknown;
		updatedAt?: unknown;
	};

	const titleFromBody = typeof card.body === "string" ? card.body : "";
	const title = typeof card.title === "string" ? card.title.trim() : titleFromBody.trim();
	if (!title) {
		return null;
	}

	const description =
		typeof card.description === "string"
			? card.description
			: typeof card.body === "string"
				? card.body
				: "";

	const now = Date.now();

	return {
		id: typeof card.id === "string" && card.id ? card.id : crypto.randomUUID(),
		title,
		description,
		createdAt: typeof card.createdAt === "number" ? card.createdAt : now,
		updatedAt: typeof card.updatedAt === "number" ? card.updatedAt : now,
	};
}

function normalizeBoardData(rawBoard: unknown): BoardData | null {
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

	for (const column of normalizedColumns) {
		column.cards = column.cards.filter((card) => !LEGACY_SEED_TASK_IDS.has(card.id));
	}

	return { columns: normalizedColumns };
}

export function loadBoardState(): BoardData {
	if (typeof window === "undefined") {
		return createInitialBoardData();
	}

	const raw = window.localStorage.getItem(BOARD_STORAGE_KEY);
	if (!raw) {
		return createInitialBoardData();
	}

	try {
		const parsed = JSON.parse(raw) as unknown;
		const normalized = normalizeBoardData(parsed);
		if (!normalized) {
			return createInitialBoardData();
		}
		return normalized;
	} catch {
		return createInitialBoardData();
	}
}

export function persistBoardState(board: BoardData): void {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(board));
}

export function addTaskToColumn(board: BoardData, columnId: BoardColumnId, draft: TaskDraft): BoardData {
	const title = draft.title.trim();
	if (!title) return board;

	const columns = board.columns.map((column) => {
		if (column.id !== columnId) {
			return column;
		}
		return {
			...column,
			cards: [...column.cards, createTask(draft)],
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
		const columns = reorder(board.columns, source.index, destination.index);
		return { board: withUpdatedColumns(board, columns) };
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

	const destinationCards = [...destinationColumn.cards, updateTaskTimestamp(task)];
	const columns = Array.from(board.columns);
	columns[sourceColumnIndex] = { ...sourceColumn, cards: sourceCards };
	columns[destinationColumnIndex] = { ...destinationColumn, cards: destinationCards };

	return {
		board: withUpdatedColumns(board, columns),
		moved: true,
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
