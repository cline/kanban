import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ClineRuntimeSetup } from "../../../src/cline-sdk/cline-runtime-setup";
import type {
	ClinePersistedTaskSessionSnapshot,
	ClineSessionRuntime,
	CreateInMemoryClineSessionRuntimeOptions,
	StartClineSessionRuntimeRequest,
	StartClineSessionRuntimeResult,
} from "../../../src/cline-sdk/cline-session-runtime";
import { createSessionId } from "../../../src/cline-sdk/cline-session-state";
import type { ClineTaskSessionService } from "../../../src/cline-sdk/cline-task-session-service";
import { createInMemoryClineTaskSessionService } from "../../../src/cline-sdk/cline-task-session-service";
import { createClineWatcherRegistry } from "../../../src/cline-sdk/cline-watcher-registry";
import type { RuntimeTaskImage, RuntimeTaskSessionMode } from "../../../src/core/api-contract";

const originalArgv = [...process.argv];
const originalExecArgv = [...process.execArgv];
const originalExecPath = process.execPath;

const turnCheckpointMocks = vi.hoisted(() => ({
	captureTaskTurnCheckpoint: vi.fn(),
	deleteTaskTurnCheckpointRef: vi.fn(),
}));

vi.mock("../../../src/workspace/turn-checkpoints.js", () => ({
	captureTaskTurnCheckpoint: turnCheckpointMocks.captureTaskTurnCheckpoint,
	deleteTaskTurnCheckpointRef: turnCheckpointMocks.deleteTaskTurnCheckpointRef,
}));

function createDeferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return {
		promise,
		resolve,
		reject,
	};
}

type StartTaskSessionMock = Mock<
	(request: StartClineSessionRuntimeRequest & { sessionId: string }) => Promise<StartClineSessionRuntimeResult>
>;
type SendTaskSessionInputMock = Mock<
	(
		taskId: string,
		prompt: string,
		mode?: RuntimeTaskSessionMode,
		images?: RuntimeTaskImage[],
		delivery?: "queue" | "steer",
	) => Promise<unknown>
>;
type StopTaskSessionMock = Mock<(taskId: string) => Promise<void>>;
type AbortTaskSessionMock = Mock<(taskId: string) => Promise<void>>;
type ClearTaskSessionsMock = Mock<(taskId: string) => Promise<void>>;
type ReadPersistedTaskSessionMock = Mock<(taskId: string) => Promise<ClinePersistedTaskSessionSnapshot | null>>;
type DisposeMock = Mock<() => Promise<void>>;

interface FakeClineSessionRuntimeController {
	sessionIdByTaskId: Map<string, string>;
	taskIdBySessionId: Map<string, string>;
	startTaskSessionMock: StartTaskSessionMock;
	sendTaskSessionInputMock: SendTaskSessionInputMock;
	stopTaskSessionMock: StopTaskSessionMock;
	abortTaskSessionMock: AbortTaskSessionMock;
	clearTaskSessionsMock: ClearTaskSessionsMock;
	readPersistedTaskSessionMock: ReadPersistedTaskSessionMock;
	disposeMock: DisposeMock;
	createRuntime(options: CreateInMemoryClineSessionRuntimeOptions): ClineSessionRuntime;
	getTaskSessionId(taskId: string): string | null;
	bindTaskSession(taskId: string, sessionId: string): void;
	emitAgentEvent(sessionId: string, event: unknown): void;
	emitChunk(sessionId: string, chunk: string, stream?: string): void;
}

interface TaskSessionServiceHarness {
	service: ClineTaskSessionService;
	runtime: FakeClineSessionRuntimeController;
}

interface FakeRuntimeSetupController {
	setup: ClineRuntimeSetup;
	resolvePromptMock: Mock<(prompt: string) => string>;
	loadRulesMock: Mock<() => string>;
	requestToolApprovalMock: Mock<(request: ToolApprovalRequest) => Promise<ToolApprovalResult>>;
	disposeMock: Mock<() => Promise<void>>;
}

