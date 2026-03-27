import { describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract.js";
import { createRuntimeStateHub } from "../../../src/server/runtime-state-hub.js";
import type { TerminalSessionManager } from "../../../src/terminal/session-manager.js";

function createSummary(
	taskId: string,
	overrides: Partial<RuntimeTaskSessionSummary> = {},
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: "claude",
		workspacePath: "/tmp/workspace",
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

describe("createRuntimeStateHub", () => {
	it("fires task-ready notifications for terminal-backed sessions that enter awaiting_review", async () => {
		const onTaskReadyForReview = vi.fn();
		let summaryListener: ((summary: RuntimeTaskSessionSummary) => void) | undefined;
		const manager = {
			listSummaries: () => [] as RuntimeTaskSessionSummary[],
			onSummary: (listener: (summary: RuntimeTaskSessionSummary) => void) => {
				summaryListener = listener;
				return () => {
					summaryListener = undefined;
				};
			},
		} as unknown as TerminalSessionManager;

		const hub = createRuntimeStateHub({
			workspaceRegistry: {
				resolveWorkspaceForStream: async () =>
					({
						workspaceId: null,
						workspacePath: null,
						removedRequestedWorkspacePath: null,
						didPruneProjects: false,
					}),
				buildProjectsPayload: async () => ({
					currentProjectId: null,
					projects: [],
				}),
				buildWorkspaceStateSnapshot: async () =>
					({
						repoPath: "/tmp/workspace",
						statePath: "/tmp/workspace/.kanban/state.json",
						git: {
							currentBranch: "main",
							defaultBranch: "main",
							branches: ["main"],
						},
						board: {
							columns: [],
							dependencies: [],
						},
						sessions: {},
						revision: 0,
					}),
			} as never,
			onTaskReadyForReview,
		});

		hub.trackTerminalManager("workspace-1", manager);
		summaryListener?.(
			createSummary("task-1", {
				state: "running",
			}),
		);
		summaryListener?.(
			createSummary("task-1", {
				state: "awaiting_review",
				reviewReason: "hook",
			}),
		);

		expect(onTaskReadyForReview).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: "task-1",
		});

		await hub.close();
	});
});
