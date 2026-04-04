import { describe, expect, it } from "vitest";

import * as kanban from "../../src/index";

describe("package root exports", () => {
	it("exports workspace-state helpers used by desktop interrupted-task detection", () => {
		expect(typeof kanban.listWorkspaceIndexEntries).toBe("function");
		expect(typeof kanban.loadWorkspaceState).toBe("function");
	});
});
