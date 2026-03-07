import { describe, expect, it } from "vitest";

import { createInitialBoardData } from "@/kanban/data/board-data";
import {
	addTaskDependency,
	addTaskToColumn,
	applyDragResult,
	clearColumnTasks,
	getTaskColumnId,
	moveTaskToColumn,
	normalizeBoardData,
	trashTaskAndGetReadyLinkedTaskIds,
} from "@/kanban/state/board-state";
import type { ProgrammaticCardMoveInFlight } from "@/kanban/state/drag-rules";

function createBacklogBoard(taskPrompts: string[]): {
	board: ReturnType<typeof createInitialBoardData>;
	taskIdByPrompt: Record<string, string>;
} {
	let board = createInitialBoardData();
	for (const taskPrompt of taskPrompts) {
		board = addTaskToColumn(board, "backlog", {
			prompt: taskPrompt,
			baseRef: "main",
		});
	}
	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards ?? [];
	const taskIdByPrompt: Record<string, string> = {};
	for (const card of backlogCards) {
		taskIdByPrompt[card.prompt] = card.id;
	}
	return {
		board,
		taskIdByPrompt,
	};
}

function requireTaskId(taskId: string | undefined, taskPrompt: string): string {
	if (!taskId) {
		throw new Error(`Missing task id for ${taskPrompt}`);
	}
	return taskId;
}

