import { describe, expect, it } from "vitest";

import { createCodexWatcherState, parseCodexEventLine } from "../../src/commands/hooks";

function createCodexLogLine(message: Record<string, unknown>): string {
	return JSON.stringify({
		dir: "to_tui",
		kind: "codex_event",
		msg: message,
	});
}

function createCodexOpLine(payload: Record<string, unknown>): string {
	return JSON.stringify({
		dir: "from_tui",
		kind: "op",
		payload,
	});
}

describe("parseCodexEventLine", () => {
	it("keeps full codex activity text for long agent and final messages", () => {
		const state = createCodexWatcherState();
		const longAgentMessage =
			"This is a very long codex commentary message that should remain intact in the activity metadata without truncation when shown in the task card preview.";
		const longFinalMessage =
			"This is a very long final response that should remain intact in the activity metadata so expanding the task card preview can reveal the complete text.";

		const activityEvent = parseCodexEventLine(
			createCodexLogLine({
				type: "agent_message",
				message: longAgentMessage,
			}),
			state,
		);
		const reviewEvent = parseCodexEventLine(
			createCodexLogLine({
				type: "task_complete",
				last_agent_message: longFinalMessage,
			}),
			state,
		);

		expect(activityEvent).toEqual({
			event: "activity",
			metadata: {
				source: "codex",
				hookEventName: "agent_message",
				activityText: `Agent: ${longAgentMessage}`,
			},
		});
		expect(reviewEvent).toEqual({
			event: "to_review",
			metadata: {
				source: "codex",
				hookEventName: "task_complete",
				activityText: `Final: ${longFinalMessage}`,
				finalMessage: longFinalMessage,
			},
		});
	});

	it("keeps handling root events when no session metadata is present", () => {
		const state = createCodexWatcherState();

		const event = parseCodexEventLine(
			createCodexLogLine({
				type: "task_complete",
				last_agent_message: "Root complete",
			}),
			state,
		);

		expect(event).toEqual({
			event: "to_review",
			metadata: {
				source: "codex",
				hookEventName: "task_complete",
				activityText: "Final: Root complete",
				finalMessage: "Root complete",
			},
		});
	});

	it("marks waiting for review when codex completes without final text", () => {
		const state = createCodexWatcherState();

		const event = parseCodexEventLine(
			createCodexLogLine({
				type: "task_complete",
			}),
			state,
		);

		expect(event).toEqual({
			event: "to_review",
			metadata: {
				source: "codex",
				hookEventName: "task_complete",
				activityText: "Waiting for review",
				finalMessage: undefined,
			},
		});
	});

	it("ignores descendant session activity and completion", () => {
		const state = createCodexWatcherState();

		expect(
			parseCodexEventLine(
				createCodexLogLine({
					type: "session_meta",
					payload: {
						id: "root-session",
						source: "cli",
					},
				}),
				state,
			),
		).toBeNull();

		expect(
			parseCodexEventLine(
				createCodexLogLine({
					type: "session_meta",
					payload: {
						id: "child-session",
						source: {
							subagent: {
								thread_spawn: {
									parent_thread_id: "root-session",
									depth: 1,
								},
							},
						},
					},
				}),
				state,
			),
		).toBeNull();

		expect(
			parseCodexEventLine(
				createCodexLogLine({
					type: "agent_message",
					message: "Child progress update",
				}),
				state,
			),
		).toBeNull();

		expect(
			parseCodexEventLine(
				createCodexLogLine({
					type: "approval_request",
					id: "child-approval",
				}),
				state,
			),
		).toBeNull();

		expect(
			parseCodexEventLine(
				createCodexLogLine({
					type: "task_complete",
					last_agent_message: "Child complete",
				}),
				state,
			),
		).toBeNull();

		const rootEvent = parseCodexEventLine(
			createCodexLogLine({
				type: "task_complete",
				last_agent_message: "Root complete",
			}),
			state,
		);

		expect(rootEvent).toEqual({
			event: "to_review",
			metadata: {
				source: "codex",
				hookEventName: "task_complete",
				activityText: "Final: Root complete",
				finalMessage: "Root complete",
			},
		});
	});

	it("maps user_turn operations in modern session logs to in-progress", () => {
		const state = createCodexWatcherState();

		const event = parseCodexEventLine(
			createCodexOpLine({
				type: "user_turn",
				items: [{ type: "text", text: "continue" }],
			}),
			state,
		);

		expect(event).toEqual({
			event: "to_in_progress",
			metadata: {
				source: "codex",
				hookEventName: "user_turn",
				activityText: "Resumed after user input",
			},
		});
	});
});
