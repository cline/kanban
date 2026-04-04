import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import { shutdownRuntimeServer } from "../../src/server/shutdown-coordinator";
import { loadWorkspaceState, saveWorkspaceState } from "../../src/state/workspace-state";
import type { TerminalSessionManager } from "../../src/terminal/session-manager";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-shutdown-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
}

function createCard(taskId: string) {
	return {
		id: taskId,
		title: `Task ${taskId}`,
		prompt: `Task ${taskId}`,
		startInPlanMode: false,
		baseRef: "main",
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

function createBoard(taskIds: { inProgress?: string[]; review?: string[] }): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "in_progress",
				title: "In Progress",
				cards: (taskIds.inProgress ?? []).map((taskId) => createCard(taskId)),
			},
			{
				id: "review",
				title: "Review",
				cards: (taskIds.review ?? []).map((taskId) => createCard(taskId)),
			},
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createSession(taskId: string, state: "running" | "awaiting_review" | "idle"): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "codex",
		workspacePath: `/tmp/${taskId}`,
		pid: state === "idle" ? null : 1234,
		startedAt: state === "idle" ? null : Date.now() - 1_000,
		updatedAt: Date.now(),
		lastOutputAt: state === "idle" ? null : Date.now(),
		reviewReason: state === "awaiting_review" ? "hook" : null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

describe.sequential("shutdown coordinator integration", () => {
	it("moves all in-progress and review cards to trash for every indexed project on shutdown", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-shutdown-scope-");
			try {
				const managedProjectPath = join(sandboxRoot, "managed-project");
				const indexedProjectPath = join(sandboxRoot, "indexed-project");
				mkdirSync(managedProjectPath, { recursive: true });
				mkdirSync(indexedProjectPath, { recursive: true });
				initGitRepository(managedProjectPath);
				initGitRepository(indexedProjectPath);

				const managedInitial = await loadWorkspaceState(managedProjectPath);
				await saveWorkspaceState(managedProjectPath, {
					board: createBoard({
						inProgress: ["managed-running", "managed-missing-session"],
						review: ["managed-idle"],
					}),
					sessions: {
						"managed-running": createSession("managed-running", "running"),
						"managed-idle": createSession("managed-idle", "idle"),
					},
					expectedRevision: managedInitial.revision,
				});

				const indexedInitial = await loadWorkspaceState(indexedProjectPath);
				await saveWorkspaceState(indexedProjectPath, {
					board: createBoard({
						inProgress: ["indexed-missing-session"],
						review: ["indexed-awaiting-review"],
					}),
					sessions: {
						"indexed-awaiting-review": createSession("indexed-awaiting-review", "awaiting_review"),
					},
					expectedRevision: indexedInitial.revision,
				});

				let didCloseRuntimeServer = false;
				const managedTerminalManager = {
					markInterruptedAndStopAll: () => [createSession("managed-running", "running")],
					listSummaries: () => [createSession("managed-running", "running")],
					getSummary: (taskId: string) => {
						if (taskId === "managed-running") {
							return createSession("managed-running", "running");
						}
						if (taskId === "managed-idle") {
							return createSession("managed-idle", "idle");
						}
						return null;
					},
				} as unknown as TerminalSessionManager;
				await shutdownRuntimeServer({
					workspaceRegistry: {
						listManagedWorkspaces: () => [
							{
								workspaceId: "managed-project",
								workspacePath: managedProjectPath,
								terminalManager: managedTerminalManager,
							},
						],
					},
					warn: () => {},
					closeRuntimeServer: async () => {
						didCloseRuntimeServer = true;
					},
				});

				expect(didCloseRuntimeServer).toBe(true);

				const managedAfter = await loadWorkspaceState(managedProjectPath);
				const managedTrash = managedAfter.board.columns.find((column) => column.id === "trash")?.cards ?? [];
				expect(managedTrash.map((card) => card.id).sort()).toEqual(
					["managed-idle", "managed-missing-session", "managed-running"].sort(),
				);
				expect(managedAfter.sessions["managed-running"]?.state).toBe("interrupted");
				expect(managedAfter.sessions["managed-idle"]?.state).toBe("interrupted");
				expect(managedAfter.sessions["managed-missing-session"]).toBeUndefined();

				const indexedAfter = await loadWorkspaceState(indexedProjectPath);
				const indexedTrash = indexedAfter.board.columns.find((column) => column.id === "trash")?.cards ?? [];
				expect(indexedTrash.map((card) => card.id).sort()).toEqual(
					["indexed-awaiting-review", "indexed-missing-session"].sort(),
				);
				expect(indexedAfter.sessions["indexed-awaiting-review"]?.state).toBe("interrupted");
				expect(indexedAfter.sessions["indexed-missing-session"]).toBeUndefined();
			} finally {
				cleanup();
			}
		});
	}, 30_000);
});