describe("board dependency state", () => {
	it("prevents duplicate links in either direction", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");
		const movedA = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedA.moved).toBe(true);

		const first = addTaskDependency(movedA.board, taskA, taskB);
		expect(first.added).toBe(true);

		const duplicate = addTaskDependency(first.board, taskA, taskB);
		expect(duplicate.added).toBe(false);
		expect(duplicate.reason).toBe("duplicate");

		const reverseDuplicate = addTaskDependency(first.board, taskB, taskA);
		expect(reverseDuplicate.added).toBe(false);
		expect(reverseDuplicate.reason).toBe("duplicate");

		const sameTask = addTaskDependency(first.board, taskC, taskC);
		expect(sameTask.added).toBe(false);
		expect(sameTask.reason).toBe("same_task");
	});

	it("allows backlog-to-backlog links and reorients them when one task starts", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");

		const bothBacklog = addTaskDependency(fixture.board, taskA, taskB);
		expect(bothBacklog.added).toBe(true);
		const [firstBacklogTaskId, secondBacklogTaskId] = [taskA, taskB].sort();
		expect(bothBacklog.dependency).toMatchObject({
			fromTaskId: firstBacklogTaskId,
			toTaskId: secondBacklogTaskId,
		});

		const movedA = moveTaskToColumn(bothBacklog.board, taskA, "in_progress");
		expect(movedA.moved).toBe(true);
		expect(movedA.board.dependencies).toEqual([
			expect.objectContaining({
				fromTaskId: taskB,
				toTaskId: taskA,
			}),
		]);
	});

	it("only unlocks backlog cards when a review card is trashed", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");
		const movedA = moveTaskToColumn(fixture.board, taskA, "review");
		expect(movedA.moved).toBe(true);
		const movedB = moveTaskToColumn(movedA.board, taskB, "review");
		expect(movedB.moved).toBe(true);

		const dependencyA = addTaskDependency(movedB.board, taskC, taskA);
		expect(dependencyA.added).toBe(true);
		const dependencyB = addTaskDependency(dependencyA.board, taskC, taskB);
		expect(dependencyB.added).toBe(true);

		const moveATrash = trashTaskAndGetReadyLinkedTaskIds(dependencyB.board, taskA);
		expect(moveATrash.moved).toBe(true);
		expect(moveATrash.board.dependencies).toHaveLength(1);
		expect(moveATrash.readyTaskIds).toEqual([taskC]);

		const moveBTrash = trashTaskAndGetReadyLinkedTaskIds(dependencyB.board, taskB);
		expect(moveBTrash.moved).toBe(true);
		expect(moveBTrash.readyTaskIds).toEqual([taskC]);
	});

	it("does not unlock backlog cards when an in-progress card is trashed", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const movedA = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedA.moved).toBe(true);

		const linked = addTaskDependency(movedA.board, taskA, taskB);
		expect(linked.added).toBe(true);

		const trashed = trashTaskAndGetReadyLinkedTaskIds(linked.board, taskA);
		expect(trashed.readyTaskIds).toEqual([]);
		expect(trashed.board.dependencies).toEqual([]);
	});

	it("removes dependency links once both linked cards are in trash", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const movedA = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedA.moved).toBe(true);

		const linked = addTaskDependency(movedA.board, taskA, taskB);
		expect(linked.added).toBe(true);
		expect(linked.board.dependencies).toHaveLength(1);

		const movedATrash = moveTaskToColumn(linked.board, taskA, "trash");
		expect(movedATrash.board.dependencies).toHaveLength(0);

		const movedBTrash = moveTaskToColumn(movedATrash.board, taskB, "trash");
		expect(movedBTrash.board.dependencies).toHaveLength(0);
	});

	it("removes links once neither endpoint remains in backlog", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const movedA = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedA.moved).toBe(true);

		const linked = addTaskDependency(movedA.board, taskA, taskB);
		expect(linked.added).toBe(true);
		expect(linked.board.dependencies).toHaveLength(1);

		const movedB = moveTaskToColumn(linked.board, taskB, "in_progress");
		expect(movedB.board.dependencies).toHaveLength(0);
	});

	it("drops links automatically when an unlocked backlog card starts", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");
		const movedA = moveTaskToColumn(fixture.board, taskA, "in_progress");
		const movedB = moveTaskToColumn(movedA.board, taskB, "review");
		const firstLink = addTaskDependency(movedB.board, taskC, taskA);
		const secondLink = addTaskDependency(firstLink.board, taskC, taskB);

		const trashA = trashTaskAndGetReadyLinkedTaskIds(secondLink.board, taskA);
		expect(trashA.readyTaskIds).toEqual([]);

		const trashB = trashTaskAndGetReadyLinkedTaskIds(trashA.board, taskB);
		expect(trashB.readyTaskIds).toEqual([taskC]);

		const autoStarted = moveTaskToColumn(trashB.board, taskC, "in_progress");
		expect(autoStarted.moved).toBe(true);
		expect(autoStarted.board.dependencies).toEqual([]);
	});

	it("keeps manual in-progress to review drags disabled", () => {
		const fixture = createBacklogBoard(["Task A"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const movedToInProgress = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedToInProgress.moved).toBe(true);

		const attemptedReviewMove = applyDragResult(movedToInProgress.board, {
			draggableId: taskA,
			type: "CARD",
			source: { droppableId: "in_progress", index: 0 },
			destination: { droppableId: "review", index: 0 },
			mode: "SNAP",
			reason: "DROP",
			combine: null,
		});
		expect(attemptedReviewMove.moveEvent).toBeUndefined();
		expect(getTaskColumnId(attemptedReviewMove.board, taskA)).toBe("in_progress");
	});

	it("supports programmatic drag transitions between in-progress and review", () => {
		const fixture = createBacklogBoard(["Task A"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const movedToInProgress = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedToInProgress.moved).toBe(true);
		const moveToReview: ProgrammaticCardMoveInFlight = {
			taskId: taskA,
			fromColumnId: "in_progress",
			toColumnId: "review",
		};

		const movedToReview = applyDragResult(movedToInProgress.board, {
			draggableId: taskA,
			type: "CARD",
			source: { droppableId: "in_progress", index: 0 },
			destination: { droppableId: "review", index: 0 },
			mode: "SNAP",
			reason: "DROP",
			combine: null,
		}, {
			programmaticCardMoveInFlight: moveToReview,
		});
		expect(movedToReview.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "in_progress",
			toColumnId: "review",
		});
		expect(getTaskColumnId(movedToReview.board, taskA)).toBe("review");
		const moveBackToInProgress: ProgrammaticCardMoveInFlight = {
			taskId: taskA,
			fromColumnId: "review",
			toColumnId: "in_progress",
		};

		const movedBackToInProgress = applyDragResult(movedToReview.board, {
			draggableId: taskA,
			type: "CARD",
			source: { droppableId: "review", index: 0 },
			destination: { droppableId: "in_progress", index: 0 },
			mode: "SNAP",
			reason: "DROP",
			combine: null,
		}, {
			programmaticCardMoveInFlight: moveBackToInProgress,
		});
		expect(movedBackToInProgress.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "review",
			toColumnId: "in_progress",
		});
		expect(getTaskColumnId(movedBackToInProgress.board, taskA)).toBe("in_progress");
	});

	it("removes dependencies when trash is cleared", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const movedA = moveTaskToColumn(fixture.board, taskA, "review");
		expect(movedA.moved).toBe(true);

		const linked = addTaskDependency(movedA.board, taskA, taskB);
		expect(linked.added).toBe(true);
		expect(linked.board.dependencies.length).toBe(1);

		const moved = moveTaskToColumn(linked.board, taskA, "trash");
		expect(moved.moved).toBe(true);
		const cleared = clearColumnTasks(moved.board, "trash");
		expect(cleared.clearedTaskIds).toContain(taskA);
		expect(cleared.board.dependencies).toEqual([]);
	});

	it("normalizes boards and keeps valid unique links", () => {
		const rawBoard = {
			columns: [
				{
					id: "backlog",
					cards: [
						{ id: "b", prompt: "Task B", startInPlanMode: false, baseRef: "main" },
						{ id: "c", prompt: "Task C", startInPlanMode: false, baseRef: "main" },
					],
				},
				{
					id: "in_progress",
					cards: [{ id: "a", prompt: "Task A", startInPlanMode: false, baseRef: "main" }],
				},
				{ id: "review", cards: [] },
				{ id: "trash", cards: [] },
			],
			dependencies: [
				{ id: "dep-1", fromTaskId: "a", toTaskId: "b" },
				{ id: "dep-2", fromTaskId: "b", toTaskId: "a" },
				{ id: "dep-3", fromTaskId: "c", toTaskId: "a" },
				{ id: "dep-4", fromTaskId: "a", toTaskId: "b" },
				{ id: "dep-5", fromTaskId: "b", toTaskId: "c" },
				{ id: "dep-6", fromTaskId: "a", toTaskId: "missing" },
			],
		};

		const normalized = normalizeBoardData(rawBoard);
		expect(normalized).not.toBeNull();
		expect(normalized?.dependencies.map((dependency) => `${dependency.fromTaskId}->${dependency.toTaskId}`)).toEqual([
			"b->a",
			"c->a",
			"b->c",
		]);
	});
});
