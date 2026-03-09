import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { createInitialBoardData } from "@/data/board-data";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "@/runtime/types";
import type { BoardData } from "@/types";

const fetchWorkspaceStateMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/workspace-state-query", () => ({
	fetchWorkspaceState: fetchWorkspaceStateMock,
}));

function createBoard(taskId: string): BoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: taskId,
						prompt: `Prompt ${taskId}`,
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
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createWorkspaceState(taskId: string, revision: number): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/tmp/project-a",
		statePath: "/tmp/project-a/.kanban",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board: createBoard(taskId),
		sessions: {},
		revision,
	};
}

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

interface HookSnapshot {
	board: BoardData;
	canPersistWorkspaceState: boolean;
	refreshWorkspaceState: () => Promise<void>;
	resetWorkspaceSyncState: () => void;
}

function HookHarness({
	streamedWorkspaceState,
	onSnapshot,
}: {
	streamedWorkspaceState: RuntimeWorkspaceStateResponse | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const { refreshWorkspaceState, resetWorkspaceSyncState } = useWorkspaceSync({
		currentProjectId: "project-a",
		streamedWorkspaceState,
		hasNoProjects: false,
		isDocumentVisible: false,
		setBoard,
		setSessions,
		resetWorkspaceSnapshots: () => {},
		setCanPersistWorkspaceState,
		onWorktreeError: () => {},
	});

	useEffect(() => {
		onSnapshot({
			board,
			canPersistWorkspaceState,
			refreshWorkspaceState,
			resetWorkspaceSyncState,
		});
	}, [board, canPersistWorkspaceState, onSnapshot, refreshWorkspaceState, resetWorkspaceSyncState]);

	return null;
}

describe("useWorkspaceSync", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		fetchWorkspaceStateMock.mockReset();
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

	it("ignores a stale refresh response after the sync state is reset during a project transition", async () => {
		const deferred = createDeferred<RuntimeWorkspaceStateResponse>();
		fetchWorkspaceStateMock.mockReturnValue(deferred.promise);

		let latestSnapshot: HookSnapshot | null = null;
		let refreshPromise: Promise<void> | null = null;

		await act(async () => {
			root.render(
				<HookHarness
					streamedWorkspaceState={createWorkspaceState("persisted-task", 1)}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		if (latestSnapshot === null) {
			throw new Error("Expected an initial hook snapshot.");
		}
		const initialSnapshot: HookSnapshot = latestSnapshot;
		expect(initialSnapshot.board.columns[0]?.cards[0]?.id).toBe("persisted-task");
		expect(initialSnapshot.canPersistWorkspaceState).toBe(true);

		await act(async () => {
			refreshPromise = initialSnapshot.refreshWorkspaceState();
		});

		await act(async () => {
			initialSnapshot.resetWorkspaceSyncState();
		});

		await act(async () => {
			deferred.resolve(createWorkspaceState("stale-task", 1));
			await refreshPromise;
		});

		if (latestSnapshot === null) {
			throw new Error("Expected a hook snapshot.");
		}
		const snapshot: HookSnapshot = latestSnapshot;
		expect(snapshot.board.columns[0]?.cards[0]?.id).toBe("persisted-task");
		expect(snapshot.board.columns[0]?.cards[0]?.id).not.toBe("stale-task");
	});
});
