import { describe, expect, it, vi } from "vitest";

import type { RuntimeWorkspaceStateResponse } from "../core/api-contract";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { shutdownRuntimeServer } from "./shutdown-coordinator";

const listWorkspaceIndexEntriesMock = vi.hoisted(() => vi.fn(async () => []));
const loadWorkspaceStateMock = vi.hoisted(() => vi.fn());
const saveWorkspaceStateMock = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../state/workspace-state", () => ({
	listWorkspaceIndexEntries: listWorkspaceIndexEntriesMock,
	loadWorkspaceState: loadWorkspaceStateMock,
	saveWorkspaceState: saveWorkspaceStateMock,
}));

function createWorkspaceState(): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/tmp/project",
		statePath: "/tmp/project/.cline/kanban/workspaces/project",
		git: {
			currentBranch: "main",
			defaultBranch: "main",
			branches: ["main"],
		},
		board: {
			columns: [
				{
					id: "backlog",
					title: "Backlog",
					cards: [],
				},
				{
					id: "in_progress",
					title: "In Progress",
					cards: [
						{
							id: "task-running",
							title: "Running task",
							prompt: "Running task",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 1,
							updatedAt: 1,
						},
					],
				},
				{
					id: "review",
					title: "Review",
					cards: [
						{
							id: "task-review",
							title: "Review task",
							prompt: "Review task",
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: 2,
							updatedAt: 2,
						},
					],
				},
				{
					id: "trash",
					title: "Trash",
					cards: [],
				},
			],
			dependencies: [],
		},
		sessions: {
			"task-running": {
				taskId: "task-running",
				state: "running",
				agentId: "claude",
				workspacePath: "/tmp/project",
				pid: 1234,
				startedAt: 1,
				updatedAt: 1,
				lastOutputAt: 1,
				reviewReason: null,
				exitCode: null,
				lastHookAt: null,
				latestHookActivity: null,
				latestTurnCheckpoint: null,
				previousTurnCheckpoint: null,
			},
			"task-review": {
				taskId: "task-review",
				state: "awaiting_review",
				agentId: "claude",
				workspacePath: "/tmp/project",
				pid: 2345,
				startedAt: 2,
				updatedAt: 2,
				lastOutputAt: 2,
				reviewReason: "attention",
				exitCode: null,
				lastHookAt: null,
				latestHookActivity: null,
				latestTurnCheckpoint: null,
				previousTurnCheckpoint: null,
			},
		},
		revision: 1,
	};
}

describe("shutdownRuntimeServer", () => {
	it("marks interrupted sessions in place without moving tasks to trash", async () => {
		const workspaceState = createWorkspaceState();
		loadWorkspaceStateMock.mockResolvedValue(workspaceState);
		const runningSession = workspaceState.sessions["task-running"];
		const reviewSession = workspaceState.sessions["task-review"];
		if (!runningSession || !reviewSession) {
			throw new Error("Expected seeded session summaries.");
		}

		const terminalManager = {
			markInterruptedAndStopAll: () => [runningSession, reviewSession],
			listSummaries: () => [runningSession, reviewSession],
			getSummary: (taskId: string) => workspaceState.sessions[taskId] ?? null,
		} as unknown as TerminalSessionManager;

		await shutdownRuntimeServer({
			workspaceRegistry: {
				listManagedWorkspaces: () => [
					{
						workspaceId: "project",
						workspacePath: workspaceState.repoPath,
						terminalManager,
					},
				],
			},
			warn: () => {},
			closeRuntimeServer: async () => {},
		});

		expect(saveWorkspaceStateMock).toHaveBeenCalledTimes(1);
		expect(saveWorkspaceStateMock).toHaveBeenCalledWith(
			workspaceState.repoPath,
			expect.objectContaining({
				board: workspaceState.board,
				sessions: expect.objectContaining({
					"task-running": expect.objectContaining({
						state: "interrupted",
						reviewReason: "interrupted",
						pid: null,
					}),
					"task-review": expect.objectContaining({
						state: "interrupted",
						reviewReason: "interrupted",
						pid: null,
					}),
				}),
			}),
		);
	});
});
