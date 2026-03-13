import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGitHistoryData } from "@/components/git-history/use-git-history-data";
import type {
	RuntimeGitCommitDiffResponse,
	RuntimeGitLogResponse,
	RuntimeGitRefsResponse,
	RuntimeGitSyncSummary,
	RuntimeWorkspaceChangesResponse,
} from "@/runtime/types";

const getGitRefsQueryMock = vi.hoisted(() => vi.fn());
const getGitLogQueryMock = vi.hoisted(() => vi.fn());
const getCommitDiffQueryMock = vi.hoisted(() => vi.fn());
const getChangesQueryMock = vi.hoisted(() => vi.fn());
const getWorkspaceChangesQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: () => ({
		workspace: {
			getGitRefs: {
				query: getGitRefsQueryMock,
			},
			getGitLog: {
				query: getGitLogQueryMock,
			},
			getCommitDiff: {
				query: getCommitDiffQueryMock,
			},
			getChanges: {
				query: getChangesQueryMock,
			},
			getWorkspaceChanges: {
				query: getWorkspaceChangesQueryMock,
			},
		},
	}),
}));

interface HookSnapshot {
	refs: string[];
	activeRefName: string | null;
	commits: string[];
	selectedCommitHash: string | null;
	isRefsLoading: boolean;
	isLogLoading: boolean;
	isDiffLoading: boolean;
}

function createGitSummary(branch: string): RuntimeGitSyncSummary {
	return {
		currentBranch: branch,
		upstreamBranch: `origin/${branch}`,
		changedFiles: 0,
		additions: 0,
		deletions: 0,
		aheadCount: 0,
		behindCount: 0,
	};
}

function createRefsResponse(branch: string, hash: string): RuntimeGitRefsResponse {
	return {
		ok: true,
		refs: [
			{
				name: branch,
				type: "branch",
				hash,
				isHead: true,
				ahead: 0,
				behind: 0,
			},
		],
	};
}

function createLogResponse(hash: string, message: string): RuntimeGitLogResponse {
	return {
		ok: true,
		totalCount: 1,
		commits: [
			{
				hash,
				shortHash: hash.slice(0, 8),
				authorName: "Test User",
				authorEmail: "test@example.com",
				date: "2026-03-12T00:00:00.000Z",
				message,
				parentHashes: [],
			},
		],
	};
}

function createDiffResponse(hash: string): RuntimeGitCommitDiffResponse {
	return {
		ok: true,
		commitHash: hash,
		files: [],
	};
}

function createWorkspaceChangesResponse(): RuntimeWorkspaceChangesResponse {
	return {
		repoRoot: "/tmp/project",
		generatedAt: Date.now(),
		files: [],
	};
}

async function flushPromises(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function HookHarness({
	taskScope,
	onRender,
}: {
	taskScope: { taskId: string; baseRef: string } | null;
	onRender: (snapshot: HookSnapshot) => void;
}): null {
	const gitHistory = useGitHistoryData({
		workspaceId: "project-1",
		taskScope,
		gitSummary: createGitSummary(taskScope ? "task-branch" : "main"),
		enabled: true,
	});

	onRender({
		refs: gitHistory.refs.map((ref) => ref.name),
		activeRefName: gitHistory.activeRef?.name ?? null,
		commits: gitHistory.commits.map((commit) => commit.hash),
		selectedCommitHash: gitHistory.selectedCommitHash,
		isRefsLoading: gitHistory.isRefsLoading,
		isLogLoading: gitHistory.isLogLoading,
		isDiffLoading: gitHistory.isDiffLoading,
	});

	return null;
}

describe("useGitHistoryData", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		getGitRefsQueryMock.mockReset();
		getGitLogQueryMock.mockReset();
		getCommitDiffQueryMock.mockReset();
		getChangesQueryMock.mockReset();
		getWorkspaceChangesQueryMock.mockReset();

		getGitRefsQueryMock.mockImplementation(async (taskScope: { taskId: string; baseRef: string } | null) =>
			taskScope ? createRefsResponse("task-branch", "taskhash1") : createRefsResponse("main", "homehash1"),
		);
		getGitLogQueryMock.mockImplementation(
			async ({ taskScope }: { taskScope?: { taskId: string; baseRef: string } | null }) =>
				taskScope ? createLogResponse("taskhash1", "Task commit") : createLogResponse("homehash1", "Home commit"),
		);
		getCommitDiffQueryMock.mockImplementation(async ({ commitHash }: { commitHash: string }) =>
			createDiffResponse(commitHash),
		);
		getChangesQueryMock.mockImplementation(async () => createWorkspaceChangesResponse());
		getWorkspaceChangesQueryMock.mockImplementation(async () => createWorkspaceChangesResponse());

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

	it("does not expose home git history data during a task scope transition", async () => {
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		const settledHomeSnapshot = snapshots.at(-1);
		expect(settledHomeSnapshot).toMatchObject({
			refs: ["main"],
			activeRefName: "main",
			commits: ["homehash1"],
		});

		const firstTaskScopeSnapshotIndex = snapshots.length;
		await act(async () => {
			root.render(
				<HookHarness
					taskScope={{
						taskId: "task-1",
						baseRef: "main",
					}}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
			await flushPromises();
		});

		const transitionSnapshot = snapshots[firstTaskScopeSnapshotIndex];
		expect(transitionSnapshot).toMatchObject({
			refs: [],
			activeRefName: null,
			commits: [],
			selectedCommitHash: null,
			isRefsLoading: true,
			isLogLoading: true,
			isDiffLoading: true,
		});
	});

	it("reports loading on the first render before git history queries resolve", async () => {
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskScope={null}
					onRender={(snapshot) => {
						snapshots.push(snapshot);
					}}
				/>,
			);
		});

		const firstSnapshot = snapshots[0];
		expect(firstSnapshot).toMatchObject({
			refs: [],
			activeRefName: null,
			commits: [],
			selectedCommitHash: null,
			isRefsLoading: true,
			isLogLoading: true,
			isDiffLoading: true,
		});
	});
});