function createFakeClineSessionRuntime(): FakeClineSessionRuntimeController {
	const sessionIdByTaskId = new Map<string, string>();
	const taskIdBySessionId = new Map<string, string>();
	const lastStartRequestByTaskId = new Map<
		string,
		Omit<StartClineSessionRuntimeRequest, "prompt" | "images" | "initialMessages">
	>();
	let onTaskEvent: ((taskId: string, event: unknown) => void) | null = null;

	const bindTaskSession = (taskId: string, sessionId: string) => {
		const previousSessionId = sessionIdByTaskId.get(taskId);
		if (previousSessionId) {
			taskIdBySessionId.delete(previousSessionId);
		}
		sessionIdByTaskId.set(taskId, sessionId);
		taskIdBySessionId.set(sessionId, taskId);
	};
	const clearTaskSessionBinding = (taskId: string) => {
		const sessionId = sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			return;
		}
		sessionIdByTaskId.delete(taskId);
		taskIdBySessionId.delete(sessionId);
	};

	const startTaskSessionMock: StartTaskSessionMock = vi.fn(
		async (request: StartClineSessionRuntimeRequest & { sessionId: string }) => ({
			sessionId: request.sessionId,
			result: {},
		}),
	);
	const sendTaskSessionInputMock: SendTaskSessionInputMock = vi.fn(async () => ({}));
	const stopTaskSessionMock: StopTaskSessionMock = vi.fn(async () => {});
	const abortTaskSessionMock: AbortTaskSessionMock = vi.fn(async () => {});
	const clearTaskSessionsMock: ClearTaskSessionsMock = vi.fn(async (_taskId: string) => {});
	const readPersistedTaskSessionMock: ReadPersistedTaskSessionMock = vi.fn(async () => null);
	const disposeMock: DisposeMock = vi.fn(async () => {});

	const createRuntime = (options: CreateInMemoryClineSessionRuntimeOptions): ClineSessionRuntime => {
		onTaskEvent = options.onTaskEvent ?? null;
		return {
			async startTaskSession(request: StartClineSessionRuntimeRequest): Promise<StartClineSessionRuntimeResult> {
				const requestedSessionId = createSessionId(request.taskId);
				lastStartRequestByTaskId.set(request.taskId, {
					taskId: request.taskId,
					cwd: request.cwd,
					providerId: request.providerId,
					modelId: request.modelId,
					mode: request.mode ?? "act",
					apiKey: request.apiKey,
					baseUrl: request.baseUrl,
					systemPrompt: request.systemPrompt,
					userInstructionWatcher: request.userInstructionWatcher,
					requestToolApproval: request.requestToolApproval,
				});
				bindTaskSession(request.taskId, requestedSessionId);

				let startResult: StartClineSessionRuntimeResult;
				try {
					startResult = await startTaskSessionMock({
						...request,
						sessionId: requestedSessionId,
					});
				} catch (error) {
					clearTaskSessionBinding(request.taskId);
					throw error;
				}

				bindTaskSession(request.taskId, startResult.sessionId);
				return startResult;
			},
			async restartTaskSession(input): Promise<StartClineSessionRuntimeResult> {
				const lastStartRequest = lastStartRequestByTaskId.get(input.taskId);
				if (!lastStartRequest) {
					throw new Error(`No previous Cline session config is available for task ${input.taskId}.`);
				}
				return await this.startTaskSession({
					...lastStartRequest,
					prompt: input.prompt,
					initialMessages: input.initialMessages,
					images: input.images,
					mode: input.mode ?? lastStartRequest.mode,
				});
			},
			async sendTaskSessionInput(
				taskId: string,
				prompt: string,
				mode?: RuntimeTaskSessionMode,
				images?: RuntimeTaskImage[],
				delivery?: "queue" | "steer",
			): Promise<unknown> {
				if (mode) {
					const lastStartRequest = lastStartRequestByTaskId.get(taskId);
					if (lastStartRequest) {
						lastStartRequestByTaskId.set(taskId, {
							...lastStartRequest,
							mode,
						});
					}
				}
				if (delivery) {
					return await sendTaskSessionInputMock(taskId, prompt, mode, images, delivery);
				}
				return await sendTaskSessionInputMock(taskId, prompt, mode, images);
			},
			async resumeTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
				const snapshot = await readPersistedTaskSessionMock(taskId);
				if (snapshot) {
					bindTaskSession(taskId, snapshot.record.sessionId);
				}
				return snapshot;
			},
			async stopTaskSession(taskId: string): Promise<void> {
				await stopTaskSessionMock(taskId);
				clearTaskSessionBinding(taskId);
			},
			async abortTaskSession(taskId: string): Promise<void> {
				await abortTaskSessionMock(taskId);
				clearTaskSessionBinding(taskId);
			},
			async clearTaskSessions(taskId: string): Promise<void> {
				await clearTaskSessionsMock(taskId);
				clearTaskSessionBinding(taskId);
			},
			getTaskSessionId(taskId: string): string | null {
				return sessionIdByTaskId.get(taskId) ?? null;
			},
			getTaskProviderId(taskId: string): string | null {
				return lastStartRequestByTaskId.get(taskId)?.providerId ?? null;
			},
			canRestartTaskSession(taskId: string): boolean {
				return lastStartRequestByTaskId.has(taskId);
			},
			async readPersistedTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
				return await readPersistedTaskSessionMock(taskId);
			},
			async dispose(): Promise<void> {
				sessionIdByTaskId.clear();
				taskIdBySessionId.clear();
				lastStartRequestByTaskId.clear();
				await disposeMock();
			},
		};
	};

	const emitAgentEvent = (sessionId: string, event: unknown) => {
		if (!onTaskEvent) {
			throw new Error("Fake runtime has not been attached to a task session service.");
		}
		const taskId = taskIdBySessionId.get(sessionId);
		if (!taskId) {
			throw new Error(`No task is bound to session ${sessionId}.`);
		}
		onTaskEvent(taskId, {
			type: "agent_event",
			payload: {
				sessionId,
				event,
			},
		});
	};

	const emitChunk = (sessionId: string, chunk: string, stream = "agent") => {
		if (!onTaskEvent) {
			throw new Error("Fake runtime has not been attached to a task session service.");
		}
		const taskId = taskIdBySessionId.get(sessionId);
		if (!taskId) {
			throw new Error(`No task is bound to session ${sessionId}.`);
		}
		onTaskEvent(taskId, {
			type: "chunk",
			payload: {
				sessionId,
				stream,
				chunk,
				ts: Date.now(),
			},
		});
	};

	return {
		sessionIdByTaskId,
		taskIdBySessionId,
		startTaskSessionMock,
		sendTaskSessionInputMock,
		stopTaskSessionMock,
		abortTaskSessionMock,
		clearTaskSessionsMock,
		readPersistedTaskSessionMock,
		disposeMock,
		createRuntime,
		getTaskSessionId(taskId: string): string | null {
			return sessionIdByTaskId.get(taskId) ?? null;
		},
		bindTaskSession,
		emitAgentEvent,
		emitChunk,
	};
}

