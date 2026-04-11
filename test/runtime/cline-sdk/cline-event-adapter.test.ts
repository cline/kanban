import { describe, expect, it } from "vitest";
import { applyClineSessionEvent } from "../../../src/cline-sdk/cline-event-adapter";
import {
	type ClineTaskMessage,
	type ClineTaskSessionEntry,
	createDefaultSummary,
} from "../../../src/cline-sdk/cline-session-state";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

function createEntry(taskId: string): ClineTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map<string, string>(),
		toolInputByToolCallId: new Map<string, unknown>(),
	};
}

function applyEvent(input: {
	taskId?: string;
	entry?: ClineTaskSessionEntry;
	event: unknown;
	pendingTurnCancelTaskIds?: Set<string>;
	isClineProvider?: boolean;
}) {
	const taskId = input.taskId ?? "task-1";
	const entry = input.entry ?? createEntry(taskId);
	const summaries: RuntimeTaskSessionSummary[] = [];
	const messages: ClineTaskMessage[] = [];
	const pendingTurnCancelTaskIds = input.pendingTurnCancelTaskIds ?? new Set<string>();

	applyClineSessionEvent({
		event: input.event,
		taskId,
		entry,
		pendingTurnCancelTaskIds,
		isClineProvider: input.isClineProvider ?? true,
		emitSummary: (summary) => {
			summaries.push(summary);
		},
		emitMessage: (_taskId, message) => {
			messages.push(message);
		},
	});

	return {
		entry,
		summaries,
		messages,
		pendingTurnCancelTaskIds,
	};
}

