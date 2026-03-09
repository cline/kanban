import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkedBacklogTaskActions } from "@/hooks/use-linked-backlog-task-actions";
import type { BoardCard, BoardData, BoardDependency } from "@/types";

const trackTaskDependencyCreatedMock = vi.hoisted(() => vi.fn());
const trackTasksAutoStartedFromDependencyMock = vi.hoisted(() => vi.fn());

vi.mock("@/telemetry/events", () => ({
	trackTaskDependencyCreated: trackTaskDependencyCreatedMock,
	trackTasksAutoStartedFromDependency: trackTasksAutoStartedFromDependencyMock,
}));

function createTask(taskId: string, prompt: string, createdAt: number): BoardCard {
	return {
		id: taskId,
		prompt,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt,
		updatedAt: createdAt,
	};
}

function createBoard(dependencies: BoardDependency[] = []): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [createTask("task-1", "Backlog task", 1), createTask("task-3", "Second backlog task", 3)],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [createTask("task-2", "Review task", 2)],
			},
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies,
	};
}

interface HookSnapshot {
	board: BoardData;
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function HookHarness({
	boardFactory,
	onSnapshot,
	kickoffTaskInProgress,
}: {
	boardFactory?: () => BoardData;
	onSnapshot: (snapshot: HookSnapshot) => void;
	kickoffTaskInProgress?: (
		task: BoardCard,
		taskId: string,
		fromColumnId: "backlog" | "in_progress" | "review" | "trash",
		options?: { optimisticMove?: boolean },
	) => Promise<boolean>;
}): null {
	const [board, setBoard] = useState<BoardData>(() => (boardFactory ? boardFactory() : createBoard()));
	const actions = useLinkedBacklogTaskActions({
		board,
		setBoard,
		selectedTaskWorkspaceInfo: null,
		setSelectedTaskId: () => {},
		setPendingTrashWarning: () => {},
		stopTaskSession: async () => {},
		cleanupTaskWorkspace: async () => null,
		fetchTaskWorkingChangeCount: async () => null,
		fetchTaskWorkspaceInfo: async () => null,
		maybeRequestNotificationPermissionForTaskStart: () => {},
		kickoffTaskInProgress: kickoffTaskInProgress ?? (async (_task: BoardCard, _taskId: string) => true),
	});

	useEffect(() => {
		onSnapshot({
			board,
			handleCreateDependency: actions.handleCreateDependency,
			confirmMoveTaskToTrash: actions.confirmMoveTaskToTrash,
		});
	}, [actions.confirmMoveTaskToTrash, actions.handleCreateDependency, board, onSnapshot]);

	return null;
}

describe("useLinkedBacklogTaskActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		trackTaskDependencyCreatedMock.mockReset();
		trackTasksAutoStartedFromDependencyMock.mockReset();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("tracks dependency creation after a valid link is added", async () => {
		let latestSnapshot: HookSnapshot | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;

		await act(async () => {
			initialSnapshot.handleCreateDependency("task-1", "task-2");
		});

		if (latestSnapshot === null) {
			throw new Error("Expected an updated hook snapshot.");
		}
		const snapshot = latestSnapshot as HookSnapshot;

		expect(trackTaskDependencyCreatedMock).toHaveBeenCalledTimes(1);
		expect(snapshot.board.dependencies).toHaveLength(1);
		expect(snapshot.board.dependencies[0]).toMatchObject({
			fromTaskId: "task-1",
			toTaskId: "task-2",
		});
	});

	it("tracks how many linked tasks were auto-started when a parent task is trashed", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const kickoffTaskInProgress = vi.fn(async () => true);
		const boardFactory = () =>
			createBoard([
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		await act(async () => {
			await initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
		});

		expect(kickoffTaskInProgress).toHaveBeenCalledTimes(2);
		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(2);
	});

	it("starts dependency-unblocked tasks one-at-a-time to avoid concurrent kickoff races", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const firstKickoff = createDeferred<boolean>();
		const secondKickoff = createDeferred<boolean>();
		const kickoffTaskInProgress = vi.fn((task: BoardCard) => {
			if (task.id === "task-1") {
				return firstKickoff.promise;
			}
			return secondKickoff.promise;
		});
		const boardFactory = () =>
			createBoard([
				{ id: "dep-1", fromTaskId: "task-1", toTaskId: "task-2", createdAt: 10 },
				{ id: "dep-2", fromTaskId: "task-3", toTaskId: "task-2", createdAt: 11 },
			]);

		await act(async () => {
			root.render(
				<HookHarness
					boardFactory={boardFactory}
					kickoffTaskInProgress={kickoffTaskInProgress}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const initialSnapshot = latestSnapshot as HookSnapshot;
		const reviewTask = initialSnapshot.board.columns.find((column) => column.id === "review")?.cards[0];
		if (!reviewTask) {
			throw new Error("Expected a review task.");
		}

		let movePromise: Promise<void> | null = null;
		await act(async () => {
			movePromise = initialSnapshot.confirmMoveTaskToTrash(reviewTask, initialSnapshot.board);
			await Promise.resolve();
		});

		expect(kickoffTaskInProgress).toHaveBeenCalledTimes(1);
		expect(kickoffTaskInProgress.mock.calls[0]?.[0]).toMatchObject({ id: "task-1" });

		await act(async () => {
			firstKickoff.resolve(true);
			await Promise.resolve();
		});

		expect(kickoffTaskInProgress).toHaveBeenCalledTimes(2);
		expect(kickoffTaskInProgress.mock.calls[1]?.[0]).toMatchObject({ id: "task-3" });

		await act(async () => {
			secondKickoff.resolve(true);
			await movePromise;
		});

		expect(trackTasksAutoStartedFromDependencyMock).toHaveBeenCalledWith(2);
	});
});
