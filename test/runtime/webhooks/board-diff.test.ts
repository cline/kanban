import { beforeEach, describe, expect, it } from "vitest";

import type { RuntimeBoardData } from "../../../src/core/api-contract.js";
import { diffBoard } from "../../../src/webhooks/board-diff.js";

const WORKSPACE_ID = "test-workspace";
const NOW = 1700000000000;
let idCounter = 0;
const nextId = () => `evt-${++idCounter}`;

function createBoard(columns?: Partial<Record<string, Array<{ id: string; prompt: string }>>>): RuntimeBoardData {
	const backlog = columns?.backlog ?? [];
	const in_progress = columns?.in_progress ?? [];
	const review = columns?.review ?? [];
	const trash = columns?.trash ?? [];
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlog.map(toCard) },
			{ id: "in_progress", title: "In Progress", cards: in_progress.map(toCard) },
			{ id: "review", title: "Review", cards: review.map(toCard) },
			{ id: "trash", title: "Trash", cards: trash.map(toCard) },
		],
		dependencies: [],
	};
}

function toCard(input: { id: string; prompt: string }) {
	return {
		id: input.id,
		prompt: input.prompt,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: NOW,
		updatedAt: NOW,
	};
}

describe("diffBoard", () => {
	beforeEach(() => {
		idCounter = 0;
	});

	it("returns empty array when boards are identical", () => {
		const board = createBoard({ backlog: [{ id: "aaa", prompt: "Do something" }] });
		const events = diffBoard(board, board, WORKSPACE_ID, NOW, nextId);
		expect(events).toEqual([]);
	});

	it("detects task.created when a new card appears", () => {
		const oldBoard = createBoard({});
		const newBoard = createBoard({ backlog: [{ id: "aaa", prompt: "New task" }] });
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			id: "evt-1",
			type: "task.created",
			timestamp: NOW,
			workspaceId: WORKSPACE_ID,
			task: {
				id: "aaa",
				title: "New task",
				columnId: "backlog",
			},
		});
	});

	it("detects task.created when a card appears directly in a non-backlog column", () => {
		const oldBoard = createBoard({});
		const newBoard = createBoard({ in_progress: [{ id: "aaa", prompt: "Urgent fix" }] });
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			id: "evt-1",
			type: "task.created",
			timestamp: NOW,
			workspaceId: WORKSPACE_ID,
			task: {
				id: "aaa",
				title: "Urgent fix",
				columnId: "in_progress",
			},
		});
	});

	it("detects task.moved when a card moves between columns", () => {
		const oldBoard = createBoard({ backlog: [{ id: "aaa", prompt: "Move me" }] });
		const newBoard = createBoard({ in_progress: [{ id: "aaa", prompt: "Move me" }] });
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({
			id: "evt-1",
			type: "task.moved",
			timestamp: NOW,
			workspaceId: WORKSPACE_ID,
			task: {
				id: "aaa",
				title: "Move me",
				columnId: "in_progress",
				previousColumnId: "backlog",
			},
		});
	});

	it("emits both task.moved and task.completed when a card moves to trash", () => {
		const oldBoard = createBoard({ review: [{ id: "aaa", prompt: "Complete me" }] });
		const newBoard = createBoard({ trash: [{ id: "aaa", prompt: "Complete me" }] });
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		expect(events).toHaveLength(2);
		expect(events).toEqual([
			expect.objectContaining({
				type: "task.moved",
				task: expect.objectContaining({ columnId: "trash", previousColumnId: "review" }),
			}),
			expect.objectContaining({
				type: "task.completed",
				task: expect.objectContaining({ columnId: "trash", previousColumnId: "review" }),
			}),
		]);
	});

	it("handles multiple changes in a single diff", () => {
		const oldBoard = createBoard({
			backlog: [
				{ id: "aaa", prompt: "Task A" },
				{ id: "bbb", prompt: "Task B" },
			],
		});
		const newBoard = createBoard({
			in_progress: [{ id: "aaa", prompt: "Task A" }],
			backlog: [{ id: "bbb", prompt: "Task B" }],
			review: [{ id: "ccc", prompt: "Task C" }],
		});
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		// aaa moved, ccc created, bbb unchanged
		const types = events.map((e) => e.type);
		expect(types).toContain("task.moved");
		expect(types).toContain("task.created");
		expect(events).toHaveLength(2);
	});

	it("ignores cards that are deleted from the board", () => {
		const oldBoard = createBoard({ backlog: [{ id: "aaa", prompt: "Gone" }] });
		const newBoard = createBoard({});
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		// Deleted cards don't produce events — only new or moved cards do
		expect(events).toEqual([]);
	});

	it("does not emit events for cards that stay in the same column", () => {
		const oldBoard = createBoard({
			backlog: [{ id: "aaa", prompt: "Stay" }],
			in_progress: [{ id: "bbb", prompt: "Working" }],
		});
		const newBoard = createBoard({
			backlog: [{ id: "aaa", prompt: "Stay (edited)" }],
			in_progress: [{ id: "bbb", prompt: "Working" }],
		});
		const events = diffBoard(oldBoard, newBoard, WORKSPACE_ID, NOW, nextId);
		expect(events).toEqual([]);
	});
});
