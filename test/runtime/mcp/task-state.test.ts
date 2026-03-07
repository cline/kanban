import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/runtime/api-contract.js";
import {
	addTaskDependency,
	addTaskToColumn,
	getTaskColumnId,
	moveTaskToColumn,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
	updateTaskDependencies,
} from "../../../src/runtime/mcp/task-state.js";

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

describe("addTaskToColumn", () => {
	it("adds a task to backlog", () => {
		const board = createBoard();
		const now = 123;
		const result = addTaskToColumn(
			board,
			"backlog",
			{
				prompt: "Implement MCP tools\nCreate and start task tools",
				autoReviewEnabled: true,
				autoReviewMode: "pr",
				baseRef: "main",
			},
			() => "abcdef1234567890",
			now,
		);

		expect(result.task).toMatchObject({
			id: "abcde",
			prompt: "Implement MCP tools\nCreate and start task tools",
			baseRef: "main",
			startInPlanMode: false,
			autoReviewEnabled: true,
			autoReviewMode: "pr",
			createdAt: now,
			updatedAt: now,
		});
		expect(result.board.columns[0]?.cards[0]?.id).toBe("abcde");
	});

	it("adds a task to review", () => {
		const board = createBoard();
		const result = addTaskToColumn(
			board,
			"review",
			{
				prompt: "Review me",
				baseRef: "main",
			},
			() => "review12345",
			50,
		);
		expect(result.board.columns[2]?.cards[0]?.id).toBe("revie");
	});
});

describe("updateTask", () => {
	it("updates task prompt and auto-review settings", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Original task",
				baseRef: "main",
			},
			() => "aaaaabbbbb",
			100,
		);

		const updated = updateTask(
			created.board,
			created.task.id,
			{
				prompt: "Updated task",
				startInPlanMode: true,
				autoReviewEnabled: true,
				autoReviewMode: "move_to_trash",
				baseRef: "develop",
			},
			200,
		);

		expect(updated.updated).toBe(true);
		expect(updated.task).toMatchObject({
			id: created.task.id,
			prompt: "Updated task",
			startInPlanMode: true,
			autoReviewEnabled: true,
			autoReviewMode: "move_to_trash",
			baseRef: "develop",
			updatedAt: 200,
		});
		expect(updated.board.columns[0]?.cards[0]).toMatchObject({
			id: created.task.id,
			autoReviewEnabled: true,
			autoReviewMode: "move_to_trash",
		});
	});

	it("normalizes unknown auto-review mode back to commit", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Original task",
				baseRef: "main",
			},
			() => "aaaaabbbbb",
			100,
		);

		const updated = updateTask(
			created.board,
			created.task.id,
			{
				prompt: "Updated task",
				autoReviewEnabled: true,
				autoReviewMode: "unexpected" as never,
				baseRef: "main",
			},
			200,
		);

		expect(updated.updated).toBe(true);
		expect(updated.task?.autoReviewMode).toBe("commit");
	});
});

