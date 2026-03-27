import { describe, expect, it } from "vitest";

import { buildCodexWrapperChildArgs } from "../../src/commands/hooks.js";

describe("buildCodexWrapperChildArgs", () => {
	it("injects notify config when session log watching is enabled", () => {
		const args = buildCodexWrapperChildArgs(["exec", "fix the bug"], true);

		expect(args[0]).toBe("-c");
		expect(args[1]).toContain("notify=");
		expect(args[1]).toContain("hooks");
		expect(args[1]).toContain("to_review");
		expect(args.slice(2)).toEqual(["exec", "fix the bug"]);
	});

	it("injects notify config when session log watching is unavailable", () => {
		const args = buildCodexWrapperChildArgs(["exec", "fix the bug"], false);

		expect(args[0]).toBe("-c");
		expect(args[1]).toContain("notify=");
		expect(args[1]).toContain("hooks");
		expect(args[1]).toContain("to_review");
		expect(args.slice(2)).toEqual(["exec", "fix the bug"]);
	});
});
