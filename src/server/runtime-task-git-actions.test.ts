import { describe, expect, it } from "vitest";

import { createRuntimeTaskGitActionCoordinator } from "./runtime-task-git-actions";

describe("createRuntimeTaskGitActionCoordinator", () => {
	it("blocks new git actions while auto-cleanup is armed", () => {
		const coordinator = createRuntimeTaskGitActionCoordinator();

		expect(coordinator.beginTaskGitAction("workspace-1", "task-1", "commit")).toBe(true);
		coordinator.completeTaskGitAction("workspace-1", "task-1", "commit", {
			dispatched: true,
			armAutoCleanup: true,
		});

		expect(coordinator.getAutoCleanupTaskGitAction("workspace-1", "task-1")).toBe("commit");
		expect(coordinator.isTaskGitActionBlocked("workspace-1", "task-1")).toBe(true);
		expect(coordinator.beginTaskGitAction("workspace-1", "task-1", "pr")).toBe(false);
	});

	it("allows new git actions after auto-cleanup state is cleared", () => {
		const coordinator = createRuntimeTaskGitActionCoordinator();

		expect(coordinator.beginTaskGitAction("workspace-1", "task-1", "commit")).toBe(true);
		coordinator.completeTaskGitAction("workspace-1", "task-1", "commit", {
			dispatched: true,
			armAutoCleanup: true,
		});
		coordinator.clearTaskGitAction("workspace-1", "task-1");

		expect(coordinator.isTaskGitActionBlocked("workspace-1", "task-1")).toBe(false);
		expect(coordinator.beginTaskGitAction("workspace-1", "task-1", "pr")).toBe(true);
	});
});
