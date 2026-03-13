import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { describe, expect, it } from "vitest";

import { detectTaskStartSetupAvailability } from "../../../src/terminal/task-start-setup-detection.js";
import { createTempDir } from "../../utilities/temp-dir.js";

function withTemporaryEnv<T>(
	input: {
		home: string;
		pathPrefix?: string;
		replacePath?: boolean;
	},
	run: () => T,
): T {
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	const previousPath = process.env.PATH;
	process.env.HOME = input.home;
	process.env.USERPROFILE = input.home;
	if (input.pathPrefix) {
		process.env.PATH = input.replacePath
			? input.pathPrefix
			: previousPath
				? `${input.pathPrefix}${delimiter}${previousPath}`
				: input.pathPrefix;
	}
	try {
		return run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		if (input.pathPrefix) {
			if (previousPath === undefined) {
				delete process.env.PATH;
			} else {
				process.env.PATH = previousPath;
			}
		}
	}
}

function writeFakeCommand(binDir: string, command: string): void {
	mkdirSync(binDir, { recursive: true });
	if (process.platform === "win32") {
		writeFileSync(join(binDir, `${command}.cmd`), "@echo off\r\nexit /b 0\r\n", "utf8");
		return;
	}
	const scriptPath = join(binDir, command);
	writeFileSync(scriptPath, "#!/bin/sh\nexit 0\n", "utf8");
	chmodSync(scriptPath, 0o755);
}

describe.sequential("detectTaskStartSetupAvailability", () => {
	it("detects gh and codex MCP entries from the selected agent config", () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-task-start-setup-home-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-task-start-setup-bin-");

		try {
			mkdirSync(join(tempHome, ".codex"), { recursive: true });
			writeFileSync(
				join(tempHome, ".codex", "config.toml"),
				["[mcp_servers.linear]", 'url = "https://mcp.linear.app/mcp"'].join("\n"),
				"utf8",
			);
			writeFakeCommand(tempBin, "gh");

			const availability = withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, () =>
				detectTaskStartSetupAvailability("codex"),
			);

			expect(availability).toEqual({
				githubCli: true,
				linearMcp: true,
			});
		} finally {
			cleanupBin();
			cleanupHome();
		}
	});

	it("parses OpenCode jsonc and nested Claude MCP server definitions", () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-task-start-setup-home-");
		const { path: tempBin, cleanup: cleanupBin } = createTempDir("kanban-task-start-setup-bin-");

		try {
			mkdirSync(join(tempHome, ".config", "opencode"), { recursive: true });
			writeFileSync(
				join(tempHome, ".config", "opencode", "opencode.jsonc"),
				["{", "  // local MCP servers", '  "mcp": {', '    "linear": { "type": "remote" }', "  }", "}"].join("\n"),
				"utf8",
			);
			writeFileSync(
				join(tempHome, ".claude.json"),
				JSON.stringify(
					{
						projects: {
							"/tmp/project": {
								mcpServers: {
									linear: {
										url: "https://mcp.linear.app/mcp",
									},
								},
							},
						},
					},
					null,
					2,
				),
				"utf8",
			);

			const opencodeAvailability = withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, () =>
				detectTaskStartSetupAvailability("opencode"),
			);
			expect(opencodeAvailability).toEqual({
				githubCli: false,
				linearMcp: true,
			});

			const claudeAvailability = withTemporaryEnv({ home: tempHome, pathPrefix: tempBin, replacePath: true }, () =>
				detectTaskStartSetupAvailability("claude"),
			);
			expect(claudeAvailability).toEqual({
				githubCli: false,
				linearMcp: true,
			});
		} finally {
			cleanupBin();
			cleanupHome();
		}
	});
});
