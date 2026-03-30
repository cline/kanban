import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../src/core/api-contract";
import {
	addTaskDependency,
	addTaskToColumn,
	computeNextRunAt,
	deleteTasksFromBoard,
	getScheduledTasksDue,
	moveTaskToColumn,
	recycleScheduledTaskToBacklog,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
} from "../../src/core/task-board-mutations";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

describe("deleteTasksFromBoard", () => {
	it("removes a trashed task and any dependencies that reference it", () => {
		const createA = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task A", baseRef: "main" },
			() => "aaaaa111",
		);
		const createB = addTaskToColumn(createA.board, "review", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");
		const linked = addTaskDependency(createB.board, "aaaaa", "bbbbb");
		if (!linked.added) {
			throw new Error("Expected dependency to be created.");
		}
		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, "bbbbb");
		const deleted = deleteTasksFromBoard(trashed.board, ["bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds).toEqual(["bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
		expect(deleted.board.dependencies).toEqual([]);
	});

	it("removes multiple trashed tasks at once", () => {
		const createA = addTaskToColumn(createBoard(), "trash", { prompt: "Task A", baseRef: "main" }, () => "aaaaa111");
		const createB = addTaskToColumn(createA.board, "trash", { prompt: "Task B", baseRef: "main" }, () => "bbbbb111");

		const deleted = deleteTasksFromBoard(createB.board, ["aaaaa", "bbbbb"]);

		expect(deleted.deleted).toBe(true);
		expect(deleted.deletedTaskIds.sort()).toEqual(["aaaaa", "bbbbb"]);
		expect(deleted.board.columns.find((column) => column.id === "trash")?.cards).toEqual([]);
	});
});

describe("task images", () => {
	it("preserves images when creating and updating tasks", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task with image",
				baseRef: "main",
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			},
			() => "aaaaa111",
		);

		expect(created.task.images).toEqual([
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		const updated = updateTask(created.board, created.task.id, {
			prompt: "Task with updated image",
			baseRef: "main",
			images: [
				{
					id: "img-2",
					data: "def456",
					mimeType: "image/jpeg",
				},
			],
		});

		expect(updated.task?.images).toEqual([
			{
				id: "img-2",
				data: "def456",
				mimeType: "image/jpeg",
			},
		]);
	});
});
describe("scheduled task creation", () => {
	it("creates a task with a recurring schedule", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now + 3600000,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Recurring task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);

		expect(created.task.schedule).toBeDefined();
		expect(created.task.schedule?.type).toBe("recurring");
		expect(created.task.schedule?.intervalMs).toBe(3600000);
		expect(created.task.schedule?.nextRunAt).toBe(now + 3600000);
		expect(created.task.schedule?.runCount).toBe(0);
		expect(created.task.schedule?.enabled).toBe(true);
	});

	it("creates a task with a one-time schedule", () => {
		const now = 1000000;
		const schedule = {
			type: "once" as const,
			nextRunAt: now + 60000,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "One-time task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);

		expect(created.task.schedule).toBeDefined();
		expect(created.task.schedule?.type).toBe("once");
		expect(created.task.schedule?.nextRunAt).toBe(now + 60000);
		expect(created.task.schedule?.enabled).toBe(true);
	});

	it("creates a task without schedule (backward compat)", () => {
		const now = 1000000;
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Plain task", baseRef: "main" },
			() => "aaaaa111",
			now,
		);

		expect(created.task.schedule).toBeUndefined();
		expect(created.task.prompt).toBe("Plain task");
		expect(created.task.baseRef).toBe("main");
	});
});

describe("scheduled task update", () => {
	it("adds a schedule to an existing task", () => {
		const now = 1000000;
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Task without schedule", baseRef: "main" },
			() => "aaaaa111",
			now,
		);

		expect(created.task.schedule).toBeUndefined();

		const schedule = {
			type: "recurring" as const,
			intervalMs: 7200000,
			nextRunAt: now + 7200000,
			runCount: 0,
			enabled: true,
		};
		const updated = updateTask(
			created.board,
			created.task.id,
			{ prompt: "Task without schedule", baseRef: "main", schedule },
			now + 100,
		);

		expect(updated.updated).toBe(true);
		expect(updated.task?.schedule).toBeDefined();
		expect(updated.task?.schedule?.type).toBe("recurring");
		expect(updated.task?.schedule?.intervalMs).toBe(7200000);
		expect(updated.task?.schedule?.enabled).toBe(true);
	});

	it("updates schedule fields on a scheduled task", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now + 3600000,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Scheduled task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);

		const newSchedule = {
			type: "recurring" as const,
			intervalMs: 1800000,
			nextRunAt: now + 1800000,
			runCount: 0,
			enabled: true,
		};
		const updated = updateTask(
			created.board,
			created.task.id,
			{ prompt: "Scheduled task", baseRef: "main", schedule: newSchedule },
			now + 100,
		);

		expect(updated.updated).toBe(true);
		expect(updated.task?.schedule?.intervalMs).toBe(1800000);
		expect(updated.task?.schedule?.nextRunAt).toBe(now + 1800000);
	});

	it("preserves existing schedule when update omits schedule", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now + 3600000,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Scheduled task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);

		// Update without passing schedule — should preserve the existing one.
		const updated = updateTask(
			created.board,
			created.task.id,
			{ prompt: "Updated prompt", baseRef: "main" },
			now + 100,
		);

		expect(updated.updated).toBe(true);
		expect(updated.task?.schedule).toBeDefined();
		expect(updated.task?.schedule?.type).toBe("recurring");
		expect(updated.task?.schedule?.intervalMs).toBe(3600000);
		expect(updated.task?.schedule?.nextRunAt).toBe(now + 3600000);
	});
});

