import { describe, expect, it } from "vitest";

import { inferHookSourceFromPayload } from "../../src/commands/hooks.js";

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
