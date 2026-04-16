import { describe, expect, it } from "vitest";
import { applyClineSessionEvent } from "../../../src/cline-sdk/cline-event-adapter";
import {
	type ClineTaskMessage,
	type ClineTaskSessionEntry,
	createDefaultSummary,
} from "../../../src/cline-sdk/cline-session-state";

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
	const summaries: any[] = [];
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

describe("Reproduction of Tool Call Argument Duplication", () => {
	it("should NOT append tool argument chunks to assistant message", () => {
		const entry = createEntry("task-1");
		const toolArgs = JSON.stringify({ files: [{ path: "/Users/mlapasa/workspaceAI/kanban-main/AppState.kt" }] });

		// 1. Simulate the SDK sending the tool arguments as a chunk
		applyEvent({
			entry,
			event: {
				type: "chunk",
				payload: {
					sessionId: "session-1",
					stream: "agent",
					chunk: toolArgs,
				},
			},
		});

		// 2. Simulate the SDK sending the structured tool call event
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
						toolName: "read_files",
						input: JSON.parse(toolArgs),
					},
				},
			},
		});

		// Check if the tool arguments were appended to the assistant's message
		const assistantMessages = entry.messages.filter((m) => m.role === "assistant");
		
		// If this fails, it means the chunk was appended, which is what causes the duplication in the SDK
		expect(assistantMessages).toHaveLength(0);
	});
});