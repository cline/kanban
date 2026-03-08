import { describe, expect, it } from "vitest";

import { getNextDetailTaskIdAfterTrashMove, isDetailViewColumnId } from "@/kanban/utils/detail-view-task-order";

describe("isDetailViewColumnId", () => {
	it("returns true only for in-progress and review columns", () => {
		expect(isDetailViewColumnId("in_progress")).toBe(true);
		expect(isDetailViewColumnId("review")).toBe(true);
		expect(isDetailViewColumnId("backlog")).toBe(false);
		expect(isDetailViewColumnId("trash")).toBe(false);
	});
});

describe("getNextDetailTaskIdAfterTrashMove", () => {
	it("prefers the next detail task when available", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{ id: "backlog", title: "Backlog", cards: [{ id: "b1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{
						id: "in_progress",
						title: "In Progress",
						cards: [
							{ id: "i1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 },
							{ id: "i2", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 },
						],
					},
					{ id: "review", title: "Review", cards: [{ id: "r1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			},
			"i1",
		);

		expect(nextTaskId).toBe("i2");
	});

	it("falls back to previous detail task when removing the last detail task", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{ id: "backlog", title: "Backlog", cards: [] },
					{ id: "in_progress", title: "In Progress", cards: [{ id: "i1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "review", title: "Review", cards: [{ id: "r1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			},
			"r1",
		);

		expect(nextTaskId).toBe("i1");
	});

	it("returns first detail task when target task is not in detail columns", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{ id: "backlog", title: "Backlog", cards: [{ id: "b1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "in_progress", title: "In Progress", cards: [{ id: "i1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "review", title: "Review", cards: [{ id: "r1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			},
			"b1",
		);

		expect(nextTaskId).toBe("i1");
	});

	it("returns null when there are no detail tasks", () => {
		const nextTaskId = getNextDetailTaskIdAfterTrashMove(
			{
				columns: [
					{ id: "backlog", title: "Backlog", cards: [{ id: "b1", prompt: "", startInPlanMode: false, baseRef: "main", createdAt: 1, updatedAt: 1 }] },
					{ id: "in_progress", title: "In Progress", cards: [] },
					{ id: "review", title: "Review", cards: [] },
					{ id: "trash", title: "Trash", cards: [] },
				],
				dependencies: [],
			},
			"b1",
		);

		expect(nextTaskId).toBeNull();
	});
});
