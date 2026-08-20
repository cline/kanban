import { describe, expect, it } from "vitest";

import { parseCodexHookArguments } from "../../src/codex-hook-cli";

describe("parseCodexHookArguments", () => {
	it("parses generated hook options and payload", () => {
		expect(
			parseCodexHookArguments([
				'{"hook_event_name":"PreToolUse"}',
				"--event",
				"activity",
				"--source=codex",
				"--tool-name",
				"exec_command",
			]),
		).toEqual({
			event: "activity",
			options: {
				source: "codex",
				toolName: "exec_command",
			},
			payload: '{"hook_event_name":"PreToolUse"}',
		});
	});

	it("rejects invalid events", () => {
		expect(() => parseCodexHookArguments(["--event", "unknown"])).toThrow(
			"--event must be one of: to_review, to_in_progress, activity.",
		);
	});
});
