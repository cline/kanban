import { describe, expect, it } from "vitest";

import { resolveDroidFinalMessageFromTranscriptText } from "../../src/commands/hook-events/droid-hook-events";
import { resolveGrokHookIngestEvent } from "../../src/commands/hook-events/grok-hook-events";
import { inferHookSourceFromPayload } from "../../src/commands/hooks";

describe("inferHookSourceFromPayload", () => {
	it("infers claude from unix transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.claude/projects/task/transcript.jsonl",
			}),
		).toBe("claude");
	});

	it("infers claude from windows transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.claude\\projects\\task\\transcript.jsonl",
			}),
		).toBe("claude");
	});

	it("infers droid from windows transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.factory\\logs\\session.jsonl",
			}),
		).toBe("droid");
	});

	it("infers droid from camelCase transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcriptPath: "/Users/dev/.factory/logs/session.jsonl",
			}),
		).toBe("droid");
	});

	it("infers kiro from transcript path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.kiro/hooks/session.jsonl",
			}),
		).toBe("kiro");
	});

	it("infers grok from unix session path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "/Users/dev/.grok/sessions/encoded/updates.jsonl",
			}),
		).toBe("grok");
	});

	it("infers grok from windows session path", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.grok\\sessions\\encoded\\updates.jsonl",
			}),
		).toBe("grok");
	});

	it("falls back to codex event type when transcript path does not infer a source", () => {
		expect(
			inferHookSourceFromPayload({
				type: "agent-turn-complete",
			}),
		).toBe("codex");
	});

	it("prefers transcript source over codex type fallback", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\.claude\\projects\\task\\transcript.jsonl",
				type: "agent-turn-complete",
			}),
		).toBe("claude");
	});

	it("returns null when no source can be inferred", () => {
		expect(
			inferHookSourceFromPayload({
				transcript_path: "C:\\Users\\dev\\logs\\session.jsonl",
			}),
		).toBeNull();
	});
});

describe("resolveDroidFinalMessageFromTranscriptText", () => {
	it("returns the latest assistant text message", () => {
		const transcriptText = [
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "First response" }],
				},
			}),
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Final summary of changes" }],
				},
			}),
		].join("\n");

		expect(resolveDroidFinalMessageFromTranscriptText(transcriptText)).toBe("Final summary of changes");
	});

	it("ignores non-assistant lines when finding the final message", () => {
		const transcriptText = [
			JSON.stringify({
				type: "message",
				message: {
					role: "assistant",
					content: [{ type: "text", text: "Implemented feature." }],
				},
			}),
			JSON.stringify({
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "thanks" }],
				},
			}),
		].join("\n");

		expect(resolveDroidFinalMessageFromTranscriptText(transcriptText)).toBe("Implemented feature.");
	});
});

describe("resolveGrokHookIngestEvent", () => {
	it("keeps Stop to_review for genuine turn completion", () => {
		expect(resolveGrokHookIngestEvent("to_review", { hook_event_name: "Stop", reason: "end_turn" }, "Stop")).toBe(
			"to_review",
		);
	});

	it("downgrades Stop to activity unless reason is end_turn", () => {
		expect(
			resolveGrokHookIngestEvent("to_review", { hook_event_name: "Stop", reason: "channel_closed" }, "Stop"),
		).toBe("activity");
		expect(resolveGrokHookIngestEvent("to_review", { hook_event_name: "Stop", reason: "shutdown" }, "Stop")).toBe(
			"activity",
		);
		expect(resolveGrokHookIngestEvent("to_review", { hook_event_name: "Stop" }, "Stop")).toBe("activity");
	});

	it("promotes permission StopCancelled to to_review", () => {
		expect(
			resolveGrokHookIngestEvent(
				"activity",
				{ hook_event_name: "StopCancelled", reason: "permission_rejected" },
				"StopCancelled",
			),
		).toBe("to_review");
		expect(
			resolveGrokHookIngestEvent(
				"activity",
				{ hook_event_name: "StopCancelled", reason: "permission_cancelled" },
				"StopCancelled",
			),
		).toBe("to_review");
	});
});
