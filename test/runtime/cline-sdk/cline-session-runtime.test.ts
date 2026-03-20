import { describe, expect, it, vi } from "vitest";

import { createInMemoryClineSessionRuntime } from "../../../src/cline-sdk/cline-session-runtime.js";

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

describe("InMemoryClineSessionRuntime", () => {
	it("routes host events through the pending requested session id before start resolves", async () => {
		const startDeferred = createDeferred<{ sessionId: string; result: unknown }>();
		const onTaskEvent = vi.fn();
		let subscribedListener: ((event: unknown) => void) | null = null;
		let requestedSessionId: string | null = null;

		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => {
				requestedSessionId = input.config?.sessionId ?? null;
				return await startDeferred.promise;
			}),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
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
			onTaskEvent,
		});

		const startResult = await runtime.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			systemPrompt: "You are a helpful coding assistant.",
		});

		expect(startResult.sessionId).toBe("resolved-session-1");
		expect(runtime.getTaskSessionId("task-1")).toBe("resolved-session-1");

		await runtime.sendTaskSessionInput("task-1", "Continue");
		expect(fakeHost.send).toHaveBeenCalledWith({
			sessionId: "resolved-session-1",
			prompt: "Continue",
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
				config: expect.objectContaining({
					maxConsecutiveMistakes: 3,
				}),
			}),
		);
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
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => [
				{
					sessionId: "task-1-older",
					status: "completed",
					startedAt: "2026-03-17T10:00:00.000Z",
					updatedAt: "2026-03-17T10:05:00.000Z",
				},
				{
					sessionId: "task-1-newer",
					status: "completed",
					startedAt: "2026-03-17T10:10:00.000Z",
					updatedAt: "2026-03-17T10:15:00.000Z",
				},
				{
					sessionId: "task-2-1",
					status: "completed",
					startedAt: "2026-03-17T09:00:00.000Z",
					updatedAt: "2026-03-17T09:05:00.000Z",
				},
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

	it("disposes the shared host and clears task mappings", async () => {
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			get: vi.fn(async () => undefined),
			list: vi.fn(async () => []),
			readMessages: vi.fn(async () => []),
			subscribe: vi.fn(() => () => {}),
		};

		const runtime = createInMemoryClineSessionRuntime({
			createSessionHost: async () => fakeHost,
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
