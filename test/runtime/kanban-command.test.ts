import { afterEach, describe, expect, it } from "vitest";

import { buildKanbanCommandParts, resolveKanbanCommandParts } from "../../src/core/kanban-command";

describe("resolveKanbanCommandParts", () => {
	afterEach(() => {
		delete process.env.KANBAN_CLI_COMMAND;
	});

	it("resolves node plus script entrypoint", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanban/dist/cli.js", "--port", "9123"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanban/dist/cli.js"]);
	});

	it("resolves tsx launched cli entrypoint", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts", "--no-open"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts"]);
	});

	it("preserves node execArgv for source entrypoints", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			execArgv: ["--import", "tsx"],
			argv: ["/usr/local/bin/node", "/repo/src/cli.ts", "--no-open"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "--import", "tsx", "/repo/src/cli.ts"]);
	});

	it("falls back to execPath when no entrypoint path is available", () => {
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/kanban",
			argv: ["/usr/local/bin/kanban", "hooks", "ingest"],
		});
		expect(parts).toEqual(["/usr/local/bin/kanban"]);
	});

	// -----------------------------------------------------------------------
	// KANBAN_CLI_COMMAND env var override (desktop / explicit context)
	// -----------------------------------------------------------------------

	it("uses KANBAN_CLI_COMMAND env var when set", () => {
		process.env.KANBAN_CLI_COMMAND = "kanban";
		const parts = resolveKanbanCommandParts({
			// Simulate Electron helper path — should be completely ignored.
			execPath: "/Applications/Kanban.app/Contents/Frameworks/Kanban Helper.app/Contents/MacOS/Kanban Helper",
			argv: [
				"/Applications/Kanban.app/Contents/Frameworks/Kanban Helper.app/Contents/MacOS/Kanban Helper",
				"/Applications/Kanban.app/Contents/Resources/app.asar.unpacked/dist/runtime-child-entry.js",
			],
		});
		expect(parts).toEqual(["kanban"]);
	});

	it("splits multi-word KANBAN_CLI_COMMAND into parts", () => {
		process.env.KANBAN_CLI_COMMAND = "npx -y kanban";
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node"],
		});
		expect(parts).toEqual(["npx", "-y", "kanban"]);
	});

	it("trims whitespace from KANBAN_CLI_COMMAND", () => {
		process.env.KANBAN_CLI_COMMAND = "  kanban  ";
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node"],
		});
		expect(parts).toEqual(["kanban"]);
	});

	it("ignores empty KANBAN_CLI_COMMAND and falls back to inference", () => {
		process.env.KANBAN_CLI_COMMAND = "   ";
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/kanban",
			argv: ["/usr/local/bin/kanban", "hooks", "ingest"],
		});
		// Empty string is falsy after trim → falls through to inference.
		expect(parts).toEqual(["/usr/local/bin/kanban"]);
	});

	it("env var takes priority over any process context", () => {
		process.env.KANBAN_CLI_COMMAND = "/custom/path/to/kanban";
		const parts = resolveKanbanCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/some/entrypoint.js"],
		});
		expect(parts).toEqual(["/custom/path/to/kanban"]);
	});
});

describe("buildKanbanCommandParts", () => {
	afterEach(() => {
		delete process.env.KANBAN_CLI_COMMAND;
	});

	it("appends command arguments to resolved runtime invocation", () => {
		expect(
			buildKanbanCommandParts(["hooks", "ingest"], {
				execPath: "/usr/local/bin/node",
				argv: ["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/cli.js"],
			}),
		).toEqual(["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/cli.js", "hooks", "ingest"]);
	});

	it("appends args when KANBAN_CLI_COMMAND is set", () => {
		process.env.KANBAN_CLI_COMMAND = "kanban";
		expect(
			buildKanbanCommandParts(["task", "create", "--prompt", "test"], {
				execPath: "/Applications/Kanban.app/Contents/Frameworks/Kanban Helper.app/Contents/MacOS/Kanban Helper",
				argv: ["/irrelevant"],
			}),
		).toEqual(["kanban", "task", "create", "--prompt", "test"]);
	});
});
