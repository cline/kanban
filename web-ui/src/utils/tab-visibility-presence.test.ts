import { beforeEach, describe, expect, it } from "vitest";

import { hasVisibleKanbanTabForWorkspace, markTabVisible } from "@/utils/tab-visibility-presence";

describe("tab visibility presence", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("ignores the current tab when excluded", () => {
		markTabVisible("self-tab", "workspace-1");
		expect(hasVisibleKanbanTabForWorkspace("workspace-1")).toBe(true);
		expect(hasVisibleKanbanTabForWorkspace("workspace-1", "self-tab")).toBe(false);
	});

	it("still detects another visible tab in the same workspace", () => {
		markTabVisible("self-tab", "workspace-1");
		markTabVisible("other-tab", "workspace-1");
		expect(hasVisibleKanbanTabForWorkspace("workspace-1", "self-tab")).toBe(true);
	});
});
