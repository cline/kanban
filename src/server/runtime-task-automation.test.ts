import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { createRuntimeTaskAutomation } from "./runtime-task-automation";
import { createRuntimeTaskGitActionCoordinator } from "./runtime-task-git-actions";

const createTrpcProxyClientMock = vi.hoisted(() => vi.fn());
const httpBatchLinkMock = vi.hoisted(() => vi.fn(() => ({})));
const loadWorkspaceStateMock = vi.hoisted(() => vi.fn());
const mutateWorkspaceStateMock = vi.hoisted(() => vi.fn());
const resolveTaskCwdMock = vi.hoisted(() => vi.fn());
const getGitSyncSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("@trpc/client", () => ({
	createTRPCProxyClient: createTrpcProxyClientMock,
	httpBatchLink: httpBatchLinkMock,
}));

vi.mock("../state/workspace-state", () => ({
	loadWorkspaceState: loadWorkspaceStateMock,
	mutateWorkspaceState: mutateWorkspaceStateMock,
}));

vi.mock("../workspace/task-worktree", () => ({
	resolveTaskCwd: resolveTaskCwdMock,
}));

vi.mock("../workspace/git-sync", () => ({
	getGitSyncSummary: getGitSyncSummaryMock,
}));

interface SummaryEmitter {
	emitSummary: (summary: RuntimeTaskSessionSummary) => void;
}

/**
 * Flushes pending promise callbacks between timer advances so the automation loop can settle.
 */
async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

/**
 * Creates a task-session summary fixture with predictable defaults for automation tests.
 */
function createSummary(taskId: string, overrides: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		mode: null,
		agentId: "codex",
		workspacePath: "/repo",
		pid: 123,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

/**
 * Returns a board column by id and fails loudly if the fixture shape changes unexpectedly.
 */
function getBoardColumn(state: RuntimeWorkspaceStateResponse, columnId: string) {
	const column = state.board.columns.find((candidate) => candidate.id === columnId);
	if (!column) {
		throw new Error(`Expected board column "${columnId}" to exist.`);
	}
	return column;
}

/**
 * Creates a minimal workspace state fixture with standard Kanban columns.
 */
function createWorkspaceState(): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/repo",
		statePath: "/repo/.state",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board: {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [
						{
							id: "task-2",
							prompt: "Follow-up task",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 2,
							updatedAt: 2,
						},
					],
				},
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "task-1",
							prompt: "Primary task",
							startInPlanMode: false,
							autoReviewEnabled: true,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{
					id: "review",
					title: "Review",
					cards: [],
				},
				{
					id: "trash",
					title: "Trash",
					cards: [],
				},
			],
			dependencies: [
				{
					id: "dep-1",
					fromTaskId: "task-2",
					toTaskId: "task-1",
					createdAt: 10,
				},
			],
		},
		sessions: {},
		revision: 1,
	};
}

/**
 * Creates a fake terminal manager with summary listeners that the automation controller can subscribe to.
 */
