import { describe, expect, it } from "vitest";
import { formatDependencySummaries } from "../../src/cline-sdk/cline-task-session-service";
import type { RuntimeBoardData } from "../../src/core/api-contract";

function createBoardWithDependencies(
	taskId: string,
	prerequisites: Array<{
		id: string;
		title: string;
		summary?: string;
		inTrash?: boolean;
	}>,
	nonPrerequisites: Array<{
		id: string;
		title: string;
		summary?: string;
		inTrash?: boolean;
	}> = [],
): RuntimeBoardData {
	const dependencies = prerequisites.map((pre, index) => ({
		id: `dep-${index}`,
		fromTaskId: taskId,
		toTaskId: pre.id,
		createdAt: 1000,
	}));

	const trashCards = [
		...prerequisites
			.filter((p) => p.inTrash !== false)
			.map((p) => ({
				id: p.id,
				title: p.title,
				prompt: "test",
				startInPlanMode: false,
				baseRef: "main",
				summary: p.summary ? { content: p.summary, source: "automatic" as const, updatedAt: 1000 } : undefined,
				createdAt: 1000,
				updatedAt: 1000,
			})),
		...nonPrerequisites
			.filter((p) => p.inTrash !== false)
			.map((p) => ({
				id: p.id,
				title: p.title,
				prompt: "test",
				startInPlanMode: false,
				baseRef: "main",
				summary: p.summary ? { content: p.summary, source: "automatic" as const, updatedAt: 1000 } : undefined,
				createdAt: 1000,
				updatedAt: 1000,
			})),
	];

	const backlogCards = [
		...prerequisites
			.filter((p) => p.inTrash === false)
			.map((p) => ({
				id: p.id,
				title: p.title,
				prompt: "test",
				startInPlanMode: false,
				baseRef: "main",
				summary: p.summary ? { content: p.summary, source: "automatic" as const, updatedAt: 1000 } : undefined,
				createdAt: 1000,
				updatedAt: 1000,
			})),
		...nonPrerequisites
			.filter((p) => p.inTrash === false)
			.map((p) => ({
				id: p.id,
				title: p.title,
				prompt: "test",
				startInPlanMode: false,
				baseRef: "main",
				summary: p.summary ? { content: p.summary, source: "automatic" as const, updatedAt: 1000 } : undefined,
				createdAt: 1000,
				updatedAt: 1000,
			})),
	];

	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: backlogCards },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Done", cards: trashCards },
		],
		dependencies,
	} satisfies RuntimeBoardData;
}

describe("formatDependencySummaries", () => {
	it("returns empty string when no dependencies", () => {
		const board: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Done", cards: [] },
			],
			dependencies: [],
		};

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toBe("");
	});

	it("returns empty string when no trash column", () => {
		const board: RuntimeBoardData = {
			columns: [
				{ id: "backlog", title: "Backlog", cards: [] },
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
			],
			dependencies: [{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 1000 }],
		};

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toBe("");
	});

	it("includes only trash prerequisite summaries", () => {
		const board = createBoardWithDependencies(
			"task-1",
			[
				{ id: "task-2", title: "Task 2", summary: "Completed task 2", inTrash: true },
				{ id: "task-3", title: "Task 3", summary: "Completed task 3", inTrash: true },
			],
			[{ id: "task-4", title: "Task 4", summary: "Not a prerequisite", inTrash: true }],
		);

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toContain("# Completed Prerequisites");
		expect(result).toContain("Task 2");
		expect(result).toContain("Task 3");
		expect(result).not.toContain("Task 4");
	});

	it("excludes non-trash prerequisites", () => {
		const board = createBoardWithDependencies("task-1", [
			{ id: "task-2", title: "Task 2", summary: "Completed task 2", inTrash: true },
			{ id: "task-3", title: "Task 3", summary: "In progress", inTrash: false },
		]);

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toContain("Task 2");
		expect(result).not.toContain("Task 3");
	});

	it("excludes prerequisites without summaries", () => {
		const board = createBoardWithDependencies("task-1", [
			{ id: "task-2", title: "Task 2", summary: "Completed task 2", inTrash: true },
			{ id: "task-3", title: "Task 3", summary: undefined, inTrash: true },
		]);

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toContain("Task 2");
		expect(result).not.toContain("Task 3");
	});

	it("limits to 3 prerequisites and shows count", () => {
		const board = createBoardWithDependencies("task-1", [
			{ id: "task-2", title: "Task 2", summary: "Summary 2", inTrash: true },
			{ id: "task-3", title: "Task 3", summary: "Summary 3", inTrash: true },
			{ id: "task-4", title: "Task 4", summary: "Summary 4", inTrash: true },
			{ id: "task-5", title: "Task 5", summary: "Summary 5", inTrash: true },
		]);

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toContain("showing 3 of 4");
		expect(result).toContain("Task 2");
		expect(result).toContain("Task 3");
		expect(result).toContain("Task 4");
		expect(result).not.toContain("Task 5");
	});

	it("sorts prerequisites by taskId", () => {
		const board = createBoardWithDependencies("task-1", [
			{ id: "task-5", title: "Task 5", summary: "Summary 5", inTrash: true },
			{ id: "task-2", title: "Task 2", summary: "Summary 2", inTrash: true },
			{ id: "task-4", title: "Task 4", summary: "Summary 4", inTrash: true },
		]);

		const result = formatDependencySummaries(board, "task-1");
		const task2Index = result.indexOf("Task 2");
		const task4Index = result.indexOf("Task 4");
		const task5Index = result.indexOf("Task 5");
		expect(task2Index).toBeLessThan(task4Index);
		expect(task4Index).toBeLessThan(task5Index);
	});

	it("respects total 4000 char budget without arbitrary per-summary cutoff", () => {
		const longSummary = "x".repeat(1500);
		const board = createBoardWithDependencies("task-1", [
			{ id: "task-2", title: "Task 2", summary: longSummary, inTrash: true },
			{ id: "task-3", title: "Task 3", summary: longSummary, inTrash: true },
		]);

		const result = formatDependencySummaries(board, "task-1");
		expect(result.length).toBeLessThanOrEqual(4000);
		expect(result).toContain("Task 2");
		expect(result).toContain("Task 3");
	});

	it("returns empty string when section would be empty", () => {
		const board = createBoardWithDependencies("task-1", [
			{ id: "task-2", title: "Task 2", summary: undefined, inTrash: true },
		]);

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toBe("");
	});

	it("handles empty dependency list gracefully", () => {
		const board = createBoardWithDependencies("task-1", []);

		const result = formatDependencySummaries(board, "task-1");
		expect(result).toBe("");
	});
});
