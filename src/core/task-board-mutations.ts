import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskImage,
	RuntimeTaskSchedule,
} from "./api-contract";
import { createUniqueTaskId } from "./task-id";

export interface RuntimeCreateTaskInput {
	taskId?: string;
	prompt: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	images?: RuntimeTaskImage[];
	baseRef: string;
	schedule?: RuntimeTaskSchedule;
}

export interface RuntimeUpdateTaskInput {
	prompt: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: RuntimeTaskAutoReviewMode;
	images?: RuntimeTaskImage[];
	baseRef: string;
	schedule?: RuntimeTaskSchedule;
}

function normalizeTaskAutoReviewMode(value: RuntimeTaskAutoReviewMode | null | undefined): RuntimeTaskAutoReviewMode {
	if (value === "pr" || value === "move_to_trash") {
		return value;
	}
	return "commit";
}

// Copy image metadata so board tasks do not retain caller-owned array or object references.
function cloneTaskImages(images?: RuntimeTaskImage[]): RuntimeTaskImage[] | undefined {
	return images && images.length > 0 ? images.map((image) => ({ ...image })) : undefined;
}

// Clone schedule so board tasks do not retain caller-owned object references.
function cloneSchedule(schedule?: RuntimeTaskSchedule): RuntimeTaskSchedule | undefined {
	return schedule ? { ...schedule } : undefined;
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

export interface RuntimeUpdateTaskResult {
	board: RuntimeBoardData;
	task: RuntimeBoardCard | null;
	updated: boolean;
}

export interface RuntimeAddTaskDependencyResult {
	board: RuntimeBoardData;
	added: boolean;
	reason?: "missing_task" | "same_task" | "duplicate" | "trash_task" | "non_backlog";
	dependency?: RuntimeBoardDependency;
}

export interface RuntimeRemoveTaskDependencyResult {
	board: RuntimeBoardData;
	removed: boolean;
}

export interface RuntimeRecycleTaskResult {
	board: RuntimeBoardData;
	recycled: boolean;
	task: RuntimeBoardCard | null;
	fromColumnId: RuntimeBoardColumnId | null;
}

export interface RuntimeTrashTaskResult extends RuntimeMoveTaskResult {
	readyTaskIds: string[];
	recycledToBacklog: boolean;
}

export interface RuntimeDeleteTasksResult {
	board: RuntimeBoardData;
	deleted: boolean;
	deletedTaskIds: string[];
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

function collectTaskIds(board: RuntimeBoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function createDependencyId(): string {
	return crypto.randomUUID().replaceAll("-", "").slice(0, 8);
}

function createDependencyPairKey(backlogTaskId: string, linkedTaskId: string): string {
	return `${backlogTaskId}::${linkedTaskId}`;
}

function hasDependencyPair(board: RuntimeBoardData, backlogTaskId: string, linkedTaskId: string): boolean {
	const pairKey = createDependencyPairKey(backlogTaskId, linkedTaskId);
	for (const dependency of board.dependencies) {
		const existing = resolveDependencyEndpoints(board, dependency.fromTaskId, dependency.toTaskId);
		if ("reason" in existing) {
			continue;
		}
		if (createDependencyPairKey(existing.backlogTaskId, existing.linkedTaskId) === pairKey) {
			return true;
		}
	}
	return false;
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

function resolveDependencyEndpoints(
	board: RuntimeBoardData,
	firstTaskId: string,
	secondTaskId: string,
):
	| {
			backlogTaskId: string;
			linkedTaskId: string;
	  }
	| { reason: RuntimeAddTaskDependencyResult["reason"] } {
	const firstColumnId = getTaskColumnId(board, firstTaskId);
	const secondColumnId = getTaskColumnId(board, secondTaskId);
	if (!firstColumnId || !secondColumnId) {
		return { reason: "missing_task" };
	}
	if (firstColumnId === "trash" || secondColumnId === "trash") {
		return { reason: "trash_task" };
	}
	const firstIsBacklog = firstColumnId === "backlog";
	const secondIsBacklog = secondColumnId === "backlog";
	if (firstIsBacklog && secondIsBacklog) {
		return {
			backlogTaskId: firstTaskId,
			linkedTaskId: secondTaskId,
		};
	}
	if (!firstIsBacklog && !secondIsBacklog) {
		return { reason: "non_backlog" };
	}
	return firstIsBacklog
		? { backlogTaskId: firstTaskId, linkedTaskId: secondTaskId }
		: { backlogTaskId: secondTaskId, linkedTaskId: firstTaskId };
}

function getLinkedBacklogTaskIdsReadyAfterTaskTrashed(
	board: RuntimeBoardData,
	taskId: string,
	fromColumnId: RuntimeBoardColumnId | null,
): string[] {
	if (!taskId || board.dependencies.length === 0 || fromColumnId !== "review") {
		return [];
	}
	const readyTaskIds = new Set<string>();
	for (const dependency of board.dependencies) {
		if (dependency.toTaskId !== taskId) {
			continue;
		}
		if (getTaskColumnId(board, dependency.fromTaskId) !== "backlog") {
			continue;
		}
		readyTaskIds.add(dependency.fromTaskId);
	}
	return [...readyTaskIds];
}

export function updateTaskDependencies(board: RuntimeBoardData): RuntimeBoardData {
	if (board.dependencies.length === 0) {
		return board;
	}
	const taskIds = collectTaskIds(board);
	const dependencies: RuntimeBoardDependency[] = [];
	const existingPairs = new Set<string>();
	for (const dependency of board.dependencies) {
		const firstTaskId = dependency.fromTaskId.trim();
		const secondTaskId = dependency.toTaskId.trim();
		if (!firstTaskId || !secondTaskId || firstTaskId === secondTaskId) {
			continue;
		}
		if (!taskIds.has(firstTaskId) || !taskIds.has(secondTaskId)) {
			continue;
		}
		const resolved = resolveDependencyEndpoints(board, firstTaskId, secondTaskId);
		if ("reason" in resolved) {
			continue;
		}
		const pairKey = createDependencyPairKey(resolved.backlogTaskId, resolved.linkedTaskId);
		if (existingPairs.has(pairKey)) {
			continue;
		}
		existingPairs.add(pairKey);
		dependencies.push({
			id: dependency.id,
			fromTaskId: resolved.backlogTaskId,
			toTaskId: resolved.linkedTaskId,
			createdAt: dependency.createdAt,
		});
	}
	if (
		dependencies.length === board.dependencies.length &&
		dependencies.every((dependency, index) => {
			const current = board.dependencies[index];
			return (
				current &&
				current.id === dependency.id &&
				current.fromTaskId === dependency.fromTaskId &&
				current.toTaskId === dependency.toTaskId &&
				current.createdAt === dependency.createdAt
			);
		})
	) {
		return board;
	}
	return {
		...board,
		dependencies,
	};
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
	const explicitTaskId = input.taskId?.trim();
	if (explicitTaskId && existingIds.has(explicitTaskId)) {
		throw new Error(`Task "${explicitTaskId}" already exists.`);
	}
	const task: RuntimeBoardCard = {
		id: explicitTaskId || createUniqueTaskId(existingIds, randomUuid),
		prompt,
		startInPlanMode: Boolean(input.startInPlanMode),
		autoReviewEnabled: Boolean(input.autoReviewEnabled),
		autoReviewMode: normalizeTaskAutoReviewMode(input.autoReviewMode),
		images: cloneTaskImages(input.images),
		baseRef,
		createdAt: now,
		updatedAt: now,
		schedule: cloneSchedule(input.schedule),
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

export function addTaskDependency(
	board: RuntimeBoardData,
	firstTaskId: string,
	secondTaskId: string,
): RuntimeAddTaskDependencyResult {
	const normalizedFirstTaskId = firstTaskId.trim();
	const normalizedSecondTaskId = secondTaskId.trim();
	if (!normalizedFirstTaskId || !normalizedSecondTaskId) {
		return { board, added: false, reason: "missing_task" };
	}
	if (normalizedFirstTaskId === normalizedSecondTaskId) {
		return { board, added: false, reason: "same_task" };
	}
	const resolved = resolveDependencyEndpoints(board, normalizedFirstTaskId, normalizedSecondTaskId);
	if ("reason" in resolved) {
		return { board, added: false, reason: resolved.reason };
	}
	if (hasDependencyPair(board, resolved.backlogTaskId, resolved.linkedTaskId)) {
		return { board, added: false, reason: "duplicate" };
	}
	const dependency: RuntimeBoardDependency = {
		id: createDependencyId(),
		fromTaskId: resolved.backlogTaskId,
		toTaskId: resolved.linkedTaskId,
		createdAt: Date.now(),
	};
	return {
		board: {
			...board,
			dependencies: [...board.dependencies, dependency],
		},
		added: true,
		dependency,
	};
}

export function canAddTaskDependency(board: RuntimeBoardData, firstTaskId: string, secondTaskId: string): boolean {
	const normalizedFirstTaskId = firstTaskId.trim();
	const normalizedSecondTaskId = secondTaskId.trim();
	if (!normalizedFirstTaskId || !normalizedSecondTaskId || normalizedFirstTaskId === normalizedSecondTaskId) {
		return false;
	}
	const resolved = resolveDependencyEndpoints(board, normalizedFirstTaskId, normalizedSecondTaskId);
	if ("reason" in resolved) {
		return false;
	}
	return !hasDependencyPair(board, resolved.backlogTaskId, resolved.linkedTaskId);
}

export function removeTaskDependency(board: RuntimeBoardData, dependencyId: string): RuntimeRemoveTaskDependencyResult {
	const dependencies = board.dependencies.filter((dependency) => dependency.id !== dependencyId);
	if (dependencies.length === board.dependencies.length) {
		return { board, removed: false };
	}
	return {
		board: {
			...board,
			dependencies,
		},
		removed: true,
	};
}

export function getReadyLinkedTaskIdsForTaskInTrash(board: RuntimeBoardData, taskId: string): string[] {
	return getLinkedBacklogTaskIdsReadyAfterTaskTrashed(board, taskId, getTaskColumnId(board, taskId));
}

export function trashTaskAndGetReadyLinkedTaskIds(
	board: RuntimeBoardData,
	taskId: string,
	now: number = Date.now(),
): RuntimeTrashTaskResult {
	// If the task has an enabled schedule, recycle it to backlog instead of trashing.
	const taskLocation = findTaskLocation(board, taskId);
	if (taskLocation && taskLocation.task.schedule?.enabled) {
		const fromColumnId = taskLocation.columnId;
		const readyTaskIds = getLinkedBacklogTaskIdsReadyAfterTaskTrashed(board, taskId, fromColumnId);
		const recycled = recycleScheduledTaskToBacklog(board, taskId, now);
		return {
			moved: recycled.recycled,
			board: recycled.board,
			task: recycled.task,
			fromColumnId: recycled.fromColumnId,
			readyTaskIds: recycled.recycled ? readyTaskIds : [],
			recycledToBacklog: recycled.recycled,
		};
	}

	const fromColumnId = getTaskColumnId(board, taskId);
	const readyTaskIds = getLinkedBacklogTaskIdsReadyAfterTaskTrashed(board, taskId, fromColumnId);
	const movedToTrash = moveTaskToColumn(board, taskId, "trash", now);
	return {
		...movedToTrash,
		readyTaskIds: movedToTrash.moved ? readyTaskIds : [],
		recycledToBacklog: false,
	};
}

export function deleteTasksFromBoard(board: RuntimeBoardData, taskIds: Iterable<string>): RuntimeDeleteTasksResult {
	const normalizedTaskIds = new Set(
		Array.from(taskIds, (taskId) => taskId.trim()).filter((taskId) => taskId.length > 0),
	);
	if (normalizedTaskIds.size === 0) {
		return {
			board,
			deleted: false,
			deletedTaskIds: [],
		};
	}

	const deletedTaskIds: string[] = [];
	const columns = board.columns.map((column) => {
		const remainingCards = column.cards.filter((card) => {
			if (!normalizedTaskIds.has(card.id)) {
				return true;
			}
			deletedTaskIds.push(card.id);
			return false;
		});
		return remainingCards.length === column.cards.length ? column : { ...column, cards: remainingCards };
	});

	if (deletedTaskIds.length === 0) {
		return {
			board,
			deleted: false,
			deletedTaskIds: [],
		};
	}

	const deletedTaskIdSet = new Set(deletedTaskIds);
	const dependencies = board.dependencies.filter(
		(dependency) => !deletedTaskIdSet.has(dependency.fromTaskId) && !deletedTaskIdSet.has(dependency.toTaskId),
	);

	return {
		board: {
			...board,
			columns,
			dependencies,
		},
		deleted: true,
		deletedTaskIds,
	};
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
		board: updateTaskDependencies({
			...board,
			columns,
		}),
		task: movedTask,
		fromColumnId: found.columnId,
	};
}

export function updateTask(
	board: RuntimeBoardData,
	taskId: string,
	input: RuntimeUpdateTaskInput,
	now: number = Date.now(),
): RuntimeUpdateTaskResult {
	const normalizedTaskId = taskId.trim();
	if (!normalizedTaskId) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	const prompt = input.prompt.trim();
	if (!prompt) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	const baseRef = input.baseRef.trim();
	if (!baseRef) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	let updatedTask: RuntimeBoardCard | null = null;
	const columns = board.columns.map((column) => {
		let columnUpdated = false;
		const cards = column.cards.map((card) => {
			if (card.id !== normalizedTaskId) {
				return card;
			}
			columnUpdated = true;
			updatedTask = {
				...card,
				prompt,
				startInPlanMode: Boolean(input.startInPlanMode),
				autoReviewEnabled: Boolean(input.autoReviewEnabled),
				autoReviewMode: normalizeTaskAutoReviewMode(input.autoReviewMode),
				images: input.images === undefined ? card.images : cloneTaskImages(input.images),
				baseRef,
				updatedAt: now,
				schedule: input.schedule === undefined ? card.schedule : cloneSchedule(input.schedule),
			};
			return updatedTask;
		});
		return columnUpdated ? { ...column, cards } : column;
	});

	if (!updatedTask) {
		return {
			board,
			task: null,
			updated: false,
		};
	}

	return {
		board: {
			...board,
			columns,
		},
		task: updatedTask,
		updated: true,
	};
}

/**
 * Parse a basic cron field value against a candidate number.
 * Supports: "*" (any), a single number, or comma-separated numbers.
 */
function cronFieldMatches(field: string, value: number): boolean {
	if (field === "*") {
		return true;
	}
	return field.split(",").some((part) => {
		const parsed = Number.parseInt(part.trim(), 10);
		return !Number.isNaN(parsed) && parsed === value;
	});
}

/**
 * Parse a basic 5-field cron expression (minute hour day-of-month month day-of-week)
 * and compute the next matching timestamp after `now`.
 * Supports numbers, "*", and comma-separated numbers for each field.
 * Returns a timestamp in milliseconds.
 */
function computeNextCronRun(cronExpression: string, now: number): number {
	const fields = cronExpression.trim().split(/\s+/);
	if (fields.length !== 5) {
		// Invalid cron expression – fall back to 24 hours from now.
		return now + 86400000;
	}

	const [minuteField, hourField, domField, monthField, dowField] = fields as [string, string, string, string, string];

	// Start searching from the next minute after `now`.
	const start = new Date(now);
	start.setSeconds(0, 0);
	start.setMinutes(start.getMinutes() + 1);

	// Search up to 366 days ahead to avoid infinite loops.
	const maxIterations = 366 * 24 * 60;
	const candidate = new Date(start.getTime());

	for (let i = 0; i < maxIterations; i++) {
		const minute = candidate.getMinutes();
		const hour = candidate.getHours();
		const dom = candidate.getDate();
		const month = candidate.getMonth() + 1; // 1-based
		const dow = candidate.getDay(); // 0=Sunday

		if (
			cronFieldMatches(minuteField, minute) &&
			cronFieldMatches(hourField, hour) &&
			cronFieldMatches(domField, dom) &&
			cronFieldMatches(monthField, month) &&
			cronFieldMatches(dowField, dow)
		) {
			return candidate.getTime();
		}

		candidate.setMinutes(candidate.getMinutes() + 1);
	}

	// If no match found, fall back to 24 hours from now.
	return now + 86400000;
}

/**
 * Compute the next run time for a scheduled task.
 * - If `intervalMs` is set, returns `now + intervalMs`.
 * - If `cronExpression` is set, computes the next cron match.
 * - Falls back to `now + 86400000` (24 hours) if neither is specified.
 */
export function computeNextRunAt(schedule: RuntimeTaskSchedule, now: number): number {
	if (schedule.intervalMs != null && schedule.intervalMs > 0) {
		return now + schedule.intervalMs;
	}
	if (schedule.cronExpression != null && schedule.cronExpression.trim().length > 0) {
		return computeNextCronRun(schedule.cronExpression, now);
	}
	return now + 86400000;
}

/**
 * Recycle a scheduled task from its current column back to backlog.
 * Updates the schedule fields: sets lastRunAt, increments runCount, computes nextRunAt.
 * For "once" type schedules, sets enabled = false after recycling.
 * This is a pure function operating only on the board data structure.
 */
export function recycleScheduledTaskToBacklog(
	board: RuntimeBoardData,
	taskId: string,
	now: number = Date.now(),
): RuntimeRecycleTaskResult {
	const found = findTaskLocation(board, taskId);
	if (!found) {
		return { board, recycled: false, task: null, fromColumnId: null };
	}

	const task = found.task;
	if (!task.schedule) {
		return { board, recycled: false, task, fromColumnId: found.columnId };
	}

	// Already in backlog – nothing to move.
	if (found.columnId === "backlog") {
		return { board, recycled: false, task, fromColumnId: found.columnId };
	}

	const isOnce = task.schedule.type === "once";
	const newRunCount = (task.schedule.runCount ?? 0) + 1;
	const nextRunAt = isOnce ? task.schedule.nextRunAt : computeNextRunAt(task.schedule, now);

	const updatedSchedule: RuntimeTaskSchedule = {
		...task.schedule,
		lastRunAt: now,
		runCount: newRunCount,
		nextRunAt,
		enabled: isOnce ? false : task.schedule.enabled,
	};

	const recycledTask: RuntimeBoardCard = {
		...task,
		updatedAt: now,
		schedule: updatedSchedule,
	};

	// Find the backlog column index.
	const backlogColumnIndex = board.columns.findIndex((column) => column.id === "backlog");
	if (backlogColumnIndex === -1) {
		return { board, recycled: false, task, fromColumnId: found.columnId };
	}

	const columns = board.columns.map((column, index) => {
		if (index === found.columnIndex) {
			// Remove from source column.
			return {
				...column,
				cards: column.cards.filter((card) => card.id !== taskId),
			};
		}
		if (index === backlogColumnIndex) {
			// Add to backlog (at the end).
			return {
				...column,
				cards: [...column.cards, recycledTask],
			};
		}
		return column;
	});

	return {
		board: updateTaskDependencies({
			...board,
			columns,
		}),
		recycled: true,
		task: recycledTask,
		fromColumnId: found.columnId,
	};
}

/**
 * Returns task IDs of backlog tasks whose schedule is enabled and nextRunAt <= now.
 * This is a pure function operating only on the board data structure.
 */
export function getScheduledTasksDue(board: RuntimeBoardData, now: number = Date.now()): string[] {
	const backlogColumn = board.columns.find((column) => column.id === "backlog");
	if (!backlogColumn) {
		return [];
	}
	const dueTaskIds: string[] = [];
	for (const card of backlogColumn.cards) {
		if (card.schedule?.enabled && card.schedule.runCount > 0 && card.schedule.nextRunAt <= now) {
			dueTaskIds.push(card.id);
		}
	}
	return dueTaskIds;
}
