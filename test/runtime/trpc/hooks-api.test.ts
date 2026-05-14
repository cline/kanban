import { describe, expect, it, vi } from "vitest";

import type { RuntimeTaskHookActivity, RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import type { TerminalSessionManager } from "../../../src/terminal/session-manager";
import { createHooksApi } from "../../../src/trpc/hooks-api";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

function createHookActivity(overrides: Partial<RuntimeTaskHookActivity> = {}): RuntimeTaskHookActivity {
	return {
		activityText: null,
		toolName: null,
		toolInputSummary: null,
		finalMessage: null,
		hookEventName: null,
		notificationType: null,
		source: null,
		...overrides,
	};
}

function createAwaitingReviewSummary(
	reviewReason: RuntimeTaskSessionSummary["reviewReason"],
	hookEventName: string | null,
): RuntimeTaskSessionSummary {
	return createSummary({
		state: "awaiting_review",
		reviewReason,
		latestHookActivity: hookEventName !== null ? createHookActivity({ hookEventName }) : null,
	});
}

describe("createHooksApi", () => {
	it("treats ineligible hook transitions as successful no-ops", async () => {
		const manager = {
			getSummary: vi.fn(() => createSummary({ state: "running" })),
			transitionToReview: vi.fn(),
			transitionToRunning: vi.fn(),
			applyHookActivity: vi.fn(),
		} as unknown as TerminalSessionManager;

		const api = createHooksApi({
			getWorkspacePathById: vi.fn(() => "/tmp/repo"),
			ensureTerminalManagerForWorkspace: vi.fn(async () => manager),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastTaskReadyForReview: vi.fn(),
		});

		const response = await api.ingest({
			taskId: "task-1",
			workspaceId: "workspace-1",
			event: "to_in_progress",
		});

		expect(response).toEqual({ ok: true });
		expect(manager.transitionToRunning).not.toHaveBeenCalled();
		expect(manager.transitionToReview).not.toHaveBeenCalled();
	});

	it("stores activity metadata without changing session state", async () => {
		const manager = {
			getSummary: vi.fn(() => createSummary({ state: "running" })),
			transitionToReview: vi.fn(),
			transitionToRunning: vi.fn(),
			applyHookActivity: vi.fn(),
			applyTurnCheckpoint: vi.fn(),
		} as unknown as TerminalSessionManager;

		const api = createHooksApi({
			getWorkspacePathById: vi.fn(() => "/tmp/repo"),
			ensureTerminalManagerForWorkspace: vi.fn(async () => manager),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastTaskReadyForReview: vi.fn(),
		});

		const response = await api.ingest({
			taskId: "task-1",
			workspaceId: "workspace-1",
			event: "activity",
			metadata: {
				source: "claude",
				activityText: "Using Read",
			},
		});

		expect(response).toEqual({ ok: true });
		expect(manager.transitionToRunning).not.toHaveBeenCalled();
		expect(manager.transitionToReview).not.toHaveBeenCalled();
		expect(manager.applyHookActivity).toHaveBeenCalledWith("task-1", {
			source: "claude",
			activityText: "Using Read",
		});
	});

	it("captures a turn checkpoint when transitioning to review", async () => {
		const transitionedSummary = createSummary({
			state: "awaiting_review",
			reviewReason: "hook",
			latestTurnCheckpoint: {
				turn: 2,
				ref: "refs/kanban/checkpoints/task-1/turn/2",
				commit: "2222222",
				createdAt: 1,
			},
			previousTurnCheckpoint: {
				turn: 1,
				ref: "refs/kanban/checkpoints/task-1/turn/1",
				commit: "1111111",
				createdAt: 1,
			},
		});

		const manager = {
			getSummary: vi.fn(() => createSummary({ state: "running" })),
			transitionToReview: vi.fn(() => transitionedSummary),
			transitionToRunning: vi.fn(),
			applyHookActivity: vi.fn(),
			applyTurnCheckpoint: vi.fn(),
		} as unknown as TerminalSessionManager;

		const captureTaskTurnCheckpoint = vi.fn(async () => ({
			turn: 3,
			ref: "refs/kanban/checkpoints/task-1/turn/3",
			commit: "3333333",
			createdAt: Date.now(),
		}));
		const deleteTaskTurnCheckpointRef = vi.fn(async () => undefined);

		const api = createHooksApi({
			getWorkspacePathById: vi.fn(() => "/tmp/repo"),
			ensureTerminalManagerForWorkspace: vi.fn(async () => manager),
			broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
			broadcastTaskReadyForReview: vi.fn(),
			captureTaskTurnCheckpoint,
			deleteTaskTurnCheckpointRef,
		});

		const response = await api.ingest({
			taskId: "task-1",
			workspaceId: "workspace-1",
			event: "to_review",
		});

		expect(response).toEqual({ ok: true });
		expect(captureTaskTurnCheckpoint).toHaveBeenCalledWith({
			cwd: "/tmp/worktree",
			taskId: "task-1",
			turn: 3,
		});
		expect(manager.applyTurnCheckpoint).toHaveBeenCalledTimes(1);
		expect(deleteTaskTurnCheckpointRef).toHaveBeenCalledWith({
			cwd: "/tmp/worktree",
			ref: "refs/kanban/checkpoints/task-1/turn/1",
		});
	});

	describe("to_in_progress guard for hook-triggered reviews", () => {
		function makeManager(summary: RuntimeTaskSessionSummary) {
			return {
				getSummary: vi.fn(() => summary),
				transitionToReview: vi.fn(),
				transitionToRunning: vi.fn(() => summary),
				applyHookActivity: vi.fn(),
			} as unknown as TerminalSessionManager;
		}

		async function ingestToInProgress(summary: RuntimeTaskSessionSummary) {
			const manager = makeManager(summary);
			const api = createHooksApi({
				getWorkspacePathById: vi.fn(() => "/tmp/repo"),
				ensureTerminalManagerForWorkspace: vi.fn(async () => manager),
				broadcastRuntimeWorkspaceStateUpdated: vi.fn(),
				broadcastTaskReadyForReview: vi.fn(),
			});

			const response = await api.ingest({
				taskId: "task-1",
				workspaceId: "workspace-1",
				event: "to_in_progress",
			});

			return { response, manager };
		}

		it("blocks to_in_progress when reviewReason=hook and latestHookActivity.hookEventName=TaskComplete", async () => {
			const summary = createAwaitingReviewSummary("hook", "TaskComplete");
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).not.toHaveBeenCalled();
		});

		it("blocks to_in_progress when reviewReason=hook and latestHookActivity.hookEventName=stop", async () => {
			const summary = createAwaitingReviewSummary("hook", "stop");
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).not.toHaveBeenCalled();
		});

		it("blocks to_in_progress when reviewReason=hook and latestHookActivity.hookEventName=afteragent", async () => {
			const summary = createAwaitingReviewSummary("hook", "afteragent");
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).not.toHaveBeenCalled();
		});

		it("blocks to_in_progress when reviewReason=hook and latestHookActivity.hookEventName=subagentstop", async () => {
			const summary = createAwaitingReviewSummary("hook", "subagentstop");
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).not.toHaveBeenCalled();
		});

		it("allows to_in_progress when reviewReason=hook and latestHookActivity.hookEventName=PreToolUse (ask_followup_question)", async () => {
			const summary = createAwaitingReviewSummary("hook", "PreToolUse");
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).toHaveBeenCalled();
		});

		it("allows to_in_progress when reviewReason=hook and latestHookActivity=null (backward compat)", async () => {
			const summary = createAwaitingReviewSummary("hook", null);
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).toHaveBeenCalled();
		});

		it("allows to_in_progress when reviewReason=attention (user returned)", async () => {
			const summary = createAwaitingReviewSummary("attention", null);
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).toHaveBeenCalled();
		});

		it("allows to_in_progress when reviewReason=error (error recovery)", async () => {
			const summary = createAwaitingReviewSummary("error", null);
			const { response, manager } = await ingestToInProgress(summary);
			expect(response).toEqual({ ok: true });
			expect(manager.transitionToRunning).toHaveBeenCalled();
		});
	});
});
