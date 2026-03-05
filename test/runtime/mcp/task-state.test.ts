import { describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/runtime/api-contract.js";
import { addTaskToColumn, getTaskColumnId, moveTaskToColumn } from "../../../src/runtime/mcp/task-state.js";

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
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
