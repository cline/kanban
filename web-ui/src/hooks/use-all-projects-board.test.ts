import { describe, expect, it } from "vitest";
import { buildAllProjectsBoardSnapshot } from "@/hooks/use-all-projects-board";
import type { RuntimeProjectSummary, RuntimeWorkspaceStateResponse } from "@/runtime/types";

function createProject(id: string, name: string): RuntimeProjectSummary {
	return {
		id,
		name,
		path: `/tmp/${id}`,
		taskCounts: {
			backlog: 1,
			in_progress: 0,
			review: 0,
			trash: 0,
		},
	};
}

function createWorkspaceState(taskId: string, prompt: string, updatedAt: number): RuntimeWorkspaceStateResponse {
	return {
		repoPath: "/tmp/project",
		statePath: "/tmp/project/.kanban/state.json",
		revision: 1,
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
					cards: [
						{
							id: taskId,
							prompt,
							startInPlanMode: false,
							autoReviewEnabled: false,
							autoReviewMode: "commit",
							baseRef: "main",
							createdAt: updatedAt,
							updatedAt,
						},
					],
				},
				{ id: "in_progress", title: "In Progress", cards: [] },
				{ id: "review", title: "Review", cards: [] },
				{ id: "trash", title: "Trash", cards: [] },
			],
			dependencies: [],
		},
		sessions: {
			[taskId]: {
				taskId,
				state: "idle",
				agentId: null,
				workspacePath: null,
				pid: null,
				startedAt: null,
				updatedAt,
				lastOutputAt: null,
				reviewReason: null,
				exitCode: null,
				lastHookAt: null,
				latestHookActivity: null,
				latestTurnCheckpoint: null,
				previousTurnCheckpoint: null,
				warningMessage: null,
			},
		},
	};
}

describe("buildAllProjectsBoardSnapshot", () => {
	it("adds project metadata and unique ids for aggregated cards", () => {
		const projectA = createProject("project-a", "Alpha");
		const projectB = createProject("project-b", "Beta");
		const snapshot = buildAllProjectsBoardSnapshot([projectA, projectB], {
			[projectA.id]: createWorkspaceState("task-1", "Task from alpha", 10),
			[projectB.id]: createWorkspaceState("task-1", "Task from beta", 20),
		});

		const backlogCards = snapshot.board.columns.find((column) => column.id === "backlog")?.cards ?? [];
		expect(backlogCards).toHaveLength(2);
		expect(backlogCards[0]).toMatchObject({
			id: "project-b:task-1",
			projectId: "project-b",
			projectName: "Beta",
			projectTaskId: "task-1",
		});
		expect(backlogCards[1]).toMatchObject({
			id: "project-a:task-1",
			projectId: "project-a",
			projectName: "Alpha",
			projectTaskId: "task-1",
		});
		expect(snapshot.taskSessions["project-a:task-1"]?.taskId).toBe("project-a:task-1");
		expect(snapshot.taskSessions["project-b:task-1"]?.taskId).toBe("project-b:task-1");
	});
});
