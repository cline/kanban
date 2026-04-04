import { describe, expect, it } from "vitest";

import { buildPiWrapperChildArgs } from "../../src/commands/hooks";

describe("buildPiWrapperChildArgs", () => {
	it("injects a session dir when one is not provided", () => {
		const args = buildPiWrapperChildArgs(["hi"], "/tmp/pi-session");

		expect(args).toEqual(["--session-dir", "/tmp/pi-session", "hi"]);
		expect(args.join(" ")).not.toContain("--mode json");
	});

	it("does not override an explicit session dir", () => {
		expect(buildPiWrapperChildArgs(["--session-dir", "/tmp/custom", "hi"], "/tmp/pi-session")).toEqual([
			"--session-dir",
			"/tmp/custom",
			"hi",
		]);
	});
});