function createFakeRuntimeSetup(): FakeRuntimeSetupController {
	const resolvePromptMock = vi.fn((prompt: string) => `resolved:${prompt}`);
	const loadRulesMock = vi.fn(() => "Workspace rule");
	const requestToolApprovalMock = vi.fn(async (_request: ToolApprovalRequest) => ({
		approved: true,
		reason: "approved in test",
	}));
	const disposeMock = vi.fn(async () => {});
	const refreshAllMock = vi.fn(async () => {});
	const getSnapshotMock = vi.fn((_type: string) => new Map());

	return {
		setup: {
			watcher: {
				refreshAll: refreshAllMock,
				getSnapshot: getSnapshotMock,
			} as unknown as ClineRuntimeSetup["watcher"],
			resolvePrompt: resolvePromptMock,
			loadRules: loadRulesMock,
			requestToolApproval: requestToolApprovalMock,
			dispose: disposeMock,
		},
		resolvePromptMock,
		loadRulesMock,
		requestToolApprovalMock,
		disposeMock,
	};
}

async function waitForTaskSessionId(runtime: FakeClineSessionRuntimeController, taskId: string): Promise<string> {
	await vi.waitFor(() => {
		expect(runtime.getTaskSessionId(taskId)).toBeTruthy();
	});
	return runtime.getTaskSessionId(taskId) ?? "session-1";
}

function setKanbanProcessContext(): void {
	process.argv = ["node", "/Users/example/repo/dist/cli.js"];
	process.execArgv = [];
	Object.defineProperty(process, "execPath", {
		configurable: true,
		value: "/usr/local/bin/node",
	});
}

