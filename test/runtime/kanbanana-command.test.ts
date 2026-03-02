import { describe, expect, it } from "vitest";

import { buildKanbananaCommandParts, resolveKanbananaCommandParts } from "../../src/runtime/kanbanana-command.js";

describe("resolveKanbananaCommandParts", () => {
	it("resolves node plus script entrypoint", () => {
		const parts = resolveKanbananaCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanbanana/dist/cli.js", "--port", "9123"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/tmp/.npx/123/node_modules/kanbanana/dist/cli.js"]);
	});

	it("resolves tsx launched cli entrypoint", () => {
		const parts = resolveKanbananaCommandParts({
			execPath: "/usr/local/bin/node",
			argv: ["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts", "--no-open"],
		});
		expect(parts).toEqual(["/usr/local/bin/node", "/repo/node_modules/tsx/dist/cli.mjs", "/repo/src/cli.ts"]);
	});

	it("falls back to execPath when no entrypoint path is available", () => {
		const parts = resolveKanbananaCommandParts({
			execPath: "/usr/local/bin/kanbanana",
			argv: ["/usr/local/bin/kanbanana", "hooks", "ingest"],
		});
		expect(parts).toEqual(["/usr/local/bin/kanbanana"]);
	});
});

describe("buildKanbananaCommandParts", () => {
	it("appends command arguments to resolved runtime invocation", () => {
		expect(
			buildKanbananaCommandParts(["hooks", "ingest"], {
				execPath: "/usr/local/bin/node",
				argv: ["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanbanana/dist/cli.js"],
			}),
		).toEqual(["/usr/local/bin/node", "/tmp/.npx/321/node_modules/kanbanana/dist/cli.js", "hooks", "ingest"]);
	});
});
