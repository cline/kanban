import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/agents";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { ClineRuntimeSetup } from "../../../src/cline-sdk/cline-runtime-setup.js";
import type {
	ClinePersistedTaskSessionSnapshot,
	ClineSessionRuntime,
	CreateInMemoryClineSessionRuntimeOptions,
	StartClineSessionRuntimeRequest,
	StartClineSessionRuntimeResult,
} from "../../../src/cline-sdk/cline-session-runtime.js";
import { createSessionId } from "../../../src/cline-sdk/cline-session-state.js";
import type { ClineTaskSessionService } from "../../../src/cline-sdk/cline-task-session-service.js";
import { createInMemoryClineTaskSessionService } from "../../../src/cline-sdk/cline-task-session-service.js";

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
type SendTaskSessionInputMock = Mock<(taskId: string, prompt: string) => Promise<unknown>>;
type StopTaskSessionMock = Mock<(taskId: string) => Promise<void>>;
type AbortTaskSessionMock = Mock<(taskId: string) => Promise<void>>;
type ReadPersistedTaskSessionMock = Mock<(taskId: string) => Promise<ClinePersistedTaskSessionSnapshot | null>>;
type DisposeMock = Mock<() => Promise<void>>;

interface FakeClineSessionRuntimeController {
	sessionIdByTaskId: Map<string, string>;
	taskIdBySessionId: Map<string, string>;
	startTaskSessionMock: StartTaskSessionMock;
	sendTaskSessionInputMock: SendTaskSessionInputMock;
	stopTaskSessionMock: StopTaskSessionMock;
	abortTaskSessionMock: AbortTaskSessionMock;
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
	let onTaskEvent: ((taskId: string, event: unknown) => void) | null = null;

	const bindTaskSession = (taskId: string, sessionId: string) => {
		const previousSessionId = sessionIdByTaskId.get(taskId);
		if (previousSessionId) {
			taskIdBySessionId.delete(previousSessionId);
		}
		sessionIdByTaskId.set(taskId, sessionId);
		taskIdBySessionId.set(sessionId, taskId);
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
	const readPersistedTaskSessionMock: ReadPersistedTaskSessionMock = vi.fn(async () => null);
	const disposeMock: DisposeMock = vi.fn(async () => {});

	const createRuntime = (options: CreateInMemoryClineSessionRuntimeOptions): ClineSessionRuntime => {
		onTaskEvent = options.onTaskEvent ?? null;
		return {
			async startTaskSession(request: StartClineSessionRuntimeRequest): Promise<StartClineSessionRuntimeResult> {
				const requestedSessionId = createSessionId(request.taskId);
				bindTaskSession(request.taskId, requestedSessionId);

				const startResult = await startTaskSessionMock({
					...request,
					sessionId: requestedSessionId,
				});

				bindTaskSession(request.taskId, startResult.sessionId);
				return startResult;
			},
			async sendTaskSessionInput(taskId: string, prompt: string): Promise<unknown> {
				return await sendTaskSessionInputMock(taskId, prompt);
			},
			async stopTaskSession(taskId: string): Promise<void> {
				await stopTaskSessionMock(taskId);
			},
			async abortTaskSession(taskId: string): Promise<void> {
				await abortTaskSessionMock(taskId);
			},
			getTaskSessionId(taskId: string): string | null {
				return sessionIdByTaskId.get(taskId) ?? null;
			},
			async readPersistedTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
				return await readPersistedTaskSessionMock(taskId);
			},
			async dispose(): Promise<void> {
				sessionIdByTaskId.clear();
				taskIdBySessionId.clear();
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

	return {
		setup: {
			watcher: {} as ClineRuntimeSetup["watcher"],
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

describe("InMemoryClineTaskSessionService", () => {
	const services: ClineTaskSessionService[] = [];

	beforeEach(() => {
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockReset();
		turnCheckpointMocks.deleteTaskTurnCheckpointRef.mockReset();
		turnCheckpointMocks.captureTaskTurnCheckpoint.mockImplementation(async (input: { taskId: string; turn: number }) => ({
			turn: input.turn,
			ref: `refs/kanban/checkpoints/${input.taskId}/turn/${input.turn}`,
			commit: `commit-${input.turn}`,
			createdAt: input.turn,
		}));
		turnCheckpointMocks.deleteTaskTurnCheckpointRef.mockResolvedValue(undefined);
	});

	function createTrackedService(): TaskSessionServiceHarness {
		const runtime = createFakeClineSessionRuntime();
		// Keep this suite fully in-process. Earlier Node 22 GitHub runner hangs
		// came from the real SDK session runtime booting a live child process
		// before Vitest could report a single test result from this file.
		const service = createInMemoryClineTaskSessionService({
			createSessionRuntime: (options) => runtime.createRuntime(options),
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

	it("defaults to anthropic provider when provider is not explicitly configured", async () => {
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
				providerId: "anthropic",
				systemPrompt: expect.stringContaining("You are Cline, an AI coding agent."),
			}),
		);
	});

	it("appends Kanban sidebar instructions for home sessions", async () => {
		const { service, runtime } = createTrackedService();

		await service.startTaskSession({
			taskId: "__home_agent__:workspace-1:cline:abc123",
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
				systemPrompt: expect.stringContaining("kanban task create"),
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

		runtimeSetup.resolvePromptMock.mockImplementation((prompt: string) => `workflow:${prompt}`);
		await service.sendTaskSessionInput("task-1", "/continue");
		await vi.waitFor(() => {
			expect(runtime.sendTaskSessionInputMock).toHaveBeenCalledWith("task-1", "workflow:/continue");
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

	it("marks the task failed when native Cline startup throws", async () => {
		const { service, runtime } = createTrackedService();
		runtime.startTaskSessionMock.mockRejectedValueOnce(new Error("Missing API key for provider \"cline\"."));

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		await vi.waitFor(() => {
			expect(service.getSummary("task-1")?.state).toBe("failed");
		});

		expect(service.getSummary("task-1")?.reviewReason).toBe("error");
		expect(service.getSummary("task-1")?.latestHookActivity?.hookEventName).toBe("agent_error");
		expect(service.getSummary("task-1")?.latestHookActivity?.finalMessage).toContain("Missing API key");
		expect(service.listMessages("task-1").some((message) => message.content.includes("Cline SDK start failed"))).toBe(
			true,
		);
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
