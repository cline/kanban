import type { DropResult } from "@hello-pangea/dnd";
import { describe, expect, it } from "vitest";
import { applyAllProjectsDragResult } from "@/hooks/use-all-projects-drag";
import type { BoardData } from "@/types";

function createTestBoard(): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "proj-a:task-1",
						prompt: "Task 1",
						startInPlanMode: false,
						baseRef: "main",
						createdAt: 100,
						updatedAt: 100,
						projectId: "proj-a",
						projectName: "Project A",
						projectTaskId: "task-1",
					},
				],
			},
			{
				id: "in_progress",
				title: "In Progress",
				cards: [],
			},
			{
				id: "review",
				title: "Review",
				cards: [],
			},
			{
				id: "trash",
				title: "Trash",
				cards: [],
			},
		],
		dependencies: [],
	};
}

describe("applyAllProjectsDragResult", () => {
	it("returns null when drop has no destination", () => {
		const board = createTestBoard();
		const drop: DropResult = {
			draggableId: "proj-a:task-1",
			type: "CARD",
			source: { droppableId: "backlog", index: 0 },
			destination: null,
			reason: "DROP",
			mode: "FLUID",
			combine: null,
		};

		const result = applyAllProjectsDragResult(board, drop);
		expect(result).toBeNull();
	});

	it("returns null when dropped in same position", () => {
		const board = createTestBoard();
		const drop: DropResult = {
			draggableId: "proj-a:task-1",
			type: "CARD",
			source: { droppableId: "backlog", index: 0 },
			destination: { droppableId: "backlog", index: 0 },
			reason: "DROP",
			mode: "FLUID",
			combine: null,
		};

		const result = applyAllProjectsDragResult(board, drop);
		expect(result).toBeNull();
	});

	it("returns updated board and project info for backlog -> in_progress move", () => {
		const board = createTestBoard();
		const drop: DropResult = {
			draggableId: "proj-a:task-1",
			type: "CARD",
			source: { droppableId: "backlog", index: 0 },
			destination: { droppableId: "in_progress", index: 0 },
			reason: "DROP",
			mode: "FLUID",
			combine: null,
		};

		const result = applyAllProjectsDragResult(board, drop);
		expect(result).not.toBeNull();
		expect(result!.projectId).toBe("proj-a");
		expect(result!.projectTaskId).toBe("task-1");
		expect(result!.fromColumnId).toBe("backlog");
		expect(result!.toColumnId).toBe("in_progress");

		const backlog = result!.updatedBoard.columns.find((c) => c.id === "backlog");
		const inProgress = result!.updatedBoard.columns.find((c) => c.id === "in_progress");
		expect(backlog!.cards).toHaveLength(0);
		expect(inProgress!.cards).toHaveLength(1);
		expect(inProgress!.cards[0]!.id).toBe("proj-a:task-1");
	});

	it("returns null for disallowed cross-column moves", () => {
		const board = createTestBoard();
		// backlog -> review is not allowed
		const drop: DropResult = {
			draggableId: "proj-a:task-1",
			type: "CARD",
			source: { droppableId: "backlog", index: 0 },
			destination: { droppableId: "review", index: 0 },
			reason: "DROP",
			mode: "FLUID",
			combine: null,
		};

		const result = applyAllProjectsDragResult(board, drop);
		expect(result).toBeNull();
	});

	it("extracts projectId from card without projectId field by splitting aggregated id", () => {
		const board: BoardData = {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "proj-b:task-2",
							prompt: "Task 2",
							startInPlanMode: false,
							baseRef: "main",
							createdAt: 100,
							updatedAt: 100,
							// projectId intentionally set
							projectId: "proj-b",
							projectTaskId: "task-2",
						},
					],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		};

		const drop: DropResult = {
			draggableId: "proj-b:task-2",
			type: "CARD",
			source: { droppableId: "backlog", index: 0 },
			destination: { droppableId: "trash", index: 0 },
			reason: "DROP",
			mode: "FLUID",
			combine: null,
		};

		const result = applyAllProjectsDragResult(board, drop);
		expect(result).not.toBeNull();
		expect(result!.projectId).toBe("proj-b");
		expect(result!.projectTaskId).toBe("task-2");
		expect(result!.toColumnId).toBe("trash");
	});
});
