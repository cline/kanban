import { afterEach, describe, expect, it, vi } from "vitest";

import { createInitialBoardData } from "@/data/board-data";
import {
	addTaskDependency,
	addTaskToColumn,
	applyDragResult,
	clearColumnTasks,
	disableTaskAutoReview,
	getTaskColumnId,
	moveTaskToColumn,
	normalizeBoardData,
	trashTaskAndGetReadyLinkedTaskIds,
} from "@/state/board-state";
import type { ProgrammaticCardMoveInFlight } from "@/state/drag-rules";

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

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("board dependency state", () => {
	it("creates tasks when randomUUID is unavailable", () => {
		vi.stubGlobal("crypto", { randomUUID: undefined });

		const board = addTaskToColumn(createInitialBoardData(), "backlog", {
			prompt: "Task A",
			baseRef: "main",
		});
		const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards ?? [];

		expect(backlogCards).toHaveLength(1);
		expect(backlogCards[0]?.id).toHaveLength(5);
	});
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

	it("preserves backlog-to-backlog link order and reorients it when one task starts", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");

		const bothBacklog = addTaskDependency(fixture.board, taskA, taskB);
		expect(bothBacklog.added).toBe(true);
		expect(bothBacklog.dependency).toMatchObject({
			fromTaskId: taskA,
			toTaskId: taskB,
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

	it("allows backlog-to-backlog links in either direction", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");

		const firstDirection = addTaskDependency(fixture.board, taskA, taskB);
		expect(firstDirection.added).toBe(true);
		const reverseDirection = addTaskDependency(firstDirection.board, taskB, taskA);
		expect(reverseDirection.added).toBe(true);
		expect(reverseDirection.board.dependencies).toEqual([
			expect.objectContaining({ fromTaskId: taskA, toTaskId: taskB }),
			expect.objectContaining({ fromTaskId: taskB, toTaskId: taskA }),
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

	it("preserves manual backlog to in-progress drop positions", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");

		const movedB = moveTaskToColumn(fixture.board, taskB, "in_progress");
		expect(movedB.moved).toBe(true);
		const movedC = moveTaskToColumn(movedB.board, taskC, "in_progress");
		expect(movedC.moved).toBe(true);

		const movedA = applyDragResult(movedC.board, {
			draggableId: taskA,
			type: "CARD",
			source: { droppableId: "backlog", index: 0 },
			destination: { droppableId: "in_progress", index: 2 },
			mode: "SNAP",
			reason: "DROP",
			combine: null,
		});
		expect(movedA.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "backlog",
			toColumnId: "in_progress",
		});
		const inProgressColumn = movedA.board.columns.find((column) => column.id === "in_progress");
		expect(inProgressColumn?.cards.map((card) => card.id)).toEqual([taskB, taskC, taskA]);
	});

	it("inserts programmatic backlog to in-progress moves at the top", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");

		const movedB = moveTaskToColumn(fixture.board, taskB, "in_progress");
		expect(movedB.moved).toBe(true);
		const movedC = moveTaskToColumn(movedB.board, taskC, "in_progress");
		expect(movedC.moved).toBe(true);

		const movedA = applyDragResult(
			movedC.board,
			{
				draggableId: taskA,
				type: "CARD",
				source: { droppableId: "backlog", index: 0 },
				destination: { droppableId: "in_progress", index: 2 },
				mode: "SNAP",
				reason: "DROP",
				combine: null,
			},
			{
				programmaticCardMoveInFlight: {
					taskId: taskA,
					fromColumnId: "backlog",
					toColumnId: "in_progress",
					insertAtTop: true,
				},
			},
		);
		expect(movedA.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "backlog",
			toColumnId: "in_progress",
		});
		const inProgressColumn = movedA.board.columns.find((column) => column.id === "in_progress");
		expect(inProgressColumn?.cards.map((card) => card.id)).toEqual([taskA, taskB, taskC]);
	});

	it("supports programmatic drag transitions between in-progress and review", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");
		const movedToInProgress = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedToInProgress.moved).toBe(true);
		const movedBToReview = moveTaskToColumn(movedToInProgress.board, taskB, "review");
		expect(movedBToReview.moved).toBe(true);
		const movedCToInProgress = moveTaskToColumn(movedBToReview.board, taskC, "in_progress");
		expect(movedCToInProgress.moved).toBe(true);
		const moveToReview: ProgrammaticCardMoveInFlight = {
			taskId: taskA,
			fromColumnId: "in_progress",
			toColumnId: "review",
			insertAtTop: true,
		};

		const movedToReview = applyDragResult(
			movedCToInProgress.board,
			{
				draggableId: taskA,
				type: "CARD",
				source: { droppableId: "in_progress", index: 0 },
				destination: { droppableId: "review", index: 1 },
				mode: "SNAP",
				reason: "DROP",
				combine: null,
			},
			{
				programmaticCardMoveInFlight: moveToReview,
			},
		);
		expect(movedToReview.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "in_progress",
			toColumnId: "review",
		});
		expect(getTaskColumnId(movedToReview.board, taskA)).toBe("review");
		const reviewColumn = movedToReview.board.columns.find((column) => column.id === "review");
		expect(reviewColumn?.cards.map((card) => card.id)).toEqual([taskA, taskB]);
		const moveBackToInProgress: ProgrammaticCardMoveInFlight = {
			taskId: taskA,
			fromColumnId: "review",
			toColumnId: "in_progress",
			insertAtTop: true,
		};

		const movedBackToInProgress = applyDragResult(
			movedToReview.board,
			{
				draggableId: taskA,
				type: "CARD",
				source: { droppableId: "review", index: 0 },
				destination: { droppableId: "in_progress", index: 2 },
				mode: "SNAP",
				reason: "DROP",
				combine: null,
			},
			{
				programmaticCardMoveInFlight: moveBackToInProgress,
			},
		);
		expect(movedBackToInProgress.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "review",
			toColumnId: "in_progress",
		});
		expect(getTaskColumnId(movedBackToInProgress.board, taskA)).toBe("in_progress");
		const inProgressColumn = movedBackToInProgress.board.columns.find((column) => column.id === "in_progress");
		expect(inProgressColumn?.cards.map((card) => card.id)).toEqual([taskA, taskC]);
	});

	it("preserves manual cross-column trash drop positions", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");

		const movedAToTrash = moveTaskToColumn(fixture.board, taskA, "trash");
		expect(movedAToTrash.moved).toBe(true);
		const movedBToTrash = moveTaskToColumn(movedAToTrash.board, taskB, "trash");
		expect(movedBToTrash.moved).toBe(true);
		const movedCToReview = moveTaskToColumn(movedBToTrash.board, taskC, "review");
		expect(movedCToReview.moved).toBe(true);

		const movedToTrash = applyDragResult(movedCToReview.board, {
			draggableId: taskC,
			type: "CARD",
			source: { droppableId: "review", index: 0 },
			destination: { droppableId: "trash", index: 2 },
			mode: "SNAP",
			reason: "DROP",
			combine: null,
		});
		expect(movedToTrash.moveEvent).toMatchObject({
			taskId: taskC,
			fromColumnId: "review",
			toColumnId: "trash",
		});
		const trashColumn = movedToTrash.board.columns.find((column) => column.id === "trash");
		expect(trashColumn?.cards.map((card) => card.id)).toEqual([taskB, taskA, taskC]);
	});

	it("allows manual trash to review drags", () => {
		const fixture = createBacklogBoard(["Task A", "Task B"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");

		const movedAToTrash = moveTaskToColumn(fixture.board, taskA, "trash");
		expect(movedAToTrash.moved).toBe(true);
		const movedBToReview = moveTaskToColumn(movedAToTrash.board, taskB, "review");
		expect(movedBToReview.moved).toBe(true);

		const movedToReview = applyDragResult(movedBToReview.board, {
			draggableId: taskA,
			type: "CARD",
			source: { droppableId: "trash", index: 0 },
			destination: { droppableId: "review", index: 1 },
			mode: "SNAP",
			reason: "DROP",
			combine: null,
		});
		expect(movedToReview.moveEvent).toMatchObject({
			taskId: taskA,
			fromColumnId: "trash",
			toColumnId: "review",
		});
		expect(getTaskColumnId(movedToReview.board, taskA)).toBe("review");
		const reviewColumn = movedToReview.board.columns.find((column) => column.id === "review");
		expect(reviewColumn?.cards.map((card) => card.id)).toEqual([taskB, taskA]);
	});

	it("inserts programmatic trash drags at the top of trash", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");

		const movedAToTrash = moveTaskToColumn(fixture.board, taskA, "trash");
		expect(movedAToTrash.moved).toBe(true);
		const movedBToTrash = moveTaskToColumn(movedAToTrash.board, taskB, "trash");
		expect(movedBToTrash.moved).toBe(true);
		const movedCToReview = moveTaskToColumn(movedBToTrash.board, taskC, "review");
		expect(movedCToReview.moved).toBe(true);

		const movedToTrash = applyDragResult(
			movedCToReview.board,
			{
				draggableId: taskC,
				type: "CARD",
				source: { droppableId: "review", index: 0 },
				destination: { droppableId: "trash", index: 2 },
				mode: "SNAP",
				reason: "DROP",
				combine: null,
			},
			{
				programmaticCardMoveInFlight: {
					taskId: taskC,
					fromColumnId: "review",
					toColumnId: "trash",
					insertAtTop: true,
				},
			},
		);
		expect(movedToTrash.moveEvent).toMatchObject({
			taskId: taskC,
			fromColumnId: "review",
			toColumnId: "trash",
		});
		const trashColumn = movedToTrash.board.columns.find((column) => column.id === "trash");
		expect(trashColumn?.cards.map((card) => card.id)).toEqual([taskC, taskB, taskA]);
	});

	it("can insert moved cards at the top when requested", () => {
		const fixture = createBacklogBoard(["Task A", "Task B", "Task C"]);
		const taskA = requireTaskId(fixture.taskIdByPrompt["Task A"], "Task A");
		const taskB = requireTaskId(fixture.taskIdByPrompt["Task B"], "Task B");
		const taskC = requireTaskId(fixture.taskIdByPrompt["Task C"], "Task C");

		const movedA = moveTaskToColumn(fixture.board, taskA, "in_progress");
		expect(movedA.moved).toBe(true);
		const movedB = moveTaskToColumn(movedA.board, taskB, "in_progress");
		expect(movedB.moved).toBe(true);
		const movedC = moveTaskToColumn(movedB.board, taskC, "in_progress", {
			insertAtTop: true,
		});
		expect(movedC.moved).toBe(true);
		const inProgressColumn = movedC.board.columns.find((column) => column.id === "in_progress");
		expect(inProgressColumn?.cards.map((card) => card.id)).toEqual([taskC, taskA, taskB]);
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

	it("disables auto-review settings for a task", () => {
		let board = createInitialBoardData();
		board = addTaskToColumn(board, "review", {
			prompt: "Task A",
			autoReviewEnabled: true,
			autoReviewMode: "move_to_trash",
			baseRef: "main",
		});
		const task = board.columns.find((column) => column.id === "review")?.cards[0];
		expect(task).toBeDefined();
		if (!task) {
			throw new Error("Expected review task to exist");
		}

		const disabled = disableTaskAutoReview(board, task.id);
		expect(disabled.updated).toBe(true);

		const updatedTask = disabled.board.columns.find((column) => column.id === "review")?.cards[0];
		expect(updatedTask?.autoReviewEnabled).toBe(false);
		expect(updatedTask?.autoReviewMode).toBe("commit");
	});
});
