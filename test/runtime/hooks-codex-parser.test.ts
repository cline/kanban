import { describe, expect, it } from "vitest";

import { createCodexWatcherState, parseCodexEventLine } from "../../src/commands/hooks.js";

function createCodexLogLine(message: Record<string, unknown>): string {
	return JSON.stringify({
		dir: "to_tui",
		kind: "codex_event",
		msg: message,
	});
}

describe("parseCodexEventLine", () => {
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

	it("omits the waiting placeholder when codex completes without final text", () => {
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
});
