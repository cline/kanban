import { spawnSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeConfigState } from "../../src/config/runtime-config";
import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract";
import { createWorkspaceRegistry } from "../../src/server/workspace-registry";
import { loadWorkspaceState, saveWorkspaceState } from "../../src/state/workspace-state";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-workspace-registry-");
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

function createCard(taskId: string, agentId: RuntimeTaskSessionSummary["agentId"] = "codex") {
	return {
		id: taskId,
		title: `Task ${taskId}`,
		prompt: `Task ${taskId}`,
		startInPlanMode: false,
		baseRef: "main",
		agentId: agentId ?? undefined,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
}

function createBoard(): RuntimeBoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{
				id: "in_progress",
				title: "In Progress",
				cards: [createCard("summary-awaiting-review")],
			},
			{
				id: "review",
				title: "Review",
				cards: [createCard("board-review-stale-session")],
			},
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createSession(
	taskId: string,
	state: RuntimeTaskSessionSummary["state"],
	reviewReason: RuntimeTaskSessionSummary["reviewReason"],
): RuntimeTaskSessionSummary {
	return {
		taskId,
		state,
		agentId: "codex",
		workspacePath: `/tmp/${taskId}`,
		pid: state === "idle" ? null : 1234,
		startedAt: state === "idle" ? null : Date.now() - 1_000,
		updatedAt: Date.now(),
		lastOutputAt: state === "idle" ? null : Date.now(),
		reviewReason,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}

function createRuntimeConfigState(): RuntimeConfigState {
	return {
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: null,
		selectedAgentId: "codex",
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		readyForReviewNotificationsEnabled: true,
		shortcuts: [],
		commitPromptTemplate: "commit",
		openPrPromptTemplate: "pr",
		commitPromptTemplateDefault: "commit",
		openPrPromptTemplateDefault: "pr",
	};
}

describe.sequential("workspace registry persisted review repair", () => {
	it("repairs stale review persistence on startup", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-registry-");
			try {
				const projectPath = join(sandboxRoot, "project");
				mkdirSync(projectPath, { recursive: true });
				initGitRepository(projectPath);

				const initial = await loadWorkspaceState(projectPath);
				await saveWorkspaceState(projectPath, {
					board: createBoard(),
					sessions: {
						"board-review-stale-session": createSession("board-review-stale-session", "idle", null),
						"summary-awaiting-review": createSession("summary-awaiting-review", "awaiting_review", "hook"),
					},
					expectedRevision: initial.revision,
				});

				const registry = await createWorkspaceRegistry({
					cwd: projectPath,
					loadGlobalRuntimeConfig: async () => createRuntimeConfigState(),
					loadRuntimeConfig: async () => createRuntimeConfigState(),
					hasGitRepository: (path) => statSync(join(path, ".git")).isDirectory(),
					pathIsDirectory: async (path) => statSync(path).isDirectory(),
				});

				const workspaceId = registry.getActiveWorkspaceId();
				expect(workspaceId).toBeTruthy();

				const snapshot = await registry.buildWorkspaceStateSnapshot(workspaceId ?? "", projectPath);
				const repaired = await loadWorkspaceState(projectPath);

				const reviewIds = snapshot.board.columns
					.find((column) => column.id === "review")
					?.cards.map((card) => card.id)
					.sort();

				expect(reviewIds).toEqual(["board-review-stale-session", "summary-awaiting-review"]);
				expect(snapshot.sessions["board-review-stale-session"]?.state).toBe("awaiting_review");
				expect(snapshot.sessions["board-review-stale-session"]?.reviewReason).toBe("hook");
				expect(snapshot.sessions["summary-awaiting-review"]?.state).toBe("awaiting_review");
				expect(repaired.sessions["board-review-stale-session"]?.state).toBe("awaiting_review");
				expect(
					repaired.board.columns
						.find((column) => column.id === "review")
						?.cards.map((card) => card.id)
						.sort(),
				).toEqual(["board-review-stale-session", "summary-awaiting-review"]);
			} finally {
				cleanup();
			}
		});
	}, 30_000);
});