describe("recycleScheduledTaskToBacklog", () => {
	it("moves a review task back to backlog and updates schedule fields", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Recurring task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);
		// Move to review column to simulate completion.
		const moved = moveTaskToColumn(created.board, "aaaaa", "review", now + 100);
		expect(moved.moved).toBe(true);

		const recycled = recycleScheduledTaskToBacklog(moved.board, "aaaaa", now + 200);

		expect(recycled.recycled).toBe(true);
		expect(recycled.fromColumnId).toBe("review");
		expect(recycled.task?.schedule?.lastRunAt).toBe(now + 200);
		expect(recycled.task?.schedule?.runCount).toBe(1);
		expect(recycled.task?.schedule?.enabled).toBe(true);
		// Task should be in backlog.
		const backlogCards = recycled.board.columns.find((c) => c.id === "backlog")?.cards ?? [];
		expect(backlogCards.some((card) => card.id === "aaaaa")).toBe(true);
		// Task should NOT be in review.
		const reviewCards = recycled.board.columns.find((c) => c.id === "review")?.cards ?? [];
		expect(reviewCards.some((card) => card.id === "aaaaa")).toBe(false);
	});

	it("increments runCount on each recycle", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Recurring task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);

		// First cycle: move to review, then recycle.
		const moved1 = moveTaskToColumn(created.board, "aaaaa", "review", now + 100);
		const recycled1 = recycleScheduledTaskToBacklog(moved1.board, "aaaaa", now + 200);
		expect(recycled1.task?.schedule?.runCount).toBe(1);

		// Second cycle: move to review again, then recycle.
		const moved2 = moveTaskToColumn(recycled1.board, "aaaaa", "review", now + 300);
		const recycled2 = recycleScheduledTaskToBacklog(moved2.board, "aaaaa", now + 400);
		expect(recycled2.task?.schedule?.runCount).toBe(2);
	});

	it("sets enabled=false for once-type tasks after recycle", () => {
		const now = 1000000;
		const schedule = {
			type: "once" as const,
			nextRunAt: now,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "One-time task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);
		const moved = moveTaskToColumn(created.board, "aaaaa", "review", now + 100);
		const recycled = recycleScheduledTaskToBacklog(moved.board, "aaaaa", now + 200);

		expect(recycled.recycled).toBe(true);
		expect(recycled.task?.schedule?.enabled).toBe(false);
		expect(recycled.task?.schedule?.runCount).toBe(1);
	});

	it("computes nextRunAt from intervalMs for recurring tasks", () => {
		const now = 1000000;
		const intervalMs = 7200000; // 2 hours
		const schedule = {
			type: "recurring" as const,
			intervalMs,
			nextRunAt: now,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Recurring task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);
		const moved = moveTaskToColumn(created.board, "aaaaa", "review", now + 100);
		const recycleTime = now + 200;
		const recycled = recycleScheduledTaskToBacklog(moved.board, "aaaaa", recycleTime);

		expect(recycled.recycled).toBe(true);
		expect(recycled.task?.schedule?.nextRunAt).toBe(recycleTime + intervalMs);
	});

	it("returns recycled=false for non-existent task", () => {
		const board = createBoard();
		const result = recycleScheduledTaskToBacklog(board, "nonexistent");

		expect(result.recycled).toBe(false);
		expect(result.task).toBeNull();
		expect(result.fromColumnId).toBeNull();
	});

	it("returns recycled=false for task without schedule", () => {
		const now = 1000000;
		const created = addTaskToColumn(
			createBoard(),
			"review",
			{ prompt: "No schedule", baseRef: "main" },
			() => "aaaaa111",
			now,
		);
		const result = recycleScheduledTaskToBacklog(created.board, "aaaaa", now + 100);

		expect(result.recycled).toBe(false);
		expect(result.task).not.toBeNull();
		expect(result.task?.schedule).toBeUndefined();
	});
});

