import { describe, expect, it, vi } from "vitest";

import { createInMemoryClineTaskSessionService } from "../../../src/cline-sdk/cline-task-session-service.js";

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

describe("InMemoryClineTaskSessionService", () => {
	it("starts a cline session and captures initial prompt as a user message", async () => {
		const service = createInMemoryClineTaskSessionService();

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
		const service = createInMemoryClineTaskSessionService();
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
		};
		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionHostPromise: Promise<unknown> | null;
			};
		};
		serviceInternal.sessionRuntime.sessionHostPromise = Promise.resolve(fakeHost);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Investigate startup",
		});
		await vi.waitFor(() => {
			expect(fakeHost.start).toHaveBeenCalledTimes(1);
		});

		expect(fakeHost.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					providerId: "anthropic",
					systemPrompt: expect.stringContaining("You are Cline, an AI coding agent."),
				}),
			}),
		);
	});

	it("appends Kanban sidebar instructions for home sessions", async () => {
		const service = createInMemoryClineTaskSessionService();
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
		};
		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionHostPromise: Promise<unknown> | null;
			};
		};
		serviceInternal.sessionRuntime.sessionHostPromise = Promise.resolve(fakeHost);

		await service.startTaskSession({
			taskId: "__home_agent__:workspace-1:cline:abc123",
			cwd: "/tmp/worktree",
			prompt: "Add a task",
		});
		await vi.waitFor(() => {
			expect(fakeHost.start).toHaveBeenCalledTimes(1);
		});

		expect(fakeHost.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: expect.stringContaining("You are Cline, an AI coding agent."),
				}),
			}),
		);
		expect(fakeHost.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: expect.stringContaining("Kanban sidebar agent"),
				}),
			}),
		);
		expect(fakeHost.start).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					systemPrompt: expect.stringContaining("kanban task create"),
				}),
			}),
		);
	});

	it("stores follow-up user input and keeps session running", async () => {
		const service = createInMemoryClineTaskSessionService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		const nextSummary = await service.sendTaskSessionInput("task-1", "Continue\n");

		expect(nextSummary?.state).toBe("running");
		expect(service.listMessages("task-1").map((message) => message.content)).toEqual(["Initial prompt", "Continue"]);
	});

	it("marks session interrupted when stopped", async () => {
		const service = createInMemoryClineTaskSessionService();
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
		const service = createInMemoryClineTaskSessionService();
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
		};
		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionHostPromise: Promise<unknown> | null;
				sessionIdByTaskId: Map<string, string>;
				taskIdBySessionId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionHostPromise = Promise.resolve(fakeHost);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "Initial prompt",
		});

		const canceled = await service.cancelTaskTurn("task-1");
		expect(canceled?.state).toBe("idle");
		expect(canceled?.reviewReason).toBeNull();
		expect(canceled?.latestHookActivity?.activityText).toBe("Turn canceled");

		const sessionId = serviceInternal.sessionRuntime.sessionIdByTaskId.get("task-1") ?? "session-1";
		serviceInternal.sessionRuntime.taskIdBySessionId.set(sessionId, "task-1");
		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId,
				event: {
					type: "done",
					reason: "aborted",
				},
			},
		});

		expect(service.getSummary("task-1")?.state).toBe("idle");
		expect(service.getSummary("task-1")?.reviewReason).toBeNull();
	});

	it("uses agent_event text deltas for streaming and ignores serialized agent chunks", async () => {
		const service = createInMemoryClineTaskSessionService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionIdByTaskId: Map<string, string>;
				taskIdBySessionId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionIdByTaskId.set("task-1", "session-1");
		serviceInternal.sessionRuntime.taskIdBySessionId.set("session-1", "task-1");

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "text",
					text: "Hello",
					accumulated: "Hello",
				},
			},
		});

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "chunk",
			payload: {
				sessionId: "session-1",
				stream: "agent",
				chunk: '{"type":"content_start","contentType":"text","text":"SHOULD_NOT_RENDER"}',
				ts: Date.now(),
			},
		});

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "text",
					text: " world",
					accumulated: "Hello world",
				},
			},
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);

		expect(assistantMessages).toEqual(["Hello world"]);
	});

	it("streams reasoning and tool lifecycle messages with stable ids", async () => {
		const service = createInMemoryClineTaskSessionService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionIdByTaskId: Map<string, string>;
				taskIdBySessionId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionIdByTaskId.set("task-1", "session-1");
		serviceInternal.sessionRuntime.taskIdBySessionId.set("session-1", "task-1");

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "reasoning",
					reasoning: "Thinking",
				},
			},
		});
		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "reasoning",
					reasoning: "...",
				},
			},
		});
		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "Read",
					input: { file: "a.ts" },
				},
			},
		});
		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "Read",
					output: { ok: true },
					durationMs: 25,
				},
			},
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
		const service = createInMemoryClineTaskSessionService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionIdByTaskId: Map<string, string>;
				taskIdBySessionId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionIdByTaskId.set("task-1", "session-1");
		serviceInternal.sessionRuntime.taskIdBySessionId.set("session-1", "task-1");

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "ask_followup_question",
					input: { question: "Need approval" },
				},
			},
		});

		expect(service.getSummary("task-1")?.state).toBe("awaiting_review");
		expect(service.getSummary("task-1")?.reviewReason).toBe("hook");

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "tool",
					toolCallId: "tool-1",
					toolName: "ask_followup_question",
					output: { ok: true },
				},
			},
		});

		expect(service.getSummary("task-1")?.state).toBe("running");
		expect(service.getSummary("task-1")?.reviewReason).toBeNull();
	});

	it("moves to awaiting_review when SDK emits done for a completed turn", async () => {
		const service = createInMemoryClineTaskSessionService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionIdByTaskId: Map<string, string>;
				taskIdBySessionId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionIdByTaskId.set("task-1", "session-1");
		serviceInternal.sessionRuntime.taskIdBySessionId.set("session-1", "task-1");

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "done",
					reason: "completed",
					text: "Done. Added the comment.",
				},
			},
		});

		const summary = service.getSummary("task-1");
		expect(summary?.state).toBe("awaiting_review");
		expect(summary?.reviewReason).toBe("hook");
		expect(summary?.latestHookActivity?.hookEventName).toBe("agent_end");
		expect(summary?.latestHookActivity?.finalMessage).toBe("Done. Added the comment.");
	});

	it("creates task entry and session mapping before start() resolves", async () => {
		const service = createInMemoryClineTaskSessionService();
		const startDeferred = createDeferred<{ sessionId: string; result: unknown }>();
		const fakeHost = {
			start: vi.fn(async () => await startDeferred.promise),
			send: vi.fn(async () => ({})),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
		};
		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionHostPromise: Promise<unknown> | null;
				sessionIdByTaskId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionHostPromise = Promise.resolve(fakeHost);

		const summary = await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "start",
		});

		expect(summary.state).toBe("running");
		const mappedSessionId = serviceInternal.sessionRuntime.sessionIdByTaskId.get("task-1");
		expect(mappedSessionId).toBeTruthy();

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: mappedSessionId,
				event: {
					type: "content_start",
					contentType: "text",
					text: "Streaming",
					accumulated: "Streaming",
				},
			},
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
		const service = createInMemoryClineTaskSessionService();
		const sendDeferred = createDeferred<unknown>();
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => await sendDeferred.promise),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
		};
		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionHostPromise: Promise<unknown> | null;
			};
		};
		serviceInternal.sessionRuntime.sessionHostPromise = Promise.resolve(fakeHost);

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
		expect(fakeHost.send).toHaveBeenCalledTimes(1);
		sendDeferred.resolve({ text: "done" });
	});

	it("does not duplicate assistant output when stream and send result both include final text", async () => {
		const service = createInMemoryClineTaskSessionService();
		const sendDeferred = createDeferred<unknown>();
		const fakeHost = {
			start: vi.fn(async (input: { config?: { sessionId?: string } }) => ({
				sessionId: input.config?.sessionId ?? "session-1",
				result: {},
			})),
			send: vi.fn(async () => await sendDeferred.promise),
			stop: vi.fn(async () => {}),
			abort: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
			subscribe: vi.fn(() => () => {}),
		};
		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionHostPromise: Promise<unknown> | null;
				sessionIdByTaskId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionHostPromise = Promise.resolve(fakeHost);

		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		await service.sendTaskSessionInput("task-1", "Continue");
		const sessionId = serviceInternal.sessionRuntime.sessionIdByTaskId.get("task-1") ?? "session-1";

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId,
				event: {
					type: "content_start",
					contentType: "text",
					text: "Done.",
					accumulated: "Done.",
				},
			},
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
		const service = createInMemoryClineTaskSessionService();
		await service.startTaskSession({
			taskId: "task-1",
			cwd: "/tmp/worktree",
			prompt: "",
		});

		const serviceInternal = service as unknown as {
			sessionRuntime: {
				sessionIdByTaskId: Map<string, string>;
				taskIdBySessionId: Map<string, string>;
				handleSessionEvent: (event: unknown) => void;
			};
		};
		serviceInternal.sessionRuntime.sessionIdByTaskId.set("task-1", "session-1");
		serviceInternal.sessionRuntime.taskIdBySessionId.set("session-1", "task-1");

		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_start",
					contentType: "text",
					text: "Done.",
					accumulated: "Done.",
				},
			},
		});
		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "content_end",
					contentType: "text",
					text: "Done.",
				},
			},
		});
		serviceInternal.sessionRuntime.handleSessionEvent({
			type: "agent_event",
			payload: {
				sessionId: "session-1",
				event: {
					type: "done",
					reason: "completed",
					text: "Done.",
				},
			},
		});

		const assistantMessages = service
			.listMessages("task-1")
			.filter((message) => message.role === "assistant")
			.map((message) => message.content);
		expect(assistantMessages).toEqual(["Done."]);
	});
});
