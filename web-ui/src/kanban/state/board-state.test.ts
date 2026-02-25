import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/kanban/data/board-data";
import {
	addTaskDependency,
	addTaskToColumn,
	clearColumnTasks,
	getReadyDependentTaskIdsForCompletedTask,
	moveTaskToColumn,
	normalizeBoardData,
} from "@/kanban/state/board-state";

function createBacklogBoard(taskTitles: string[]): {
	board: ReturnType<typeof createInitialBoardData>;
	taskIdByTitle: Record<string, string>;
} {
	let board = createInitialBoardData();
	for (const taskTitle of taskTitles) {
		board = addTaskToColumn(board, "backlog", {
			title: taskTitle,
			prompt: taskTitle,
		});
	}
	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards ?? [];
	const taskIdByTitle: Record<string, string> = {};
	for (const card of backlogCards) {
		taskIdByTitle[card.title] = card.id;
	}
	return {
		board,
		taskIdByTitle,
	};
}

function requireTaskId(taskId: string | undefined, taskTitle: string): string {
	if (!taskId) {
		throw new Error(`Missing task id for ${taskTitle}`);
	}
	return taskId;
}

describe("board dependency state", () => {
	it("prevents duplicate and cyclic dependencies", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByTitle["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByTitle["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByTitle["Task C"], "Task C");

		const first = addTaskDependency(fixture.board, taskA, taskB);
		expect(first.added).toBe(true);

		const duplicate = addTaskDependency(first.board, taskA, taskB);
		expect(duplicate.added).toBe(false);
		expect(duplicate.reason).toBe("duplicate");

		const cycle = addTaskDependency(first.board, taskB, taskA);
		expect(cycle.added).toBe(false);
		expect(cycle.reason).toBe("cycle");

		const sameTask = addTaskDependency(first.board, taskC, taskC);
		expect(sameTask.added).toBe(false);
		expect(sameTask.reason).toBe("same_task");
	});

	it("resolves fan-in dependencies only when all prerequisites are in trash", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByTitle["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByTitle["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByTitle["Task C"], "Task C");

		const dependencyAB = addTaskDependency(fixture.board, taskA, taskC);
		expect(dependencyAB.added).toBe(true);
		const dependencyBB = addTaskDependency(dependencyAB.board, taskB, taskC);
		expect(dependencyBB.added).toBe(true);

		const moveATrash = moveTaskToColumn(dependencyBB.board, taskA, "trash");
		expect(moveATrash.moved).toBe(true);
		expect(getReadyDependentTaskIdsForCompletedTask(moveATrash.board, taskA)).toEqual([]);

		const moveBTrash = moveTaskToColumn(moveATrash.board, taskB, "trash");
		expect(moveBTrash.moved).toBe(true);
		expect(getReadyDependentTaskIdsForCompletedTask(moveBTrash.board, taskB)).toEqual([taskC]);
	});

	it("removes dependencies when trash is cleared", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByTitle["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByTitle["Task B"], "Task B");

		const linked = addTaskDependency(fixture.board, taskA, taskB);
		expect(linked.added).toBe(true);
		expect(linked.board.dependencies.length).toBe(1);

		const moved = moveTaskToColumn(linked.board, taskA, "trash");
		expect(moved.moved).toBe(true);
		const cleared = clearColumnTasks(moved.board, "trash");
		expect(cleared.clearedTaskIds).toContain(taskA);
		expect(cleared.board.dependencies).toEqual([]);
	});

	it("normalizes legacy boards and keeps valid acyclic dependencies", () => {
		const rawBoard = {
			columns: [
				{
					id: "backlog",
					cards: [
						{ id: "a", title: "Task A", description: "", prompt: "Task A" },
						{ id: "b", title: "Task B", description: "", prompt: "Task B" },
						{ id: "c", title: "Task C", description: "", prompt: "Task C" },
					],
				},
				{ id: "in_progress", cards: [] },
				{ id: "review", cards: [] },
				{ id: "trash", cards: [] },
			],
			dependencies: [
				{ id: "dep-1", fromTaskId: "a", toTaskId: "b" },
				{ id: "dep-2", fromTaskId: "b", toTaskId: "c" },
				{ id: "dep-3", fromTaskId: "c", toTaskId: "a" },
				{ id: "dep-4", fromTaskId: "a", toTaskId: "b" },
				{ id: "dep-5", fromTaskId: "a", toTaskId: "missing" },
			],
		};

		const normalized = normalizeBoardData(rawBoard);
		expect(normalized).not.toBeNull();
		expect(normalized?.dependencies.map((dependency) => `${dependency.fromTaskId}->${dependency.toTaskId}`)).toEqual([
			"a->b",
			"b->c",
		]);
	});
});