describe("trashTaskAndGetReadyLinkedTaskIds with scheduled tasks", () => {
	it("recycles scheduled task to backlog instead of trashing", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now,
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Scheduled task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);
		// Move to review to simulate the task being in a trashable state.
		const moved = moveTaskToColumn(created.board, "aaaaa", "review", now + 100);

		const result = trashTaskAndGetReadyLinkedTaskIds(moved.board, "aaaaa", now + 200);

		expect(result.recycledToBacklog).toBe(true);
		expect(result.moved).toBe(true);
		// Task should be in backlog, not trash.
		const backlogCards = result.board.columns.find((c) => c.id === "backlog")?.cards ?? [];
		expect(backlogCards.some((card) => card.id === "aaaaa")).toBe(true);
		const trashCards = result.board.columns.find((c) => c.id === "trash")?.cards ?? [];
		expect(trashCards.some((card) => card.id === "aaaaa")).toBe(false);
	});

	it("still trashes non-scheduled tasks normally", () => {
		const now = 1000000;
		const created = addTaskToColumn(
			createBoard(),
			"review",
			{ prompt: "Normal task", baseRef: "main" },
			() => "aaaaa111",
			now,
		);

		const result = trashTaskAndGetReadyLinkedTaskIds(created.board, "aaaaa", now + 100);

		expect(result.recycledToBacklog).toBe(false);
		expect(result.moved).toBe(true);
		const trashCards = result.board.columns.find((c) => c.id === "trash")?.cards ?? [];
		expect(trashCards.some((card) => card.id === "aaaaa")).toBe(true);
	});

	it("still trashes scheduled tasks with enabled=false normally", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now,
			runCount: 1,
			enabled: false,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Disabled scheduled task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);
		const moved = moveTaskToColumn(created.board, "aaaaa", "review", now + 100);

		const result = trashTaskAndGetReadyLinkedTaskIds(moved.board, "aaaaa", now + 200);

		expect(result.recycledToBacklog).toBe(false);
		expect(result.moved).toBe(true);
		const trashCards = result.board.columns.find((c) => c.id === "trash")?.cards ?? [];
		expect(trashCards.some((card) => card.id === "aaaaa")).toBe(true);
	});
});

describe("getScheduledTasksDue", () => {
	it("returns task IDs where nextRunAt is in the past", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now - 100, // In the past
			runCount: 1, // Must have run at least once to be auto-started
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Due task", baseRef: "main", schedule },
			() => "aaaaa111",
			now - 200,
		);

		const dueIds = getScheduledTasksDue(created.board, now);
		expect(dueIds).toEqual(["aaaaa"]);
	});

	it("does not return tasks where nextRunAt is in the future", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now + 100000, // In the future
			runCount: 0,
			enabled: true,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Future task", baseRef: "main", schedule },
			() => "aaaaa111",
			now,
		);

		const dueIds = getScheduledTasksDue(created.board, now);
		expect(dueIds).toEqual([]);
	});

	it("does not return tasks with enabled=false", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now - 100, // In the past, but disabled.
			runCount: 1,
			enabled: false,
		};
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Disabled task", baseRef: "main", schedule },
			() => "aaaaa111",
			now - 200,
		);

		const dueIds = getScheduledTasksDue(created.board, now);
		expect(dueIds).toEqual([]);
	});

	it("only returns backlog tasks, not in_progress scheduled tasks", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 3600000,
			nextRunAt: now - 100, // Due
			runCount: 0,
			enabled: true,
		};
		// Create a due task directly in in_progress.
		const created = addTaskToColumn(
			createBoard(),
			"in_progress",
			{ prompt: "Running task", baseRef: "main", schedule },
			() => "aaaaa111",
			now - 200,
		);

		const dueIds = getScheduledTasksDue(created.board, now);
		expect(dueIds).toEqual([]);
	});

	it("returns empty array when no tasks are scheduled", () => {
		const now = 1000000;
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{ prompt: "Plain task", baseRef: "main" },
			() => "aaaaa111",
			now,
		);

		const dueIds = getScheduledTasksDue(created.board, now);
		expect(dueIds).toEqual([]);
	});
});

describe("computeNextRunAt", () => {
	it("computes next run from intervalMs", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			intervalMs: 5000,
			nextRunAt: 0,
			runCount: 0,
			enabled: true,
		};

		const next = computeNextRunAt(schedule, now);
		expect(next).toBe(now + 5000);
	});

	it("falls back to 24h default if no interval or cron", () => {
		const now = 1000000;
		const schedule = {
			type: "recurring" as const,
			nextRunAt: 0,
			runCount: 0,
			enabled: true,
		};

		const next = computeNextRunAt(schedule, now);
		expect(next).toBe(now + 86400000);
	});
});
