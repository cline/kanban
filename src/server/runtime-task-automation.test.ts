import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { createRuntimeTaskAutomation } from "./runtime-task-automation";

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
		listSummaries: () => RuntimeTaskSessionSummary[];
		onSummary: (listener: (summary: RuntimeTaskSessionSummary) => void) => () => void;
	};
	emitter: SummaryEmitter;
} {
	let summaries = [...initialSummaries];
	const listeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();
	return {
		manager: {
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
			getConfig: { query: ReturnType<typeof vi.fn> };
			sendTaskChatMessage: { mutate: ReturnType<typeof vi.fn> };
			sendTaskSessionInput: { mutate: ReturnType<typeof vi.fn> };
			startTaskSession: { mutate: ReturnType<typeof vi.fn> };
			stopTaskSession: { mutate: ReturnType<typeof vi.fn> };
		};
		workspace: {
			getTaskContext: { query: ReturnType<typeof vi.fn> };
			ensureWorktree: { mutate: ReturnType<typeof vi.fn> };
			deleteWorktree: { mutate: ReturnType<typeof vi.fn> };
			notifyStateUpdated: { mutate: ReturnType<typeof vi.fn> };
		};
	};
	let changedFilesByTaskPath: Record<string, number>;

	beforeEach(() => {
		vi.useFakeTimers();
		workspaceState = createWorkspaceState();
		changedFilesByTaskPath = {
			"/repo/task-1": 2,
			"/repo/task-2": 0,
		};
		runtimeClient = {
			runtime: {
				getConfig: {
					query: vi.fn(async () => ({
						selectedAgentId: "codex",
						selectedShortcutLabel: null,
						agentAutonomousModeEnabled: true,
						effectiveCommand: null,
						globalConfigPath: "/tmp/global-config.json",
						projectConfigPath: "/tmp/project-config.json",
						readyForReviewNotificationsEnabled: true,
						detectedCommands: [],
						agents: [],
						shortcuts: [],
						clineProviderSettings: {
							providerId: "anthropic",
							modelId: "claude-sonnet-4",
							baseUrl: null,
							apiKeyConfigured: true,
							oauthProvider: null,
							oauthAccessTokenConfigured: false,
							oauthRefreshTokenConfigured: false,
							oauthAccountId: null,
							oauthExpiresAt: null,
						},
						commitPromptTemplate: "commit {{base_ref}}",
						openPrPromptTemplate: "open pr {{base_ref}}",
						commitPromptTemplateDefault: "commit {{base_ref}}",
						openPrPromptTemplateDefault: "open pr {{base_ref}}",
					})),
				},
				sendTaskChatMessage: {
					mutate: vi.fn(async () => ({ ok: true })),
				},
				sendTaskSessionInput: {
					mutate: vi.fn(async () => ({ ok: true })),
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
				getTaskContext: {
					query: vi.fn(async ({ taskId, baseRef }) => ({
						taskId,
						path: `/repo/${taskId}`,
						exists: true,
						baseRef,
						branch: taskId,
						isDetached: false,
						headCommit: "abc1234",
					})),
				},
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
	});

	it("moves review-ready tasks on the server, auto-commits them, and starts linked tasks after trashing", async () => {
		const { manager, emitter } = createTerminalManager([
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 5,
			}),
		]);
		const automation = createRuntimeTaskAutomation({
			getWorkspacePathById: (workspaceId) => (workspaceId === "workspace-1" ? "/repo" : null),
		});

		automation.trackTerminalManager("workspace-1", manager as never);
		await flushMicrotasks();

		expect(workspaceState.board.columns.find((column) => column.id === "review")?.cards[0]?.id).toBe("task-1");

		await vi.advanceTimersByTimeAsync(1_200);
		await flushMicrotasks();

		expect(runtimeClient.runtime.sendTaskSessionInput.mutate).toHaveBeenNthCalledWith(1, {
			taskId: "task-1",
			text: "commit main",
			appendNewline: false,
		});
		expect(runtimeClient.runtime.sendTaskSessionInput.mutate).toHaveBeenNthCalledWith(2, {
			taskId: "task-1",
			text: "\r",
			appendNewline: false,
		});

		changedFilesByTaskPath["/repo/task-1"] = 0;
		emitter.emitSummary(
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
				updatedAt: 6,
			}),
		);
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(2_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.stopTaskSession.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
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

	it("routes auto-pr through the native cline chat API", async () => {
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
		});

		automation.trackClineTaskSessionService("workspace-1", service as ClineTaskSessionService);
		await flushMicrotasks();

		await vi.advanceTimersByTimeAsync(1_000);
		await flushMicrotasks();

		expect(runtimeClient.runtime.sendTaskChatMessage.mutate).toHaveBeenCalledWith({
			taskId: "task-1",
			text: "open pr main",
			mode: "act",
		});
		expect(runtimeClient.runtime.sendTaskSessionInput.mutate).not.toHaveBeenCalled();

		automation.close();
	});
});
