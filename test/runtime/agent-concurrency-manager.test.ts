import { describe, expect, it, vi } from "vitest";
import {
	type AgentConcurrencyManagerDeps,
	type QueuedTaskStartParams,
	createAgentConcurrencyManager,
} from "../../src/core/agent-concurrency-manager";

function createMockDeps(overrides?: Partial<AgentConcurrencyManagerDeps>): AgentConcurrencyManagerDeps {
	return {
		getBacklogTasks: overrides?.getBacklogTasks ?? vi.fn(async () => []),
		startTaskFromQueue: overrides?.startTaskFromQueue ?? vi.fn(async () => true),
	};
}

function createTaskParams(taskId: string, workspaceId = "ws-1", workspacePath = "/repo"): QueuedTaskStartParams {
	return {
		taskId,
		workspaceId,
		workspacePath,
		prompt: `Task ${taskId}`,
		baseRef: "main",
		startInPlanMode: false,
	};
}

describe("AgentConcurrencyManager", () => {
	describe("tryClaimSlot", () => {
		it("claims a slot when unlimited (default)", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			expect(manager.tryClaimSlot("task-1", "ws-1", "/repo")).toBe(true);
			expect(manager.isTaskActive("task-1")).toBe(true);
		});

		it("claims slots up to the max", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(2);

			expect(manager.tryClaimSlot("task-1", "ws-1", "/repo")).toBe(true);
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(true);
			expect(manager.tryClaimSlot("task-3", "ws-1", "/repo")).toBe(false);
		});

		it("rejects duplicate task IDs", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			expect(manager.tryClaimSlot("task-1", "ws-1", "/repo")).toBe(true);
			expect(manager.tryClaimSlot("task-1", "ws-1", "/repo")).toBe(false);
		});

		it("allows unlimited tasks when maxConcurrency is null", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(null);

			for (let i = 0; i < 100; i++) {
				expect(manager.tryClaimSlot(`task-${i}`, "ws-1", "/repo")).toBe(true);
			}
		});
	});

	describe("releaseSlot", () => {
		it("frees a slot so another task can claim it", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);

			expect(manager.tryClaimSlot("task-1", "ws-1", "/repo")).toBe(true);
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(false);

			manager.releaseSlot("task-1");
			expect(manager.isTaskActive("task-1")).toBe(false);
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(true);
		});

		it("is a no-op for unknown task IDs", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.releaseSlot("nonexistent");
			expect(manager.getStatus().active).toBe(0);
		});
	});

	describe("getStatus", () => {
		it("returns correct status with no limit", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			const status = manager.getStatus();
			expect(status.active).toBe(1);
			expect(status.max).toBeNull();
			expect(status.availableSlots).toBeNull();
			expect(status.activeTaskIds).toEqual(["task-1"]);
		});

		it("returns correct status with limit", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(3);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");
			manager.tryClaimSlot("task-2", "ws-1", "/repo");

			const status = manager.getStatus();
			expect(status.active).toBe(2);
			expect(status.max).toBe(3);
			expect(status.availableSlots).toBe(1);
		});
	});

	describe("updateMaxConcurrency", () => {
		it("allows increasing concurrency limit", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(false);

			manager.updateMaxConcurrency(3);
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(true);
		});

		it("setting to null removes the limit", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(false);

			manager.updateMaxConcurrency(null);
			expect(manager.tryClaimSlot("task-2", "ws-1", "/repo")).toBe(true);
		});
	});

	describe("notifyTaskStateChanged", () => {
		it("releases slot when task transitions from running to idle", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "idle");
			expect(manager.isTaskActive("task-1")).toBe(false);
			expect(manager.getStatus().active).toBe(0);
		});

		it("releases slot when task transitions from running to interrupted", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "interrupted");
			expect(manager.isTaskActive("task-1")).toBe(false);
		});

		it("releases slot when task transitions from awaiting_review to idle", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "awaiting_review", "idle");
			expect(manager.isTaskActive("task-1")).toBe(false);
		});

		it("does not release slot when task transitions from idle to running", () => {
			const manager = createAgentConcurrencyManager(createMockDeps());
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			// This is not a deactivation transition
			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "idle", "running");
			expect(manager.isTaskActive("task-1")).toBe(true);
		});

		it("triggers queue processing when a slot frees up", async () => {
			const startTaskFromQueue = vi.fn(async () => true);
			const backlogTask = createTaskParams("task-2");
			const getBacklogTasks = vi.fn(async () => [backlogTask]);

			const manager = createAgentConcurrencyManager(
				createMockDeps({ getBacklogTasks, startTaskFromQueue }),
			);
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "idle");

			// Allow the fire-and-forget processQueue to run
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(getBacklogTasks).toHaveBeenCalledWith("ws-1", "/repo");
			expect(startTaskFromQueue).toHaveBeenCalledWith(backlogTask);
		});

		it("does not trigger queue processing in unlimited mode", async () => {
			const getBacklogTasks = vi.fn(async () => []);

			const manager = createAgentConcurrencyManager(
				createMockDeps({ getBacklogTasks }),
			);
			// No concurrency limit set (unlimited mode)
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "idle");

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(getBacklogTasks).not.toHaveBeenCalled();
		});
	});

	describe("queue processing", () => {
		it("starts multiple backlog tasks when multiple slots open", async () => {
			const started: string[] = [];
			const startTaskFromQueue = vi.fn(async (params: QueuedTaskStartParams) => {
				started.push(params.taskId);
				return true;
			});
			const backlogTasks = [
				createTaskParams("task-3"),
				createTaskParams("task-4"),
				createTaskParams("task-5"),
			];
			const getBacklogTasks = vi.fn(async () => backlogTasks);

			const manager = createAgentConcurrencyManager(
				createMockDeps({ getBacklogTasks, startTaskFromQueue }),
			);
			manager.updateMaxConcurrency(3);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");
			manager.tryClaimSlot("task-2", "ws-1", "/repo");

			// Free up both slots
			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "idle");

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have started 2 tasks (was at 2/3, freed 1, so 1/3 available then 2 slots)
			// Actually: after releasing task-1, we have 1 active (task-2), max 3, so 2 slots available
			// It should start task-3 and task-4 (2 available slots)
			expect(started).toContain("task-3");
			expect(started).toContain("task-4");
			expect(started).not.toContain("task-5");
		});

		it("skips tasks that fail to start and continues with the next", async () => {
			let callCount = 0;
			const startTaskFromQueue = vi.fn(async (params: QueuedTaskStartParams) => {
				callCount++;
				if (params.taskId === "task-2") {
					throw new Error("start failed");
				}
				return true;
			});
			const getBacklogTasks = vi.fn(async () => [
				createTaskParams("task-2"),
				createTaskParams("task-3"),
			]);

			const manager = createAgentConcurrencyManager(
				createMockDeps({ getBacklogTasks, startTaskFromQueue }),
			);
			manager.updateMaxConcurrency(2);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "idle");

			await new Promise((resolve) => setTimeout(resolve, 100));

			// task-2 failed, task-3 should have been attempted
			expect(callCount).toBeGreaterThanOrEqual(2);
			expect(manager.isTaskActive("task-2")).toBe(false);
		});

		it("handles empty backlog gracefully", async () => {
			const getBacklogTasks = vi.fn(async () => []);
			const startTaskFromQueue = vi.fn(async () => true);

			const manager = createAgentConcurrencyManager(
				createMockDeps({ getBacklogTasks, startTaskFromQueue }),
			);
			manager.updateMaxConcurrency(1);
			manager.tryClaimSlot("task-1", "ws-1", "/repo");

			manager.notifyTaskStateChanged("task-1", "ws-1", "/repo", "running", "idle");

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(getBacklogTasks).toHaveBeenCalled();
			expect(startTaskFromQueue).not.toHaveBeenCalled();
		});
	});
});