describe("InMemoryClineTaskSessionService", () => {
	const services: ClineTaskSessionService[] = [];

	beforeEach(() => {
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockReset();
		turnCheckpointMocks.deleteTaskTurnCheckpointRef.mockReset();
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockImplementation(
			async (input: { taskId: string; turn: number }) => ({
				turn: input.turn,
				ref: `refs/kanban/checkpoints/${input.taskId}/turn/${input.turn}`,
				commit: `commit-${input.turn}`,
				createdAt: input.turn,
			}),
		);
		turnCheckpointMocks.deleteTaskTurnCheckpointRef.mockResolvedValue(undefined);
	});

	function createTrackedService(): TaskSessionServiceHarness {
		const runtime = createFakeClineSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		// Keep this suite fully in-process. Earlier Node 22 GitHub runner hangs
		// came from the real SDK session runtime booting a live child process
		// before Vitest could report a single test result from this file.
		const service = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: vi.fn(async (_workspacePath: string) => runtimeSetup.setup),
		});
		services.push(service);
		return {
			service,
			runtime,
		};
	}

	afterEach(async () => {
		await Promise.allSettled(
			services.splice(0).map(async (service) => {
				await service.dispose();
			}),
		);
		process.argv = [...originalArgv];
		process.execArgv = [...originalExecArgv];
		Object.defineProperty(process, "execPath", {
			configurable: true,
			value: originalExecPath,
		});
	});

	it("starts a cline session and captures initial prompt as a user message", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});

		expect(summary.taskId).toBe("task-1");
		expect(summary.agentId).toBe("cline");
		expect(summary.state).toBe("running");
		expect(summary.workspacePath).toBe("/tmp/worktree");
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual(["Investigate startup"]);
	});

	it("disposes cached runtime setups when the service shuts down", async () => {
		const runtime = createFakeClineSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
		});
		services.push(service);

		await service.listSlashCommands("/tmp/worktree");
		await service.dispose();

		expect(createRuntimeSetupMock).toHaveBeenCalledWith("/tmp/worktree");
		expect(runtimeSetup.disposeMock).toHaveBeenCalledTimes(1);
	});

	it("includes built-in clear slash command when listing commands", async () => {
		const { service } = createTrackedService();

		const commands = await service.listSlashCommands("/tmp/worktree");

		expect(commands).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					name: "clear",
				}),
			]),
		);
	});

	it("reuses one runtime setup per workspace across services when sharing a watcher registry", async () => {
		const runtimeA = createFakeClineSessionRuntime();
		const runtimeB = createFakeClineSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const watcherRegistry = createClineWatcherRegistry({
			createRuntimeSetup: createRuntimeSetupMock,
		});
		const serviceA = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtimeA.createRuntime(options),
			watcherRegistry,
		});
		const serviceB = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtimeB.createRuntime(options),
			watcherRegistry,
		});
		services.push(serviceA, serviceB);

		await serviceA.listSlashCommands("/tmp/worktree");
		await serviceB.listSlashCommands("/tmp/worktree");

		expect(createRuntimeSetupMock).toHaveBeenCalledTimes(1);

		await serviceA.dispose();
		expect(runtimeSetup.disposeMock).toHaveBeenCalledTimes(0);

		await serviceB.dispose();
		expect(runtimeSetup.disposeMock).toHaveBeenCalledTimes(1);
	});

	it("clears a task session, removes history, and allows a fresh turn", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await waitForTaskSessionId(runtime, "task-1");

		const clearedSummary = await service.clearTaskSession("task-1");

		expect(runtime.clearTaskSessionsMock).toHaveBeenCalledWith("task-1");
		expect(clearedSummary?.state).toBe("idle");
		expect(clearedSummary?.workspacePath).toBe("/tmp/worktree");
		expect(service.listMessages("task-1")).toEqual([]);

		const nextSummary = await service.sendTaskSessionInput("task-1", "Fresh start");
		expect(nextSummary?.state).toBe("running");
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				taskId: "task-1",
				prompt: "resolved:Fresh start",
			}),
		);
	});

	it("clears hydrated persisted history even when no live task entry exists", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock
			.mockResolvedValueOnce({
				record: {
					sessionId: "task-1-persisted",
					source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
					status: "completed",
					startedAt: "2026-03-17T10:00:00.000Z",
					updatedAt: "2026-03-17T10:05:00.000Z",
					interactive: true,
					provider: "anthropic",
					model: "claude-sonnet-4-6",
					cwd: "/tmp/worktree",
					workspaceRoot: "/tmp/workspace-root",
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					isSubagent: false,
				},
				messages: [
					{
						role: "user",
						content: "Recovered prompt",
					},
					{
						role: "assistant",
						content: "Recovered answer",
					},
				],
			})
			.mockResolvedValue(null);

		expect((await service.loadTaskSessionMessages("task-1")).map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);

		const clearedSummary = await service.clearTaskSession("task-1");

		expect(clearedSummary).toBeNull();
		expect(runtime.clearTaskSessionsMock).toHaveBeenCalledWith("task-1");
		expect(await service.loadTaskSessionMessages("task-1")).toEqual([]);
		expect(runtime.readPersistedTaskSessionMock).toHaveBeenCalledTimes(2);
	});

	it("keeps resume-from-trash sessions awaiting review until the user sends a message", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(summary.state).toBe("awaiting_review");
		expect(summary.reviewReason).toBe("attention");
		expect(service.listMessages("task-1")).toEqual([]);
	});

	it("starts empty-prompt sessions idle until the user sends a message", async () => {
		const { service } = createTrackedService();

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		expect(summary.state).toBe("idle");
		expect(summary.reviewReason).toBeNull();
		expect(service.listMessages("task-1")).toEqual([]);
	});

	it("hydrates persisted chat history when resuming a task from trash", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
				{
					role: "assistant",
					content: "Recovered answer",
				},
			],
		});

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(summary.state).toBe("awaiting_review");
		expect(summary.reviewReason).toBe("attention");
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);
		expect((await service.loadTaskSessionMessages("task-1")).map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: "resolved:",
					initialMessages: [
						{
							role: "user",
							content: "Recovered prompt",
						},
						{
							role: "assistant",
							content: "Recovered answer",
						},
					],
				}),
			);
		});
	});

	it("reinitializes chat history from persisted data when resuming a trashed task", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Original prompt",
		});
		const firstSessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(firstSessionId, {
			type: "done",
			reason: "completed",
			text: "Original answer",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Original prompt",
			"Original answer",
		]);

		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
				{
					role: "assistant",
					content: "Recovered answer",
				},
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);
	});

	it("defaults to the SDK cline provider when provider is not explicitly configured", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				providerId: "cline",
				systemPrompt: expect.stringContaining("You are Cline, an AI coding agent."),
			}),
		);
	});

	it("forwards task images into the Cline runtime start request", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			images: [
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			}),
		);
	});

	it("forwards attached images when sending follow-up chat input", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "Continue", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Continue",
				"act",
				[
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				"queue",
			);
		});
	});

	it("queues follow-up chat input while the agent is still running", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "One more thing");

		expect(nextSummary?.state).toBe("running");
		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:One more thing",
				"act",
				undefined,
				"queue",
			);
		});
		expect(service.listMessages("task-1").some((message) => message.content.includes("Cline SDK send failed"))).toBe(
			false,
		);
	});

	it("reuses the current task mode when follow-up input does not provide a mode override", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			mode: "plan",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "Continue");
		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:Continue",
				"plan",
				undefined,
				"queue",
			);
		});
		expect(service.getSummary("task-1")?.mode).toBe("plan");
	});

	it("prepends a Kanban-managed planning prompt when start in plan mode is enabled", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			startInPlanMode: true,
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: "act",
				prompt: expect.stringContaining("Do not modify files, do not use write tools"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: expect.stringContaining("Task:\nInvestigate startup"),
			}),
		);
		expect(service.getSummary("task-1")?.mode).toBe("act");
	});

	it("keeps the most recent mode for subsequent follow-up input", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "Switch mode", "plan");
		await service.sendTaskSessionInput("task-1", "Keep going");

		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenNthCalledWith(
				1,
				"task-1",
				"resolved:Switch mode",
				"plan",
				undefined,
				"queue",
			);
			expect(runtime.sendTaskSessionInputMock).toHaveBeenNthCalledWith(
				2,
				"task-1",
				"resolved:Keep going",
				"plan",
				undefined,
				"queue",
			);
		});
		expect(service.getSummary("task-1")?.mode).toBe("plan");
	});

	it("allows image-only follow-up chat input", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		await service.sendTaskSessionInput("task-1", "   ", undefined, [
			{
				id: "img-1",
				data: "abc123",
				mimeType: "image/png",
			},
		]);

		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"resolved:",
				"act",
				[
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
				"queue",
			);
		});
	});

	it("surfaces startup warnings from the runtime on the session summary", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockResolvedValueOnce({
			sessionId: "task-1-runtime",
			result: {},
			warnings: ['Failed to load MCP server "linear": MCP server "linear" requires OAuth authorization.'],
		});

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.warningMessage).toContain('Failed to load MCP server "linear"');
		});

		expect(summary.warningMessage).toBeNull();
	});

	it("appends Kanban sidebar instructions for home sessions", async () => {
		const { service, runtime } = createTrackedService();
		setKanbanProcessContext();

		await service.startTaskSession({
			taskId: "__home_agent__:workspace-1:cline",
			cwd: "/tmp/worktree",
			prompt: "Add a task",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("You are Cline, an AI coding agent."),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining("Kanban sidebar agent"),
			}),
		);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				systemPrompt: expect.stringContaining(
					"'/usr/local/bin/node' '/Users/example/repo/dist/cli.js' task create",
				),
			}),
		);
	});

	it("mirrors runtime prompt resolution, rules, and approval wiring into the SDK start call", async () => {
		const runtime = createFakeClineSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "/fix issue",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		expect(createRuntimeSetupMock).toHaveBeenCalledWith("/tmp/worktree");
		expect(runtimeSetup.resolvePromptMock).toHaveBeenCalledWith("/fix issue");
		expect(runtimeSetup.loadRulesMock).toHaveBeenCalledTimes(1);
		expect(runtime.startTaskSessionMock).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "resolved:/fix issue",
				userInstructionWatcher: runtimeSetup.setup.watcher,
				requestToolApproval: runtimeSetup.setup.requestToolApproval,
				systemPrompt: expect.stringContaining("Workspace rule"),
			}),
		);
	});

	it("stores follow-up user input and keeps session running", async () => {
		const { service } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Continue\n");

		expect(nextSummary?.state).toBe("running");
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual(["Initial prompt", "Continue"]);
	});

	it("rebinds a persisted session after restart and resumes chat on the next message", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "task-1-persisted-cwd",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
				{
					role: "assistant",
					content: "Recovered answer",
				},
			],
		});

		const reboundSummary = await service.rebindPersistedTaskSession("task-1");

		expect(reboundSummary?.state).toBe("awaiting_review");
		expect(reboundSummary?.reviewReason).toBe("attention");
		expect(reboundSummary?.workspacePath).toBe("task-1-persisted-cwd");
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
			"Recovered prompt",
			"Recovered answer",
		]);

		const nextSummary = await service.sendTaskSessionInput("task-1", "Continue");

		expect(nextSummary?.state).toBe("running");
		await vi.waitFor(() => {
			expect(service.listMessages("task-1").map((message) => message.content)).toEqual([
				"Recovered prompt",
				"Recovered answer",
				"Continue",
			]);
		});
	});

	it("resolves workflow prompts for follow-up input before sending to the SDK runtime", async () => {
		const runtime = createFakeClineSessionRuntime();
		const runtimeSetup = createFakeRuntimeSetup();
		const createRuntimeSetupMock = vi.fn(async (_workspacePath: string) => runtimeSetup.setup);
		const service = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
			createRuntimeSetup: createRuntimeSetupMock,
		});
		services.push(service);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await waitForTaskSessionId(runtime, "task-1");

		runtimeSetup.resolvePromptMock.mockImplementation((prompt: string) => `workflow:${prompt}`);
		await service.sendTaskSessionInput("task-1", "/continue");
		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith(
				"task-1",
				"workflow:/continue",
				"act",
				undefined,
				"queue",
			);
		});
	});
	it("marks session interrupted when stopped", async () => {
		const { service } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		const stopped = await service.stopTaskSession("task-1");

		expect(stopped?.state).toBe("interrupted");
		expect(stopped?.reviewReason).toBe("interrupted");
	});

	it("rebinds persisted sessions before stopping when no in-memory entry exists", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-persisted",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Recovered prompt",
				},
			],
		});

		const stopped = await service.stopTaskSession("task-1");

		expect(runtime.readPersistedTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(stopped?.state).toBe("interrupted");
		expect(stopped?.reviewReason).toBe("interrupted");
	});

	it("cancels only the active turn without interrupting or trashing the task", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		const canceled = await service.cancelTaskTurn("task-1");
		expect(canceled?.state).toBe("idle");
		expect(canceled?.reviewReason).toBeNull();
		expect(canceled?.latestHookActivity?.activityText).toBe("Turn canceled");

		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "aborted",
		});

		expect(service.getSummary("task-1")?.state).toBe("idle");
		expect(service.getSummary("task-1")?.reviewReason).toBeNull();
	});

	it("uses agent_event text deltas for streaming and ignores serialized agent chunks", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: "Hello",
			accumulated: "Hello",
		});

		runtime.emitChunk(sessionId, '{"type":"content_start","contentType":"text","text":"SHOULD_NOT_RENDER"}');

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: " world",
			accumulated: "Hello world",
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);

		expect(assistantMessages).toEqual(["Hello world"]);
	});

	it("streams reasoning and tool lifecycle messages with stable ids", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "reasoning",
			reasoning: "Thinking",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "reasoning",
			reasoning: "...",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "reasoning",
			reasoning: "Thinking...",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Read",
			input: { file: "a.ts" },
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "Read",
			output: { ok: true },
			durationMs: 25,
		});

		const messages = service.listMessages("task-1");
		const reasoningMessages = messages.filter((message) => message.role === "reasoning");
		const toolMessages = messages.filter((message) => message.role === "tool");

		expect(reasoningMessages).toHaveLength(1);
		expect(reasoningMessages[0]?.content).toBe("Thinking...");
		expect(reasoningMessages[0]?.meta?.hookEventName).toBe("reasoning_end");
		expect(toolMessages).toHaveLength(1);
		expect(toolMessages[0]?.meta?.hookEventName).toBe("tool_call_end");
		expect(toolMessages[0]?.content).toContain("Tool: Read");
		expect(toolMessages[0]?.content).toContain("Input:");
		expect(toolMessages[0]?.content).toContain("Output:");
	});

	it("transitions between running and awaiting_review for user-attention tools", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "ask_followup_question",
			input: { question: "Need approval" },
		});

		expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		expect(service.getSummary("task-1")?.reviewReason).toBe("hook");

		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "tool",
			toolCallId: "tool-1",
			toolName: "ask_followup_question",
			output: { ok: true },
		});

		expect(service.getSummary("task-1")?.state).toBe("running");
		expect(service.getSummary("task-1")?.reviewReason).toBeNull();
	});

	it("moves to awaiting_review when SDK emits done for a completed turn", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});
		service.applyTurnCheckpoint("task-1", {
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "commit-1",
			createdAt: 1,
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: "Done. Added the comment.",
		});

		const summary = service.getSummary("task-1");
		expect(summary?.state).toBe("awaiting_review");
		expect(summary?.reviewReason).toBe("hook");
		expect(summary?.latestHookActivity?.hookEventName).toBe("agent_end");
		expect(summary?.latestHookActivity?.finalMessage).toBe("Done. Added the comment.");
		await vi.waitFor(() => {
			expect(turnCheckpointMocks.captureTaskTurnCheckpoint).toHaveBeenCalledWith({
				cwd: "/tmp/worktree",
				taskId: "task-1",
				turn: 2,
			});
		});
		expect(service.getSummary("task-1")?.previousTurnCheckpoint?.commit).toBe("commit-1");
		expect(service.getSummary("task-1")?.latestTurnCheckpoint?.commit).toBe("commit-2");
	});

	it("creates task entry and session mapping before start() resolves", async () => {
		const { service, runtime } = createTrackedService();
		const startDeferred = createDeferred<StartClineSessionRuntimeResult>();
		runtime.startTaskSessionMock.mockImplementationOnce(
			async (_request: StartClineSessionRuntimeRequest & { sessionId: string }) => await startDeferred.promise,
		);

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "start",
		});

		expect(summary.state).toBe("running");
		const mappedSessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(mappedSessionId ?? "session-1", {
			type: "content_start",
			contentType: "text",
			text: "Streaming",
			accumulated: "Streaming",
		});

		expect(
			service
				.listMessages("task-1")
				.filter((message) => message.role === "assistant")
				.map((message) => message.content),
		).toEqual(["Streaming"]);

		startDeferred.resolve({
			sessionId: mappedSessionId ?? "session-1",
			result: {},
		});
		await Promise.resolve();
	});

	it("does not block sendTaskSessionInput on full-turn SDK send completion", async () => {
		const { service, runtime } = createTrackedService();
		const sendDeferred = createDeferred<unknown>();
		runtime.sendTaskSessionInputMock.mockImplementationOnce(async () => await sendDeferred.promise);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const response = await Promise.race([
			service.sendTaskSessionInput("task-1", "Continue"),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
		]);

		expect(response).not.toBeNull();
		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledTimes(1);
		});
		sendDeferred.resolve({ text: "done" });
	});

	it("keeps the task resumable when native Cline startup throws", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(new Error('Missing API key for provider "cline".'));

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		expect(service.getSummary("task-1")?.reviewReason).toBe("error");
		expect(service.getSummary("task-1")?.warningMessage).toContain("Missing API key");
		expect(service.getSummary("task-1")?.latestHookActivity?.hookEventName).toBe("agent_error");
		expect(service.getSummary("task-1")?.latestHookActivity?.finalMessage).toContain("Missing API key");
		expect(service.listMessages("task-1").some((message) => message.content.includes("Cline SDK start failed"))).toBe(
			true,
		);
	});

	it("suppresses generic startup failure warnings for insufficient-balance errors", async () => {
		const { service, runtime } = createTrackedService();
		const insufficientBalanceError = new Error("402 Insufficient balance. Your Cline Credits balance is $0.00");
		runtime.startTaskSessionMock.mockRejectedValueOnce(insufficientBalanceError);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		expect(service.getSummary("task-1")?.warningMessage).toBeNull();
		expect(service.listMessages("task-1").some((message) => message.content.includes("Cline SDK start failed"))).toBe(
			false,
		);
	});

	it("sets credit_limit notificationType on start/send failure path for insufficient-balance errors", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(
			new Error("402 Insufficient balance. Your Cline Credits balance is $0.00"),
		);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		expect(service.getSummary("task-1")?.latestHookActivity?.notificationType).toBe("credit_limit");
	});

	it("aborts the task session when an agent event signals credit exhaustion", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "error",
			error: new Error("402 Insufficient balance. Your Cline Credits balance is $0.00"),
			recoverable: false,
			iteration: 1,
		});

		await vi.waitFor(() => {
			expect(runtime.abortTaskSessionMock).toHaveBeenCalledWith("task-1");
		});
		expect(service.getSummary("task-1")?.latestHookActivity?.notificationType).toBe("credit_limit");
	});

	it("allows follow-up input after a startup error", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(new Error("Maximum consecutive mistakes reached."));

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(service.listMessages("task-1").map((message) => message.content)).toContain("Try again");
	});

	it("compacts persisted history and retries send when context window is exceeded", async () => {
		const { service, runtime } = createTrackedService();
		runtime.sendTaskSessionInputMock.mockRejectedValueOnce(
			new Error(
				"Anthropic request was rejected (HTTP 400). Maximum prompt length exceeded: 1102640 tokens exceeds the 1000000 token limit.",
			),
		);
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-failed",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "failed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{ role: "user", content: "Initial prompt" },
				{ role: "assistant", content: "Step 1 response" },
				{ role: "user", content: "Step 2 request" },
				{ role: "assistant", content: "Step 2 response" },
				{ role: "assistant", content: "Tool output summary" },
				{ role: "user", content: "Latest user request" },
				{ role: "assistant", content: "Latest response" },
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledTimes(1);
		const restartCall = runtime.startTaskSessionMock.mock.calls[1]?.[0];
		expect(restartCall?.prompt).toBe("resolved:Try again");
		const compactedMessages = restartCall?.initialMessages;
		expect(Array.isArray(compactedMessages)).toBe(true);
		expect((compactedMessages ?? []).length).toBeLessThan(7);
		expect(compactedMessages?.[0]?.role).toBe("user");
		const compactedFirstContent =
			typeof compactedMessages?.[0]?.content === "string"
				? compactedMessages[0].content
				: JSON.stringify(compactedMessages?.[0]?.content ?? "");
		expect(compactedFirstContent).toContain("Previous conversation history was removed due to context window limits");
		expect(compactedFirstContent).not.toContain("[[");
		expect(compactedFirstContent).toContain("[Previous conversation history");
		expect(compactedFirstContent).toContain("Initial prompt");
		expect(service.listMessages("task-1").some((message) => message.content.includes("Cline SDK send failed"))).toBe(
			false,
		);
	});

	it("restarts the live session from persisted history after the SDK ends the task on send failure", async () => {
		const { service, runtime } = createTrackedService();
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "task-1-failed",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "failed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Initial prompt",
				},
				{
					role: "assistant",
					content: "Previous reply",
				},
			],
		});

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const liveSessionId = runtime.getTaskSessionId("task-1");
		expect(liveSessionId).toBeTruthy();
		runtime.sessionIdByTaskId.delete("task-1");
		if (liveSessionId) {
			runtime.taskIdBySessionId.delete(liveSessionId);
		}

		const nextSummary = await service.sendTaskSessionInput("task-1", "Try again");

		expect(nextSummary?.state).toBe("running");
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		});
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
		expect(runtime.startTaskSessionMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				prompt: "resolved:Try again",
				initialMessages: [
					{
						role: "user",
						content: "Initial prompt",
					},
					{
						role: "assistant",
						content: "Previous reply",
					},
				],
			}),
		);
		expect(service.listMessages("task-1").map((message) => message.content)).toContain("Try again");
	});

	it("reloads by restarting after stop instead of sending into the just-stopped session", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});
		await vi.waitFor(() => {
			expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(1);
		});

		const summary = await service.reloadTaskSession("task-1");

		expect(summary?.state).toBe("idle");
		expect(runtime.stopTaskSessionMock).toHaveBeenCalledWith("task-1");
		expect(runtime.startTaskSessionMock).toHaveBeenCalledTimes(2);
		expect(runtime.sendTaskSessionInputMock).not.toHaveBeenCalled();
	});

	it("returns null for restored home sessions without cached start config so the caller can start fresh", async () => {
		const { service, runtime } = createTrackedService();
		const taskId = "__home_agent__:workspace-1:cline";
		runtime.readPersistedTaskSessionMock.mockResolvedValue({
			record: {
				sessionId: "persisted-home-session",
				source: "core" as ClinePersistedTaskSessionSnapshot["record"]["source"],
				status: "completed",
				startedAt: "2026-03-17T10:00:00.000Z",
				updatedAt: "2026-03-17T10:05:00.000Z",
				interactive: true,
				provider: "openrouter",
				model: "openrouter/auto",
				cwd: "/tmp/worktree",
				workspaceRoot: "/tmp/workspace-root",
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				isSubagent: false,
			},
			messages: [
				{
					role: "user",
					content: "Initial prompt",
				},
				{
					role: "assistant",
					content: "Initial reply",
				},
			],
		});

		const reboundSummary = await service.rebindPersistedTaskSession(taskId);
		expect(reboundSummary?.taskId).toBe(taskId);
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();

		const sendSummary = await service.sendTaskSessionInput(taskId, "Continue");
		expect(sendSummary).toBeNull();
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();
		expect(service.listMessages(taskId).map((message) => message.content)).not.toContain("Continue");

		const reloadSummary = await service.reloadTaskSession(taskId);
		expect(reloadSummary).toBeNull();
		expect(runtime.startTaskSessionMock).not.toHaveBeenCalled();
	});

	it("does not duplicate assistant output when stream and send result both include final text", async () => {
		const { service, runtime } = createTrackedService();
		const sendDeferred = createDeferred<unknown>();
		runtime.sendTaskSessionInputMock.mockImplementationOnce(async () => await sendDeferred.promise);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		await service.sendTaskSessionInput("task-1", "Continue");
		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: "Done.",
			accumulated: "Done.",
		});

		sendDeferred.resolve({ text: "Done." });
		await Promise.resolve();

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);
		expect(assistantMessages).toEqual(["Done."]);
	});

	it("does not duplicate final assistant text when content_end and done carry the same text", async () => {
		const { service, runtime } = createTrackedService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const sessionId = await waitForTaskSessionId(runtime, "task-1");

		runtime.emitAgentEvent(sessionId, {
			type: "content_start",
			contentType: "text",
			text: "Done.",
			accumulated: "Done.",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "content_end",
			contentType: "text",
			text: "Done.",
		});
		runtime.emitAgentEvent(sessionId, {
			type: "done",
			reason: "completed",
			text: "Done.",
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);
		expect(assistantMessages).toEqual(["Done."]);
	});
});
