import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import type { PersistPendingGitAction } from "@/hooks/use-review-auto-actions";
import { useReviewAutoActions } from "@/hooks/use-review-auto-actions";
import { normalizeBoardData } from "@/state/board-state";
import { resetWorkspaceMetadataStore, setTaskWorkspaceSnapshot } from "@/stores/workspace-metadata-store";
import type { BoardColumnId, BoardData, ReviewTaskWorkspaceSnapshot, TaskPendingGitAction } from "@/types";
import { PENDING_GIT_ACTION_STALE_AFTER_MS } from "@/types";

function createBoard(options?: {
	autoReviewEnabled?: boolean;
	pendingGitAction?: TaskPendingGitAction | null;
}): BoardData {
	const autoReviewEnabled = options?.autoReviewEnabled ?? true;
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: "task-1",
						title: "Test task",
						prompt: "Test task",
						startInPlanMode: false,
						autoReviewEnabled,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
						...(options?.pendingGitAction !== undefined ? { pendingGitAction: options.pendingGitAction } : {}),
					},
				],
			},
			{ id: "trash", title: "Done", cards: [] },
		],
		dependencies: [],
	};
}

function createSnapshot(overrides?: Partial<ReviewTaskWorkspaceSnapshot>): ReviewTaskWorkspaceSnapshot {
	return {
		taskId: "task-1",
		path: "/tmp/task-1",
		branch: "task-1",
		isDetached: false,
		headCommit: "abc123",
		changedFiles: 3,
		additions: 10,
		deletions: 2,
		...overrides,
	};
}

const workspaceSnapshots: Record<string, ReviewTaskWorkspaceSnapshot> = {
	"task-1": createSnapshot(),
};

function HookHarness({
	board,
	runAutoReviewGitAction,
	requestMoveTaskToTrash,
	persistPendingGitAction,
}: {
	board: BoardData;
	runAutoReviewGitAction: (taskId: string, action: TaskGitAction) => Promise<boolean>;
	requestMoveTaskToTrash: (taskId: string, fromColumnId: BoardColumnId) => Promise<void>;
	persistPendingGitAction?: PersistPendingGitAction;
}): null {
	setTaskWorkspaceSnapshot(workspaceSnapshots["task-1"] ?? null);
	useReviewAutoActions({
		board,
		taskGitActionLoadingByTaskId: {},
		runAutoReviewGitAction,
		requestMoveTaskToTrash,
		persistPendingGitAction,
	});
	return null;
}