function createTerminalManager(initialSummaries: RuntimeTaskSessionSummary[]): {
	manager: {
		hasActiveTaskSession: (taskId: string) => boolean;
		listSummaries: () => RuntimeTaskSessionSummary[];
		onSummary: (listener: (summary: RuntimeTaskSessionSummary) => void) => () => void;
	};
	emitter: SummaryEmitter;
} {
	let summaries = [...initialSummaries];
	const listeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();
	return {
		manager: {
			hasActiveTaskSession: (taskId) => summaries.some((summary) => summary.taskId === taskId),
			listSummaries: () => [...summaries],
			onSummary: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		emitter: {
			emitSummary: (summary) => {
				summaries = [...summaries.filter((candidate) => candidate.taskId !== summary.taskId), summary];
				for (const listener of listeners) {
					listener(summary);
				}
			},
		},
	};
}

/**
 * Creates a fake Cline service with the subset of summary APIs used by the automation controller.
 */
function createClineService(initialSummaries: RuntimeTaskSessionSummary[]): {
	service: Pick<ClineTaskSessionService, "listSummaries" | "onSummary">;
	emitter: SummaryEmitter;
} {
	let summaries = [...initialSummaries];
	const listeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();
	return {
		service: {
			listSummaries: () => [...summaries],
			onSummary: (listener) => {
				listeners.add(listener);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		emitter: {
			emitSummary: (summary) => {
				summaries = [...summaries.filter((candidate) => candidate.taskId !== summary.taskId), summary];
				for (const listener of listeners) {
					listener(summary);
				}
			},
		},
	};
}

describe("createRuntimeTaskAutomation", () => {
	let workspaceState: RuntimeWorkspaceStateResponse;
	let runtimeClient: {
		runtime: {
			runTaskGitAction: { mutate: ReturnType<typeof vi.fn> };
			startTaskSession: { mutate: ReturnType<typeof vi.fn> };
			stopTaskSession: { mutate: ReturnType<typeof vi.fn> };
		};
		workspace: {
			ensureWorktree: { mutate: ReturnType<typeof vi.fn> };
			deleteWorktree: { mutate: ReturnType<typeof vi.fn> };
			notifyStateUpdated: { mutate: ReturnType<typeof vi.fn> };
		};
	};
	let changedFilesByTaskPath: Record<string, number>;
	let taskGitActionCoordinator: ReturnType<typeof createRuntimeTaskGitActionCoordinator>;

	beforeEach(() => {
		vi.useFakeTimers();
		workspaceState = createWorkspaceState();
		changedFilesByTaskPath = {
			"/repo/task-1": 2,
			"/repo/task-2": 0,
		};
		taskGitActionCoordinator = createRuntimeTaskGitActionCoordinator();
		runtimeClient = {
			runtime: {
				runTaskGitAction: {
					mutate: vi.fn(async ({ taskId, action, source }) => {
						const started = taskGitActionCoordinator.beginTaskGitAction("workspace-1", taskId, action);
						if (!started) {
							return {
								ok: false,
								summary: null,
								error: "Task git action already pending.",
							};
						}
						taskGitActionCoordinator.completeTaskGitAction("workspace-1", taskId, action, {
							dispatched: true,
							armAutoCleanup: source === "auto",
						});
						return { ok: true, summary: null };
					}),
				},
				startTaskSession: {
					mutate: vi.fn(async ({ taskId }) => ({
						ok: true,
						summary: createSummary(taskId, {
							state: "running",
							updatedAt: 20,
						}),
					})),
				},
				stopTaskSession: {
					mutate: vi.fn(async () => ({
						ok: true,
						summary: null,
					})),
				},
			},
			workspace: {
				ensureWorktree: {
					mutate: vi.fn(async () => ({
						ok: true,
						path: "/repo/task-2",
						baseRef: "main",
					})),
				},
				deleteWorktree: {
					mutate: vi.fn(async () => ({
						ok: true,
						removed: true,
					})),
				},
				notifyStateUpdated: {
					mutate: vi.fn(async () => ({ ok: true })),
				},
			},
		};

		createTrpcProxyClientMock.mockReset();
		createTrpcProxyClientMock.mockReturnValue(runtimeClient);
		httpBatchLinkMock.mockClear();

		loadWorkspaceStateMock.mockReset();
		loadWorkspaceStateMock.mockImplementation(async () => structuredClone(workspaceState));

		mutateWorkspaceStateMock.mockReset();
		mutateWorkspaceStateMock.mockImplementation(async (_cwd, mutate) => {
			const mutation = mutate(structuredClone(workspaceState));
			const nextBoard = mutation.board;
			const nextSessions = mutation.sessions ?? workspaceState.sessions;
			const nextRevision = mutation.save === false ? workspaceState.revision : workspaceState.revision + 1;
			if (mutation.save !== false) {
				workspaceState = {
					...workspaceState,
					board: nextBoard,
					sessions: nextSessions,
					revision: nextRevision,
				};
			}
			return {
				value: mutation.value,
				state: structuredClone(
					mutation.save === false
						? workspaceState
						: {
								...workspaceState,
								board: nextBoard,
								sessions: nextSessions,
								revision: nextRevision,
							},
				),
				saved: mutation.save !== false,
			};
		});

		resolveTaskCwdMock.mockReset();
		resolveTaskCwdMock.mockImplementation(async ({ taskId }) => `/repo/${taskId}`);

		getGitSyncSummaryMock.mockReset();
		getGitSyncSummaryMock.mockImplementation(async (cwd: string) => ({
			currentBranch: "main",
			upstreamBranch: null,
			changedFiles: changedFilesByTaskPath[cwd] ?? 0,
			additions: 0,
			deletions: 0,
			aheadCount: 0,
			behindCount: 0,
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		taskGitActionCoordinator.close();
	});

	it("derives review-ready tasks on the server, auto-commits them, and starts linked tasks after trashing", async () => {
		const { manager, emitter } = createTerminalManager([
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 5,
			}),
		]);
		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackTerminalManager("workspace-1", manager as never);
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			action: "commit",
			source: "auto",
		});
		expect(runtimeClient.workspace.notifyStateUpdated.mutate).not.toHaveBeenCalled();

		emitter.emitSummary(
			createSummary("task-1", {
				state: "running",
				reviewReason: null,
				updatedAt: 6,
			}),
		);
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(1_000);
		await flushMicrotasks();

		expect(runtimeClient.workspace.deleteWorktree.mutate).not.toHaveBeenCalled();

		changedFilesByTaskPath["/repo/task-1"] = 0;
		emitter.emitSummary(
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 7,
			}),
		);
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(2_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.stopTaskSession.mutate).toHaveBeenCalledTimes(2);
		expect(runtimeClient.runtime.stopTaskSession.mutate).toHaveBeenNthCalledWith(1, {
			taskId: "task-1",
		});
		expect(runtimeClient.runtime.stopTaskSession.mutate).toHaveBeenNthCalledWith(2, {
			taskId: "__detail_terminal__:task-1",
		});
		expect(runtimeClient.workspace.deleteWorktree.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
		});
		expect(runtimeClient.runtime.startTaskSession.mutate).toHaveBeenCalledWith({
			taskId: "task-2",
			prompt: "Follow-up task",
			startInPlanMode: false,
			baseRef: "main",
			images: undefined,
		});
		expect(workspaceState.board.columns.find((column) => column.id === "trash")?.cards[0]?.id).toBe("task-1");
		expect(workspaceState.board.columns.find((column) => column.id === "in_progress")?.cards[0]?.id).toBe("task-2");

		automation.close();
	});

	it("routes auto-pr through the shared runtime git-action API", async () => {
		getBoardColumn(workspaceState, "in_progress").cards = [];
		getBoardColumn(workspaceState, "review").cards = [
			{
				id: "task-1",
				prompt: "Primary task",
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "pr",
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
		];

		const { service } = createClineService([
			createSummary("task-1", {
				state: "awaiting_review",
				agentId: "cline",
				reviewReason: "hook",
				updatedAt: 5,
			}),
		]);
		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackClineTaskSessionService("workspace-1", service as ClineTaskSessionService);
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(1_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			action: "pr",
			source: "auto",
		});

		automation.close();
	});

	it("suppresses auto-review while a manual git action is already pending", async () => {
		const { manager, emitter } = createTerminalManager([
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 5,
			}),
		]);
		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackTerminalManager("workspace-1", manager as never);
		await flushMicrotasks();

		expect(taskGitActionCoordinator.beginTaskGitAction("workspace-1", "task-1", "commit")).toBe(true);

		await vi.advanceTimersByTimeAsync(2_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).not.toHaveBeenCalled();

		taskGitActionCoordinator.clearTaskGitAction("workspace-1", "task-1");
		emitter.emitSummary(
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 6,
			}),
		);
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			action: "commit",
			source: "auto",
		});

		automation.close();
	});

	it("ignores persisted review summaries until a live session service is attached", async () => {
		workspaceState.sessions = {
			"task-1": createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 5,
			}),
		};

		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackWorkspace("workspace-1");
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).not.toHaveBeenCalled();

		const { manager } = createTerminalManager([
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 6,
			}),
		]);
		automation.trackTerminalManager("workspace-1", manager as never);
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			action: "commit",
			source: "auto",
		});

		automation.close();
	});

	it("skips auto-review for dirty review cards until a live task session is attached", async () => {
		getBoardColumn(workspaceState, "in_progress").cards = [];
		getBoardColumn(workspaceState, "review").cards = [
			{
				id: "task-1",
				prompt: "Primary task",
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
		];

		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackWorkspace("workspace-1");
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(3_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).not.toHaveBeenCalled();

		const { manager } = createTerminalManager([
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 5,
			}),
		]);
		automation.trackTerminalManager("workspace-1", manager as never);
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			action: "commit",
			source: "auto",
		});

		automation.close();
	});

	it("clears stale auto-cleanup state after a dirty review task returns from an auto git action", async () => {
		getBoardColumn(workspaceState, "in_progress").cards = [];
		getBoardColumn(workspaceState, "review").cards = [
			{
				id: "task-1",
				prompt: "Primary task",
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
		];

		const { manager, emitter } = createTerminalManager([
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "error",
				updatedAt: 5,
			}),
		]);
		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		expect(taskGitActionCoordinator.beginTaskGitAction("workspace-1", "task-1", "commit")).toBe(true);
		taskGitActionCoordinator.completeTaskGitAction("workspace-1", "task-1", "commit", {
			dispatched: true,
			armAutoCleanup: true,
		});

		automation.trackTerminalManager("workspace-1", manager as never);
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(2_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).not.toHaveBeenCalled();
		expect(taskGitActionCoordinator.isTaskGitActionBlocked("workspace-1", "task-1")).toBe(false);
		expect(taskGitActionCoordinator.beginTaskGitAction("workspace-1", "task-1", "commit")).toBe(true);
		taskGitActionCoordinator.clearTaskGitAction("workspace-1", "task-1");

		emitter.emitSummary(
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 6,
			}),
		);
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			baseRef: "main",
			action: "commit",
			source: "auto",
		});

		automation.close();
	});

	it("does not auto-trash a clean review task after a manual git action is sent", async () => {
		getBoardColumn(workspaceState, "in_progress").cards = [];
		getBoardColumn(workspaceState, "review").cards = [
			{
				id: "task-1",
				prompt: "Primary task",
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "pr",
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
		];
		changedFilesByTaskPath["/repo/task-1"] = 0;

		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		expect(taskGitActionCoordinator.beginTaskGitAction("workspace-1", "task-1", "pr")).toBe(true);
		taskGitActionCoordinator.completeTaskGitAction("workspace-1", "task-1", "pr", {
			dispatched: true,
			armAutoCleanup: false,
		});
		expect(taskGitActionCoordinator.beginTaskGitAction("workspace-1", "task-1", "pr")).toBe(true);
		taskGitActionCoordinator.clearTaskGitAction("workspace-1", "task-1");

		automation.trackWorkspace("workspace-1");
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(2_000);
		await flushMicrotasks();

		expect(runtimeClient.workspace.deleteWorktree.mutate).not.toHaveBeenCalled();
		expect(runtimeClient.runtime.stopTaskSession.mutate).not.toHaveBeenCalled();
		expect(getBoardColumn(workspaceState, "review").cards[0]?.id).toBe("task-1");

		automation.close();
	});

	it("treats interrupted tasks as trashed during evaluation without persisting the board move", async () => {
		getBoardColumn(workspaceState, "in_progress").cards = [];
		getBoardColumn(workspaceState, "review").cards = [
			{
				id: "task-1",
				prompt: "Primary task",
				startInPlanMode: false,
				autoReviewEnabled: true,
				autoReviewMode: "commit",
				baseRef: "main",
				createdAt: 1,
				updatedAt: 1,
			},
		];
		workspaceState.sessions = {
			"task-1": createSummary("task-1", {
				state: "interrupted",
				reviewReason: "interrupted",
				updatedAt: 5,
			}),
		};

		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackWorkspace("workspace-1");
		await flushMicrotasks();

		expect(runtimeClient.runtime.runTaskGitAction.mutate).not.toHaveBeenCalled();
		expect(runtimeClient.workspace.notifyStateUpdated.mutate).not.toHaveBeenCalled();
		expect(getBoardColumn(workspaceState, "review").cards[0]?.id).toBe("task-1");
		expect(getBoardColumn(workspaceState, "trash").cards).toHaveLength(0);

		automation.close();
	});

	it("disposes a workspace after state loading fails so polling stops", async () => {
		loadWorkspaceStateMock.mockRejectedValue(new Error("missing workspace"));

		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
			taskGitActionCoordinator,
		});

		automation.trackWorkspace("workspace-1");
		await flushMicrotasks();
		expect(loadWorkspaceStateMock).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(3_000);
		await flushMicrotasks();

		expect(loadWorkspaceStateMock).toHaveBeenCalledTimes(1);
		expect(runtimeClient.runtime.runTaskGitAction.mutate).not.toHaveBeenCalled();

		automation.close();
	});
});
