import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const requireFromHere = createRequire(import.meta.url);

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

describe("cli compatibility flags", () => {
	it("accepts the deprecated --agent flag as a no-op", () => {
		const result = spawnSync(
			process.execPath,
			[
				"--import",
				resolveTsxLoaderImportSpecifier(),
				resolve(process.cwd(), "src/cli.ts"),
				"--agent",
				"legacy-alias-value",
				"--help",
			],
			{
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toContain("--port");
		expect(result.stdout).not.toContain("--agent");
		expect(result.stdout).not.toContain("Agent IDs:");
	});

	it("exposes daemon process commands and shared launch flags", () => {
		const result = spawnSync(
			process.execPath,
			["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/cli.ts"), "--help"],
			{
				encoding: "utf8",
			},
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain("start [options]");
		expect(result.stdout).toContain("stop [pid]");
		expect(result.stdout).toContain("restart [options] [pid]");
		expect(result.stdout).toContain("status [options]");

		const startHelp = spawnSync(
			process.execPath,
			["--import", resolveTsxLoaderImportSpecifier(), resolve(process.cwd(), "src/cli.ts"), "start", "--help"],
			{
				encoding: "utf8",
			},
		);
		expect(startHelp.status).toBe(0);
		expect(startHelp.stdout).toContain("--port");
		expect(startHelp.stdout).toContain("--https");
		expect(startHelp.stdout).toContain("--no-passcode");
	});
});
