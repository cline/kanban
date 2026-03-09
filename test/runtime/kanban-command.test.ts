import { describe, expect, it } from "vitest";

import { buildKanbanCommandParts, resolveKanbanCommandParts } from "../../src/core/kanban-command.js";

describe("resolveKanbanCommandParts", () => {
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
});

describe("buildKanbanCommandParts", () => {
	it("appends command arguments to resolved runtime invocation", () => {
		expect(
			buildKanbanCommandParts(["hooks", "ingest"], {
				execPath: "/usr/local/bin/node",
				argv: ["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanban/dist/cli.js"],
			}),
		).toEqual([
			"/usr/local/bin/node",
			"/tmp/.npx/321/node_modules/kanban/dist/cli.js",
			"hooks",
			"ingest",
		]);
	});
});
