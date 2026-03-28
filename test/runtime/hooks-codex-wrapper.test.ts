import { describe, expect, it } from "vitest";

import { buildCodexWrapperChildArgs, buildCodexWrapperSpawn } from "../../src/commands/hooks";

describe("buildCodexWrapperChildArgs", () => {
	it("does not inject notify config when session log watching is enabled", () => {
		expect(buildCodexWrapperChildArgs(["exec", "fix the bug"], true)).toEqual(["exec", "fix the bug"]);
	});

	it("injects notify config when session log watching is unavailable", () => {
		const args = buildCodexWrapperChildArgs(["exec", "fix the bug"], false);

		expect(args[0]).toBe("-c");
		expect(args[1]).toContain("notify=");
		expect(args[1]).toContain("hooks");
		expect(args[1]).toContain("to_review");
		expect(args.slice(2)).toEqual(["exec", "fix the bug"]);
	});

	it("uses ComSpec on Windows for npm shim binaries", () => {
		const launch = buildCodexWrapperSpawn("codex", ["exec", "fix the bug"], true, "win32", {
			ComSpec: "C:\\Windows\\System32\\cmd.exe",
		});

		expect(launch.binary).toBe("C:\\Windows\\System32\\cmd.exe");
		expect(launch.args[0]).toBe("/d");
		expect(launch.args[1]).toBe("/s");
		expect(launch.args[2]).toBe("/c");
		expect(launch.args[3]).toContain("codex");
		expect(launch.args[3]).toContain("exec");
	});

	it("does not wrap cmd itself on Windows", () => {
		const launch = buildCodexWrapperSpawn("cmd.exe", ["/c", "echo hi"], true, "win32", {
			ComSpec: "C:\\Windows\\System32\\cmd.exe",
		});

		expect(launch.binary).toBe("cmd.exe");
		expect(launch.args).toEqual(["/c", "echo hi"]);
	});
});