describe("applyClineSessionEvent", () => {
	it("streams assistant text deltas into the active assistant message", () => {
		const entry = createEntry("task-1");

		const firstPass = applyEvent({
			entry,
			event: {
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
			},
		});

		const secondPass = applyEvent({
			entry,
			event: {
				type: "chunk",
				payload: {
					sessionId: "session-1",
					stream: "agent",
					chunk: " world",
				},
			},
		});

		expect(firstPass.messages).toHaveLength(1);
		expect(secondPass.messages).toHaveLength(1);
		expect(entry.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
		expect(entry.messages[0]?.content).toBe("Hello world");
		expect(secondPass.summaries.at(-1)?.state).toBe("running");
		expect(secondPass.summaries.at(-1)?.latestHookActivity?.hookEventName).toBe("assistant_delta");
		expect(secondPass.summaries.at(-1)?.latestHookActivity?.finalMessage).toBe("world");
	});

	it("keeps the full streamed assistant message in summary metadata", () => {
		const entry = createEntry("task-1");
		const longText = `${"Detailed handoff sentence ".repeat(12)}tail`;

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "text",
						text: longText,
						accumulated: longText,
					},
				},
			},
		});

		const latestHookActivity = result.summaries.at(-1)?.latestHookActivity;
		expect(latestHookActivity?.finalMessage).toBe(longText.trim());
		expect(latestHookActivity?.activityText?.length ?? 0).toBeLessThan(latestHookActivity?.finalMessage?.length ?? 0);
		expect(latestHookActivity?.activityText).toContain("…");
	});

	it("transitions into and back out of awaiting review around user-attention tools", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const toolStart = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolCallId: "tool-1",
						toolName: "ask_followup_question",
						input: { question: "Need approval?" },
					},
				},
			},
		});

		expect(toolStart.entry.summary.state).toBe("awaiting_review");
		expect(toolStart.entry.summary.reviewReason).toBe("hook");
		expect(toolStart.messages[0]?.role).toBe("tool");
		expect(toolStart.summaries.at(-1)?.latestHookActivity?.activityText).toBe(
			"Using ask_followup_question(Need approval?)",
		);
		expect(toolStart.summaries.at(-1)?.latestHookActivity?.toolInputSummary).toBe("Need approval?");

		const toolEnd = applyEvent({
			entry,
			event: {
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
			},
		});

		expect(toolEnd.entry.summary.state).toBe("running");
		expect(toolEnd.entry.summary.reviewReason).toBeNull();
		expect(toolEnd.messages[0]?.meta?.hookEventName).toBe("tool_call_end");
		expect(toolEnd.summaries.at(-1)?.latestHookActivity?.activityText).toBe(
			"Completed ask_followup_question(Need approval?)",
		);
	});

	it("retains the last tool label while assistant text streams after a tool call", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolCallId: "tool-1",
						toolName: "Read",
						input: { file_path: "src/index.ts" },
					},
				},
			},
		});

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "text",
						text: "Looking at the file now",
						accumulated: "Looking at the file now",
					},
				},
			},
		});

		expect(result.summaries.at(-1)?.latestHookActivity?.hookEventName).toBe("assistant_delta");
		expect(result.summaries.at(-1)?.latestHookActivity?.toolName).toBe("Read");
		expect(result.summaries.at(-1)?.latestHookActivity?.toolInputSummary).toBe("src/index.ts");
	});

	it("summarizes read_files tool calls from the SDK files payload", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "content_start",
						contentType: "tool",
						toolCallId: "tool-1",
						toolName: "read_files",
						input: {
							files: [{ path: "src/index.ts", start_line: 3, end_line: 8 }, { path: "src/app.ts" }],
						},
					},
				},
			},
		});

		expect(result.summaries.at(-1)?.latestHookActivity?.activityText).toBe(
			"Using read_files(src/index.ts:3-8, src/app.ts)",
		);
		expect(result.summaries.at(-1)?.latestHookActivity?.toolInputSummary).toBe("src/index.ts:3-8, src/app.ts");
	});

	it("converts aborted done events with pending cancel state back to idle", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";
		const pendingTurnCancelTaskIds = new Set<string>(["task-1"]);

		const result = applyEvent({
			entry,
			pendingTurnCancelTaskIds,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "done",
						reason: "aborted",
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("idle");
		expect(result.entry.summary.reviewReason).toBeNull();
		expect(result.pendingTurnCancelTaskIds.has("task-1")).toBe(false);
		expect(result.summaries.at(-1)?.latestHookActivity?.hookEventName).toBe("turn_canceled");
	});

	it("moves completed done events into awaiting review with the final message attached", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "done",
						reason: "completed",
						text: "Done. Added the comment.",
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.reviewReason).toBe("hook");
		expect(result.entry.summary.latestHookActivity?.finalMessage).toBe("Done. Added the comment.");
		expect(result.messages[0]?.role).toBe("assistant");
		expect(result.messages[0]?.content).toBe("Done. Added the comment.");
	});

	it("keeps the previous preview when done events have no final text", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";
		entry.summary.latestHookActivity = {
			activityText: "Reviewing the final diff",
			toolName: "Read",
			toolInputSummary: "src/index.ts",
			finalMessage: "Reviewing the final diff",
			hookEventName: "assistant_delta",
			notificationType: null,
			source: "cline-sdk",
		};

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "done",
						reason: "completed",
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.reviewReason).toBe("hook");
		expect(result.entry.summary.latestHookActivity?.activityText).toBe("Reviewing the final diff");
		expect(result.entry.summary.latestHookActivity?.toolName).toBe("Read");
		expect(result.entry.summary.latestHookActivity?.toolInputSummary).toBe("src/index.ts");
		expect(result.entry.summary.latestHookActivity?.hookEventName).toBe("agent_end");
	});

	it("keeps awaiting-review sessions in review when a stale running status event arrives", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "awaiting_review";
		entry.summary.reviewReason = "attention";

		const result = applyEvent({
			entry,
			event: {
				type: "status",
				payload: {
					sessionId: "session-1",
					status: "running",
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.reviewReason).toBe("attention");
		expect(result.summaries.at(-1)?.state).toBe("awaiting_review");
	});

	it("surfaces recoverable agent errors in the summary without failing the task", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "error",
						error: new Error('Missing API key for provider "cline".'),
						recoverable: true,
						iteration: 1,
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("running");
		expect(result.entry.summary.reviewReason).toBeNull();
		expect(result.entry.summary.latestHookActivity?.hookEventName).toBe("agent_error");
		expect(result.entry.summary.latestHookActivity?.activityText).toContain("Retrying after error");
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("system");
		expect(result.messages[0]?.content).toContain("Retrying:");
		expect(result.messages[0]?.content).toContain("Missing API key");
	});

	it("sets credit_limit notificationType and suppresses warningMessage for insufficient-balance errors from SDK", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "error",
						error: new Error("402 Insufficient balance. Your Cline Credits balance is $0.00"),
						recoverable: false,
						iteration: 1,
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.reviewReason).toBe("error");
		expect(result.entry.summary.warningMessage).toBeNull();
		expect(result.entry.summary.latestHookActivity?.notificationType).toBe("credit_limit");
		expect(result.messages).toHaveLength(0);
	});

	it("preserves credit-limit metadata when a later done event closes the turn", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "awaiting_review";
		entry.summary.reviewReason = "error";
		entry.summary.latestHookActivity = {
			activityText: "Agent error: 402 Insufficient balance",
			toolName: null,
			toolInputSummary: null,
			finalMessage: "402 Insufficient balance. Your Cline Credits balance is $0.00",
			hookEventName: "agent_error",
			notificationType: "credit_limit",
			source: "cline-sdk",
		};

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "done",
						reason: "aborted",
					},
				},
			},
		});

		expect(result.entry.summary.latestHookActivity?.hookEventName).toBe("agent_end");
		expect(result.entry.summary.latestHookActivity?.notificationType).toBe("credit_limit");
	});

	it("forces credit-limit errors to non-recoverable even when SDK marks them recoverable", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "error",
						error: new Error("402 Insufficient balance. Your Cline Credits balance is $0.00"),
						recoverable: true,
						iteration: 1,
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.reviewReason).toBe("error");
		expect(result.entry.summary.warningMessage).toBeNull();
		expect(result.entry.summary.latestHookActivity?.notificationType).toBe("credit_limit");
		expect(result.messages).toHaveLength(0);
	});

	it("suppresses recovery notices containing credit-limit text", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "notice",
						message:
							"The previous turn failed with 402 Insufficient balance. Retry and continue from the latest state",
						displayRole: "system",
						reason: "recovery",
					},
				},
			},
		});

		expect(result.messages).toHaveLength(0);
		expect(result.summaries).toHaveLength(0);
	});

	it("passes through credit-limit notices when reason is absent", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "notice",
						message: "402 Insufficient balance. Your Cline Credits balance is $0.00",
						displayRole: "system",
					},
				},
			},
		});

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("system");
	});

	it("passes through non-recovery notices even when they contain credit-limit text", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "notice",
						message: "402 Insufficient balance. Your Cline Credits balance is $0.00",
						displayRole: "system",
						reason: "info",
					},
				},
			},
		});

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("system");
	});

	it("detects credit-limit from agentEvent.message when error is absent", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "error",
						error: undefined,
						message: "402 Insufficient balance for this request",
						recoverable: true,
						iteration: 1,
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.latestHookActivity?.notificationType).toBe("credit_limit");
		expect(result.entry.summary.warningMessage).toBeNull();
	});

	it("does not detect credit-limit errors for non-Cline providers", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";

		const result = applyEvent({
			entry,
			isClineProvider: false,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "error",
						error: new Error("402 Insufficient balance. Your Cline Credits balance is $0.00"),
						recoverable: false,
						iteration: 1,
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.latestHookActivity?.notificationType).toBeNull();
		expect(result.entry.summary.warningMessage).toBe("402 Insufficient balance. Your Cline Credits balance is $0.00");
	});

	it("keeps unrecoverable agent errors resumable", () => {
		const entry = createEntry("task-1");
		entry.summary.state = "running";
		entry.activeAssistantMessageId = "assistant-1";

		const result = applyEvent({
			entry,
			event: {
				type: "agent_event",
				payload: {
					sessionId: "session-1",
					event: {
						type: "error",
						error: new Error("Unauthorized"),
						recoverable: false,
						iteration: 1,
					},
				},
			},
		});

		expect(result.entry.summary.state).toBe("awaiting_review");
		expect(result.entry.summary.reviewReason).toBe("error");
		expect(result.entry.summary.warningMessage).toBe("Unauthorized");
		expect(result.entry.summary.latestHookActivity?.finalMessage).toBe("Unauthorized");
		expect(result.entry.activeAssistantMessageId).toBeNull();
	});
});
