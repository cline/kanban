import { describe, expect, it, vi } from "vitest";

import { createInMemoryClineSessionRuntime } from "../../../src/cline-sdk/cline-session-runtime";
import type { ClineSdkSessionRecord } from "../../../src/cline-sdk/sdk-runtime-boundary";

function createNoopMcpRuntimeService() {
	return {
		createToolBundle: vi.fn(async () => ({
			tools: [],
			warnings: [],
			dispose: async () => {},
		})),
		getAuthStatuses: vi.fn(async () => []),
		authorizeServer: vi.fn(),
	};
}

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

function createPersistedRecord(input: {
	sessionId: string;
	status: ClineSdkSessionRecord["status"];
	startedAt: string;
	updatedAt: string;
}): ClineSdkSessionRecord {
	return {
		sessionId: input.sessionId,
		source: "core" as ClineSdkSessionRecord["source"],
		status: input.status,
		startedAt: input.startedAt,
		updatedAt: input.updatedAt,
		interactive: true,
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		cwd: "/tmp/worktree",
		workspaceRoot: "/tmp/workspace-root",
		enableTools: true,
		enableSpawn: false,
		enableTeams: false,
		isSubagent: false,
	};
}

describe("InMemoryClineSessionRuntime", () => {
	it("leaves reasoning effort unset when no override is provided", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string; reasoningEffort?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(fakeHost.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					reasoningEffort: undefined,
				}),
			}),
		);
	});

	it("persists provided task title to session metadata when supported", async () => {
		const updateSession = vi.fn(async () => ({ updated: true }));
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
			sessionService: {
				updateSession,
			},
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		const result = await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			taskTitle: "Readable task title",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(result.sessionId).toBeTruthy();
		expect(updateSession).toHaveBeenCalledWith({
			sessionId: result.sessionId,
			title: "Readable task title",
		});
	});

	it("ignores session metadata update failures during start", async () => {
		const updateSession = vi.fn(async () => {
			throw new Error("storage unavailable");
		});
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
			sessionService: {
				updateSession,
			},
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await expect(
			runtime.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt: "Investigate startup",
				taskTitle: "Readable task title",
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				systemPrompt: "You are a helpful coding assistant.",
			}),
		).resolves.toEqual(
			expect.objectContaining({
				sessionId: expect.any(String),
			}),
		);
		expect(updateSession).toHaveBeenCalledTimes(1);
	});

	it("routes host events through the pending requested session id before start resolves", async () => {
		const startDeferred = createDeferred<{ sessionId: string; result: unknown }>();
		const onTaskEvent = vi.fn();
		let subscribedListener: ((event: unknown) => void) | null = null;
		let requestedSessionId: string | null = null;
		let requestedSource: string | null = null;

		const fakeHost = {
			start: vi.fn(async (input: { source?: string; config?: { sessionId?: string } }) => {
				requestedSessionId = input.config?.sessionId ?? null;
				requestedSource = input.source ?? null;
				return await startDeferred.promise;
			}),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				subscribedListener = listener;
				return () => {};
			}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
			onTaskEvent,
		});

		const startPromise = runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		await vi.waitFor(() => {
			expect(fakeHost.start).toHaveBeenCalledTimes(1);
			expect(requestedSessionId).toBeTruthy();
			expect(requestedSource).toBe(null);
			expect(subscribedListener).toBeTruthy();
		});

		if (!subscribedListener) {
			throw new Error("Expected runtime to subscribe to host events.");
		}
		const emitPendingEvent = subscribedListener as (event: unknown) => void;

		emitPendingEvent({
			type: "agent_event",
			payload: {
				sessionId: requestedSessionId,
				event: {
					type: "content_start",
					contentType: "text",
					text: "Streaming",
				},
			},
		});

		expect(onTaskEvent).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				type: "agent_event",
			}),
		);

		startDeferred.resolve({
			sessionId: requestedSessionId ?? "session-1",
			result: {},
		});
		await startPromise;
	});

	it("rebinds to the resolved session id returned by the SDK host", async () => {
		let subscribedListener: ((event: unknown) => void) | null = null;
		let requestedSessionId: string | null = null;
		const onTaskEvent = vi.fn();

		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => {
				requestedSessionId = input.config?.sessionId ?? null;
				return {
					sessionId: "resolved-session-1",
					result: {},
				};
			}),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				subscribedListener = listener;
				return () => {};
			}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
			onTaskEvent,
		});

		const startResult = await runtime.startTaskSession({
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
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(startResult.sessionId).toBe("resolved-session-1");
		expect(runtime.getTaskSessionId("task-1")).toBe("resolved-session-1");

		await runtime.sendTaskSessionInput("task-1", "Continue", undefined, [
			{
				id: "img-2",
				data: "def456",
				mimeType: "image/jpeg",
			},
		]);
		expect(fakeHost.send).toHaveBeenCalledWith({
			sessionId: "resolved-session-1",
			prompt: "Continue",
			userImages: ["data:image/jpeg;base64,def456"],
		});

		if (!subscribedListener) {
			throw new Error("Expected runtime to subscribe to host events.");
		}
		const emitResolvedEvent = subscribedListener as (event: unknown) => void;

		emitResolvedEvent({
			type: "agent_event",
			payload: {
				sessionId: "resolved-session-1",
				event: {
					type: "done",
					reason: "completed",
				},
			},
		});

		expect(onTaskEvent).toHaveBeenCalledWith(
			"task-1",
			expect.objectContaining({
				type: "agent_event",
			}),
		);
		expect(requestedSessionId).not.toBe("resolved-session-1");
		expect(fakeHost.start).toHaveBeenCalledWith(
			expect.objectContaining({
				userImages: ["data:image/png;base64,abc123"],
				config: expect.objectContaining({
					execution: expect.objectContaining({
						maxConsecutiveMistakes: 6,
					}),
					logger: expect.objectContaining({
						debug: expect.any(Function),
						log: expect.any(Function),
						error: expect.any(Function),
					}),
				}),
			}),
		);
	});

	it("forwards queued delivery when sending follow-up input", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => undefined),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		await runtime.sendTaskSessionInput("task-1", "Queue this", undefined, undefined, "queue");

		expect(fakeHost.send).toHaveBeenCalledWith({
			sessionId: expect.stringMatching(/^task-1-/),
			prompt: "Queue this",
			userImages: undefined,
			delivery: "queue",
		});
	});

	it("restarts using the latest mode selected on follow-up input", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => undefined),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			mode: "act",
			systemPrompt: "You are a helpful coding assistant.",
		});
		await runtime.sendTaskSessionInput("task-1", "Switch to planning", "plan");
		await runtime.restartTaskSession({
			taskId: "task-1",
			prompt: "Continue after restart",
		});

		expect(fakeHost.start).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				config: expect.objectContaining({
					mode: "plan",
				}),
			}),
		);
	});

	it("uses filesystem-safe session ids when task ids include windows-invalid characters", async () => {
		let requestedSessionId: string | null = null;
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => {
				requestedSessionId = input.config?.sessionId ?? null;
				return {
					sessionId: input.config?.sessionId ?? "session-1",
					result: {},
				};
			}),
			send: vi.fn(async () => undefined),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "__home_agent__:workspace-1:cline",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(requestedSessionId).toBeTruthy();
		expect(requestedSessionId ?? "").not.toMatch(/[<>:"/\\|?*]/);
		expect(requestedSessionId ?? "").toMatch(/^__home_agent___workspace-1_cline-/);
	});

	it("clears the pending task binding when start fails", async () => {
		const fakeHost = {
			start: vi.fn(async () => {
				throw new Error("Maximum consecutive mistakes reached.");
			}),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await expect(
			runtime.startTaskSession({
				taskId: "task-1",
				cwd: "/tmp/worktree",
				prompt: "Investigate startup",
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				systemPrompt: "You are a helpful coding assistant.",
			}),
		).rejects.toThrow("Maximum consecutive mistakes reached.");

		expect(runtime.getTaskSessionId("task-1")).toBeNull();
	});

	it("clears the live task binding after the SDK emits ended", async () => {
		let subscribedListener: ((event: unknown) => void) | null = null;

		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn((listener: (event: unknown) => void) => {
				subscribedListener = listener;
				return () => {};
			}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(runtime.getTaskSessionId("task-1")).toBeTruthy();

		if (!subscribedListener) {
			throw new Error("Expected runtime to subscribe to host events.");
		}

		const liveSessionId = runtime.getTaskSessionId("task-1");
		(subscribedListener as (event: unknown) => void)({
			type: "ended",
			payload: {
				sessionId: liveSessionId,
				reason: "error",
				ts: Date.now(),
			},
		});

		expect(runtime.getTaskSessionId("task-1")).toBeNull();
	});

	it("deletes persisted task sessions when clearing a task session", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => [
				createPersistedRecord({
					sessionId: "task-1-old",
					status: "completed",
					startedAt: "2026-03-17T10:00:00.000Z",
					updatedAt: "2026-03-17T10:05:00.000Z",
				}),
				createPersistedRecord({
					sessionId: "task-2-old",
					status: "completed",
					startedAt: "2026-03-17T10:00:00.000Z",
					updatedAt: "2026-03-17T10:05:00.000Z",
				}),
			]),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});
		const liveSessionId = runtime.getTaskSessionId("task-1");
		expect(liveSessionId).toBeTruthy();

		await runtime.clearTaskSessions("task-1");

		expect(fakeHost.abort).toHaveBeenCalledWith(liveSessionId);
		expect(fakeHost.delete).toHaveBeenCalledWith("task-1-old");
		expect(fakeHost.delete).toHaveBeenCalledWith(liveSessionId);
		expect(fakeHost.delete).not.toHaveBeenCalledWith("task-2-old");
		expect(runtime.getTaskSessionId("task-1")).toBeNull();
	});

	it("reads persisted task history by scanning task-prefixed SDK session ids", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => [
				createPersistedRecord({
					sessionId: "task-1-older",
					status: "completed",
					startedAt: "2026-03-17T10:00:00.000Z",
					updatedAt: "2026-03-17T10:05:00.000Z",
				}),
				createPersistedRecord({
					sessionId: "task-1-newer",
					status: "completed",
					startedAt: "2026-03-17T10:10:00.000Z",
					updatedAt: "2026-03-17T10:15:00.000Z",
				}),
				createPersistedRecord({
					sessionId: "task-2-1",
					status: "completed",
					startedAt: "2026-03-17T09:00:00.000Z",
					updatedAt: "2026-03-17T09:05:00.000Z",
				}),
			]),
			readMessages: vi.fn(async () => [
				{
					role: "user" as const,
					content: "Recovered prompt",
				},
			]),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		const snapshot = await runtime.readPersistedTaskSession("task-1");

		expect(snapshot?.record.sessionId).toBe("task-1-newer");
		expect(snapshot?.messages).toEqual([
			{
				role: "user",
				content: "Recovered prompt",
			},
		]);
		expect(fakeHost.readMessages).toHaveBeenCalledWith("task-1-newer");
	});

	it("rebinds a task id to the latest persisted SDK session before resuming sends", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => [
				createPersistedRecord({
					sessionId: "task-1-newer",
					status: "completed",
					startedAt: "2026-03-17T10:10:00.000Z",
					updatedAt: "2026-03-17T10:15:00.000Z",
				}),
			]),
			readMessages: vi.fn(async () => [
				{
					role: "assistant" as const,
					content: "Recovered response",
				},
			]),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
		});

		const snapshot = await runtime.resumeTaskSession("task-1");

		expect(snapshot?.record.sessionId).toBe("task-1-newer");
		expect(runtime.getTaskSessionId("task-1")).toBe("task-1-newer");

		await runtime.sendTaskSessionInput("task-1", "Continue");
		expect(fakeHost.send).toHaveBeenCalledWith({
			sessionId: "task-1-newer",
			prompt: "Continue",
		});
	});

	it("disposes the shared host and clears task mappings", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			delete: vi.fn(async () => true),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
			createMcpRuntimeService: createNoopMcpRuntimeService,
		});

		await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(runtime.getTaskSessionId("task-1")).toBeTruthy();

		await runtime.dispose();

		expect(fakeHost.dispose).toHaveBeenCalledWith("kanban-runtime-dispose");
		expect(runtime.getTaskSessionId("task-1")).toBeNull();
	});
});