describe("moveTaskToColumn", () => {
	it("moves backlog task to in_progress", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
			},
			() => "aaaaabbbbb",
			100,
		);
		const result = moveTaskToColumn(created.board, created.task.id, "in_progress", 200);

		expect(result.moved).toBe(true);
		expect(result.fromColumnId).toBe("backlog");
		expect(result.board.columns[0]?.cards).toHaveLength(0);
		expect(result.board.columns[1]?.cards[0]).toMatchObject({
			id: created.task.id,
			updatedAt: 200,
		});
	});

	it("returns moved false when task is already in target column", () => {
		const created = addTaskToColumn(
			createBoard(),
			"backlog",
			{
				prompt: "Task",
				baseRef: "main",
			},
			() => "aaaaabbbbb",
			100,
		);
		const moved = moveTaskToColumn(created.board, created.task.id, "in_progress", 200);
		const result = moveTaskToColumn(moved.board, created.task.id, "in_progress", 300);

		expect(result.moved).toBe(false);
		expect(result.fromColumnId).toBe("in_progress");
	});

	it("moves review task to in_progress", () => {
		const board = createBoard();
		board.columns[2]?.cards.push({
			id: "task1",
			prompt: "Review task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});

		const result = moveTaskToColumn(board, "task1", "in_progress", 2);
		expect(result.moved).toBe(true);
		expect(result.fromColumnId).toBe("review");
		expect(result.board.columns[1]?.cards.at(-1)?.id).toBe("task1");
	});

	it("returns moved false when task id does not exist", () => {
		const result = moveTaskToColumn(createBoard(), "missing", "in_progress");
		expect(result.moved).toBe(false);
		expect(result.task).toBeNull();
	});

	it("moves to trash by prepending", () => {
		const board = createBoard();
		board.columns[0]?.cards.push({
			id: "task-old",
			prompt: "Old task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.columns[3]?.cards.push({
			id: "trash-existing",
			prompt: "Existing trash",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});

		const result = moveTaskToColumn(board, "task-old", "trash", 2);
		expect(result.moved).toBe(true);
		expect(result.board.columns[3]?.cards[0]?.id).toBe("task-old");
	});

	it("removes dependencies when a backlog task leaves backlog", () => {
		const board = createBoard();
		board.columns[0]?.cards.push({
			id: "task-a",
			prompt: "Task A",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.columns[1]?.cards.push({
			id: "task-b",
			prompt: "Task B",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.dependencies.push({
			id: "dep-1",
			fromTaskId: "task-a",
			toTaskId: "task-b",
			createdAt: 1,
		});

		const moved = moveTaskToColumn(board, "task-a", "in_progress", 2);
		expect(moved.board.dependencies).toHaveLength(0);
	});
});

describe("task dependencies", () => {
	it("normalizes links so backlog tasks are always the source", () => {
		const board = createBoard();
		board.columns[0]?.cards.push({
			id: "task-backlog",
			prompt: "Backlog task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.columns[1]?.cards.push({
			id: "task-active",
			prompt: "Active task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.dependencies.push(
			{
				id: "dep-1",
				fromTaskId: "task-active",
				toTaskId: "task-backlog",
				createdAt: 1,
			},
			{
				id: "dep-2",
				fromTaskId: "task-backlog",
				toTaskId: "task-active",
				createdAt: 2,
			},
		);

		const normalized = updateTaskDependencies(board);
		expect(normalized.dependencies).toEqual([
			{
				id: "dep-1",
				fromTaskId: "task-backlog",
				toTaskId: "task-active",
				createdAt: 1,
			},
		]);
	});

	it("allows backlog-to-backlog links and normalizes them once one task starts", () => {
		const board = createBoard();
		board.columns[0]?.cards.push({
			id: "task-a",
			prompt: "Task A",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.columns[0]?.cards.push({
			id: "task-b",
			prompt: "Task B",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});

		const bothBacklog = addTaskDependency(board, "task-a", "task-b");
		expect(bothBacklog.added).toBe(true);
		expect(bothBacklog.dependency).toMatchObject({
			fromTaskId: "task-a",
			toTaskId: "task-b",
		});

		const movedA = moveTaskToColumn(bothBacklog.board, "task-a", "in_progress", 2);
		expect(movedA.board.dependencies).toEqual([
			expect.objectContaining({
				fromTaskId: "task-b",
				toTaskId: "task-a",
			}),
		]);
	});

	it("starts linked backlog tasks only when a review task is trashed", () => {
		const board = createBoard();
		board.columns[0]?.cards.push({
			id: "task-ready",
			prompt: "Ready task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.columns[2]?.cards.push(
			{
				id: "task-a",
				prompt: "Task A",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "task-b",
				prompt: "Task B",
				startInPlanMode: false,
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
		);

		const firstLink = addTaskDependency(board, "task-ready", "task-a");
		const secondLink = addTaskDependency(firstLink.board, "task-ready", "task-b");

		const firstTrash = trashTaskAndGetReadyLinkedTaskIds(secondLink.board, "task-a", 2);
		expect(firstTrash.readyTaskIds).toEqual(["task-ready"]);

		const secondTrash = trashTaskAndGetReadyLinkedTaskIds(secondLink.board, "task-b", 3);
		expect(secondTrash.readyTaskIds).toEqual(["task-ready"]);
	});

	it("does not start linked backlog tasks when an in-progress task is trashed", () => {
		const board = createBoard();
		board.columns[0]?.cards.push({
			id: "task-ready",
			prompt: "Ready task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		board.columns[1]?.cards.push({
			id: "task-active",
			prompt: "Task Active",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});

		const linked = addTaskDependency(board, "task-ready", "task-active");
		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, "task-active", 2);
		expect(trashed.readyTaskIds).toEqual([]);
		expect(trashed.board.dependencies).toEqual([]);
	});
});

describe("getTaskColumnId", () => {
	it("returns column id for task", () => {
		const board = createBoard();
		board.columns[1]?.cards.push({
			id: "task1",
			prompt: "Task",
			startInPlanMode: false,
			baseRef: "main",
			createdAt: 1,
			updatedAt: 1,
		});
		expect(getTaskColumnId(board, "task1")).toBe("in_progress");
	});

	it("returns null when task does not exist", () => {
		expect(getTaskColumnId(createBoard(), "missing")).toBeNull();
	});
});
