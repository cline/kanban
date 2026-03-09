import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLinkedBacklogTaskActions } from "@/hooks/use-linked-backlog-task-actions";
import type { BoardCard, BoardData } from "@/types";

const trackTaskDependencyCreatedMock = vi.hoisted(() => vi.fn());

vi.mock("@/telemetry/events", () => ({
	trackTaskDependencyCreated: trackTaskDependencyCreatedMock,
}));

function createBoard(): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						prompt: "Backlog task",
						startInPlanMode: false,
						autoReviewEnabled: false,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 1,
						updatedAt: 1,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: "task-2",
						prompt: "Review task",
						startInPlanMode: false,
						autoReviewEnabled: false,
						autoReviewMode: "commit",
						baseRef: "main",
						createdAt: 2,
						updatedAt: 2,
					},
				],
			},
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

interface HookSnapshot {
	board: BoardData;
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
}

function HookHarness({ onSnapshot }: { onSnapshot: (snapshot: HookSnapshot) => void }): null {
	const [board, setBoard] = useState<BoardData>(() => createBoard());
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
		kickoffTaskInProgress: async (_task: BoardCard, _taskId: string) => true,
	});

	useEffect(() => {
		onSnapshot({
			board,
			handleCreateDependency: actions.handleCreateDependency,
		});
	}, [actions.handleCreateDependency, board, onSnapshot]);

	return null;
}

describe("useLinkedBacklogTaskActions", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		trackTaskDependencyCreatedMock.mockReset();
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
});