describe("useReviewAutoActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
		workspaceSnapshots["task-1"] = createSnapshot();
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		resetWorkspaceMetadataStore();
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
		vi.useRealTimers();
	});

	it("cancels a scheduled auto review action when autoReviewEnabled is turned off", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToTrash = vi.fn(async () => {});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard({ autoReviewEnabled: true })}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
				/>,
			);
		});

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard({ autoReviewEnabled: false })}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
				/>,
			);
		});

		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(runAutoReviewGitAction).not.toHaveBeenCalled();
		expect(requestMoveTaskToTrash).not.toHaveBeenCalled();
	});

	it("persists the pending git action when arming and advances the card after remount once HEAD moves (issue #365)", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToTrash = vi.fn(async () => {});
		const persistPendingGitAction = vi.fn<PersistPendingGitAction>(async () => true);

		// Arm: working changes present in review.
		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard()}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
					persistPendingGitAction={persistPendingGitAction}
				/>,
			);
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(persistPendingGitAction).toHaveBeenCalledTimes(1);
		const armedValue = persistPendingGitAction.mock.calls[0]?.[1];
		expect(armedValue).toMatchObject({
			action: "commit",
			headCommitAtRequest: "abc123",
			attempt: 0,
		});
		expect(runAutoReviewGitAction).toHaveBeenCalledWith("task-1", "commit");
		if (!armedValue) {
			throw new Error("expected the hook to persist an arming value");
		}

		// Simulate the server echo landing on the board, then drop all in-memory hook
		// state by remounting (reload / project switch).
		act(() => {
			root.unmount();
		});
		root = createRoot(container);
		workspaceSnapshots["task-1"] = createSnapshot({ changedFiles: 0, headCommit: "def456" });

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard({ pendingGitAction: armedValue })}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
					persistPendingGitAction={persistPendingGitAction}
				/>,
			);
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		// HEAD moved past the commit recorded at arming time: evidence the commit landed.
		expect(requestMoveTaskToTrash).toHaveBeenCalledTimes(1);
		expect(requestMoveTaskToTrash).toHaveBeenCalledWith(
			"task-1",
			"review",
			expect.objectContaining({ skipWorkingChangeWarning: true }),
		);
		expect(persistPendingGitAction).toHaveBeenLastCalledWith("task-1", null);
		expect(runAutoReviewGitAction).toHaveBeenCalledTimes(1);
	});

	it("does not advance an armed card when the tree is clean but HEAD is unchanged", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToTrash = vi.fn(async () => {});
		const persistPendingGitAction = vi.fn<PersistPendingGitAction>(async () => true);
		const pendingGitAction: TaskPendingGitAction = {
			action: "commit",
			requestedAt: Date.now(),
			headCommitAtRequest: "abc123",
			attempt: 0,
		};
		workspaceSnapshots["task-1"] = createSnapshot({ changedFiles: 0, headCommit: "abc123" });

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard({ pendingGitAction })}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
					persistPendingGitAction={persistPendingGitAction}
				/>,
			);
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(requestMoveTaskToTrash).not.toHaveBeenCalled();
		expect(runAutoReviewGitAction).not.toHaveBeenCalled();
		expect(persistPendingGitAction).not.toHaveBeenCalledWith("task-1", null);
	});

	it("refuses to start a second git action while a recent pending action is armed", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToTrash = vi.fn(async () => {});
		const persistPendingGitAction = vi.fn<PersistPendingGitAction>(async () => true);
		const pendingGitAction: TaskPendingGitAction = {
			action: "commit",
			requestedAt: Date.now(),
			headCommitAtRequest: "abc123",
			attempt: 0,
		};
		// Working changes are present, which would normally trigger a git action.
		workspaceSnapshots["task-1"] = createSnapshot({ changedFiles: 5 });

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard({ pendingGitAction })}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
					persistPendingGitAction={persistPendingGitAction}
				/>,
			);
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(runAutoReviewGitAction).not.toHaveBeenCalled();
		expect(persistPendingGitAction).not.toHaveBeenCalled();
		expect(requestMoveTaskToTrash).not.toHaveBeenCalled();
	});

	it("clears a stale pending git action instead of leaving the card armed forever", async () => {
		const runAutoReviewGitAction = vi.fn(async () => true);
		const requestMoveTaskToTrash = vi.fn(async () => {});
		const persistPendingGitAction = vi.fn<PersistPendingGitAction>(async () => true);
		const pendingGitAction: TaskPendingGitAction = {
			action: "commit",
			requestedAt: Date.now() - PENDING_GIT_ACTION_STALE_AFTER_MS - 1000,
			headCommitAtRequest: "abc123",
			attempt: 2,
		};
		workspaceSnapshots["task-1"] = createSnapshot({ changedFiles: 5 });

		await act(async () => {
			root.render(
				<HookHarness
					board={createBoard({ pendingGitAction })}
					runAutoReviewGitAction={runAutoReviewGitAction}
					requestMoveTaskToTrash={requestMoveTaskToTrash}
					persistPendingGitAction={persistPendingGitAction}
				/>,
			);
		});
		await act(async () => {
			vi.advanceTimersByTime(1000);
		});

		expect(persistPendingGitAction).toHaveBeenCalledWith("task-1", null);
		expect(requestMoveTaskToTrash).not.toHaveBeenCalled();
		expect(runAutoReviewGitAction).not.toHaveBeenCalled();
	});

	it("parses legacy boards without pendingGitAction and keeps valid pendingGitAction values", () => {
		const legacyBoard = {
			columns: [
				{
					id: "review",
					title: "Review",
					cards: [
						{
							id: "task-legacy",
							title: "Legacy task",
							prompt: "Legacy task",
							startInPlanMode: false,
							autoReviewEnabled: true,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
						{
							id: "task-armed",
							title: "Armed task",
							prompt: "Armed task",
							startInPlanMode: false,
							autoReviewEnabled: true,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
							pendingGitAction: {
								action: "commit",
								requestedAt: 123,
								headCommitAtRequest: null,
								attempt: 1,
							},
						},
					],
				},
			],
			dependencies: [],
		};

		const normalized = normalizeBoardData(legacyBoard);
		expect(normalized).not.toBeNull();
		const reviewColumn = normalized?.columns.find((column) => column.id === "review");
		expect(reviewColumn?.cards).toHaveLength(2);
		expect(reviewColumn?.cards[0]?.pendingGitAction).toBeUndefined();
		expect(reviewColumn?.cards[1]?.pendingGitAction).toEqual({
			action: "commit",
			requestedAt: 123,
			headCommitAtRequest: null,
			attempt: 1,
		});
	});
});
