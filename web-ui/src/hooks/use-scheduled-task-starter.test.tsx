import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScheduledTaskStarter } from "@/hooks/use-scheduled-task-starter";
import type { BoardData, TaskSchedule } from "@/types";

function createEmptyBoard(): BoardData {
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

function createBoardWithScheduledTask(schedule: TaskSchedule): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						prompt: "Recurring task",
						startInPlanMode: false,
						autoReviewEnabled: false,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
						schedule,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

vi.mock("@/hooks/use-document-visibility", () => ({
	useDocumentVisibility: () => true,
}));

let container: HTMLDivElement;
let root: Root;

function HookHost({
	board,
	startBacklogTasks,
}: {
	board: BoardData;
	startBacklogTasks: (taskIds: string[]) => void;
}): null {
	useScheduledTaskStarter({ board, startBacklogTasks });
	return null;
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: false });
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => {
		root.unmount();
	});
	container.remove();
	vi.useRealTimers();
});

describe("useScheduledTaskStarter", () => {
	it("starts a task immediately when nextRunAt is in the past", () => {
		const startBacklogTasks = vi.fn();
		const board = createBoardWithScheduledTask({
			enabled: true,
			type: "recurring",
			intervalMs: 60_000,
			nextRunAt: Date.now() - 5_000,
			runCount: 1,
			lastRunAt: Date.now() - 65_000,
		});

		act(() => {
			root.render(<HookHost board={board} startBacklogTasks={startBacklogTasks} />);
		});

		expect(startBacklogTasks).toHaveBeenCalledWith(["task-1"]);
	});

	it("does not start a task when nextRunAt is in the future", () => {
		const startBacklogTasks = vi.fn();
		const board = createBoardWithScheduledTask({
			enabled: true,
			type: "recurring",
			intervalMs: 60_000,
			nextRunAt: Date.now() + 30_000,
			runCount: 1,
			lastRunAt: Date.now() - 30_000,
		});

		act(() => {
			root.render(<HookHost board={board} startBacklogTasks={startBacklogTasks} />);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();
	});

	it("starts a task when setTimeout fires at nextRunAt", () => {
		const startBacklogTasks = vi.fn();
		const futureMs = 30_000;
		const board = createBoardWithScheduledTask({
			enabled: true,
			type: "recurring",
			intervalMs: 60_000,
			nextRunAt: Date.now() + futureMs,
			runCount: 1,
			lastRunAt: Date.now() - 30_000,
		});

		act(() => {
			root.render(<HookHost board={board} startBacklogTasks={startBacklogTasks} />);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(futureMs + 1);
		});

		expect(startBacklogTasks).toHaveBeenCalledWith(["task-1"]);
	});

	it("does not auto-start a newly created scheduled task (runCount === 0)", () => {
		const startBacklogTasks = vi.fn();
		const board = createBoardWithScheduledTask({
			enabled: true,
			type: "recurring",
			intervalMs: 60_000,
			nextRunAt: Date.now() - 5_000,
			runCount: 0,
			lastRunAt: undefined,
		});

		act(() => {
			root.render(<HookHost board={board} startBacklogTasks={startBacklogTasks} />);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();

		// Even after advancing time, should not fire.
		act(() => {
			vi.advanceTimersByTime(120_000);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();
	});

	it("does not start a disabled scheduled task", () => {
		const startBacklogTasks = vi.fn();
		const board = createBoardWithScheduledTask({
			enabled: false,
			type: "recurring",
			intervalMs: 60_000,
			nextRunAt: Date.now() - 5_000,
			runCount: 1,
			lastRunAt: Date.now() - 65_000,
		});

		act(() => {
			root.render(<HookHost board={board} startBacklogTasks={startBacklogTasks} />);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();
	});

	it("does nothing with an empty board", () => {
		const startBacklogTasks = vi.fn();
		const board = createEmptyBoard();

		act(() => {
			root.render(<HookHost board={board} startBacklogTasks={startBacklogTasks} />);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();

		act(() => {
			vi.advanceTimersByTime(120_000);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();
	});

	it("cancels the previous timer when the board changes", () => {
		const startBacklogTasks = vi.fn();
		const board1 = createBoardWithScheduledTask({
			enabled: true,
			type: "recurring",
			intervalMs: 60_000,
			nextRunAt: Date.now() + 30_000,
			runCount: 1,
			lastRunAt: Date.now() - 30_000,
		});

		act(() => {
			root.render(<HookHost board={board1} startBacklogTasks={startBacklogTasks} />);
		});

		// Re-render with empty board (task removed).
		const board2 = createEmptyBoard();
		act(() => {
			root.render(<HookHost board={board2} startBacklogTasks={startBacklogTasks} />);
		});

		// Advance past the original timer — should NOT fire since board changed.
		act(() => {
			vi.advanceTimersByTime(35_000);
		});

		expect(startBacklogTasks).not.toHaveBeenCalled();
	});
});
