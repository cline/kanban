import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeWorkspaceChangesResponse } from "@/runtime/types";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";

const getChangesQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: {
			getChanges: {
				query: getChangesQueryMock,
			},
		},
	}),
}));

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return { promise, resolve, reject };
}

function createWorkspaceChangesResponse(path: string): RuntimeWorkspaceChangesResponse {
	return {
		repoRoot: "/tmp/project",
		generatedAt: Date.now(),
		files: [
			{
				path,
				status: "modified",
				additions: 3,
				deletions: 1,
				oldText: "old line\n",
				newText: "new line\n",
			},
		],
	};
}

interface HookSnapshot {
	paths: string[];
	isLoading: boolean;
	isRuntimeAvailable: boolean;
}

function HookHarness({
	taskId,
	viewKey = null,
	clearOnViewTransition = true,
	onSnapshot,
}: {
	taskId: string;
	viewKey?: string | null;
	clearOnViewTransition?: boolean;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const workspaceChanges = useRuntimeWorkspaceChanges(
		taskId,
		"project-1",
		"main",
		"working_copy",
		0,
		null,
		viewKey,
		clearOnViewTransition,
	);

	useEffect(() => {
		onSnapshot({
			paths: workspaceChanges.changes?.files.map((file) => file.path) ?? [],
			isLoading: workspaceChanges.isLoading,
			isRuntimeAvailable: workspaceChanges.isRuntimeAvailable,
		});
	}, [onSnapshot, workspaceChanges.changes, workspaceChanges.isLoading, workspaceChanges.isRuntimeAvailable]);

	return null;
}

describe("useRuntimeWorkspaceChanges", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		getChangesQueryMock.mockReset();
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

	it("clears the previous task diff immediately when switching tasks", async () => {
		const taskBDiffDeferred = createDeferred<RuntimeWorkspaceChangesResponse>();
		getChangesQueryMock.mockResolvedValueOnce(createWorkspaceChangesResponse("task-a.ts"));
		getChangesQueryMock.mockImplementationOnce(() => taskBDiffDeferred.promise);

		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					onSnapshot={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["task-a.ts"],
			isLoading: false,
			isRuntimeAvailable: true,
		});

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-b"
					onSnapshot={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: [],
			isLoading: true,
			isRuntimeAvailable: true,
		});

		await act(async () => {
			taskBDiffDeferred.resolve(createWorkspaceChangesResponse("task-b.ts"));
			await taskBDiffDeferred.promise;
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["task-b.ts"],
			isLoading: false,
			isRuntimeAvailable: true,
		});
	});

	it("clears the previous diff immediately when the last-turn view key changes", async () => {
		const nextTurnDiffDeferred = createDeferred<RuntimeWorkspaceChangesResponse>();
		getChangesQueryMock.mockResolvedValueOnce(createWorkspaceChangesResponse("turn-1.ts"));
		getChangesQueryMock.mockImplementationOnce(() => nextTurnDiffDeferred.promise);

		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					viewKey="awaiting_review:checkpoint-2:checkpoint-1"
					onSnapshot={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["turn-1.ts"],
			isLoading: false,
			isRuntimeAvailable: true,
		});

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					viewKey="running:checkpoint-2:checkpoint-1"
					onSnapshot={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: [],
			isLoading: true,
			isRuntimeAvailable: true,
		});

		await act(async () => {
			nextTurnDiffDeferred.resolve(createWorkspaceChangesResponse("turn-2.ts"));
			await nextTurnDiffDeferred.promise;
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["turn-2.ts"],
			isLoading: false,
			isRuntimeAvailable: true,
		});
	});

	it("keeps the previous diff visible during a view-key transition when requested", async () => {
		const nextTurnDiffDeferred = createDeferred<RuntimeWorkspaceChangesResponse>();
		getChangesQueryMock.mockResolvedValueOnce(createWorkspaceChangesResponse("turn-1.ts"));
		getChangesQueryMock.mockImplementationOnce(() => nextTurnDiffDeferred.promise);

		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					viewKey="running:checkpoint-1:none"
					clearOnViewTransition={false}
					onSnapshot={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["turn-1.ts"],
			isLoading: false,
			isRuntimeAvailable: true,
		});

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-a"
					viewKey="awaiting_review:checkpoint-2:checkpoint-1"
					clearOnViewTransition={false}
					onSnapshot={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["turn-1.ts"],
			isLoading: true,
			isRuntimeAvailable: true,
		});

		await act(async () => {
			nextTurnDiffDeferred.resolve(createWorkspaceChangesResponse("turn-2.ts"));
			await nextTurnDiffDeferred.promise;
		});

		expect(snapshots.at(-1)).toMatchObject({
			paths: ["turn-2.ts"],
			isLoading: false,
			isRuntimeAvailable: true,
		});
	});
});
