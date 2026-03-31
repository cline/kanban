import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createSubAgentPlugin, createTeamEventSink } from "../../src/agent-sync/kanban-agent-sync";
import { addTaskToColumn } from "../../src/core/task-board-mutations";
import { loadWorkspaceContext, loadWorkspaceState, mutateWorkspaceState } from "../../src/state/workspace-state";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

interface TeamTaskEventPayload extends Record<string, unknown> {
	type: "team_task_updated";
	task: {
		id: string;
		title: string;
		description: string;
		status: "pending" | "in_progress" | "blocked" | "completed";
		createdAt: Date;
		updatedAt: Date;
		createdBy: string;
		assignee?: string;
		dependsOn: string[];
		summary?: string;
	};
}

interface TeammateSpawnedEventPayload extends Record<string, unknown> {
	type: "teammate_spawned";
	agentId: string;
	role?: string;
	teammate: {
		rolePrompt: string;
		modelId?: string;
	};
}

interface TeamRunEventPayload extends Record<string, unknown> {
	type: "run_queued" | "run_started" | "run_completed";
	run: {
		id: string;
		agentId: string;
		status: "queued" | "running" | "completed";
		message: string;
		taskId?: string;
		currentActivity?: string;
		lastProgressMessage?: string;
	};
}

/**
 * Runs the callback with a temporary HOME so workspace-state writes stay isolated per test.
 */
async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-");
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

/**
 * Initializes a minimal git repository because workspace-state resolves repo metadata from git.
 */
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

/**
 * Waits until the assertion passes so async best-effort board sync can finish.
 */
async function waitForAssertion(assertion: () => void | Promise<void>, timeoutMs = 3_000): Promise<void> {
	const startedAt = Date.now();
	let lastError: unknown = null;
	while (Date.now() - startedAt < timeoutMs) {
		try {
			await assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
	}
	throw lastError instanceof Error ? lastError : new Error("Timed out waiting for assertion.");
}

/**
 * Builds a stable team-task event payload for board sync tests.
 */
function createTeamTaskEvent(taskId: string, status: TeamTaskEventPayload["task"]["status"]): TeamTaskEventPayload {
	const now = new Date();
	return {
		type: "team_task_updated",
		task: {
			id: taskId,
			title: "Investigate llms boundaries",
			description: "Inspect models and providers.",
			status,
			createdAt: now,
			updatedAt: now,
			createdBy: "manager",
			assignee: "models-analyst",
			dependsOn: [],
		},
	};
}

/**
 * Builds a teammate-spawned event payload for backlog card assertions.
 */
function createTeammateSpawnedEvent(agentId: string): TeammateSpawnedEventPayload {
	return {
		type: "teammate_spawned",
		agentId,
		role: "Models investigator",
		teammate: {
			rolePrompt: "Inspect models boundaries.",
			modelId: "gpt-5.4-mini",
		},
	};
}

/**
 * Builds a team-run lifecycle event payload for teammate-card movement assertions.
 */
function createTeamRunEvent(
	type: TeamRunEventPayload["type"],
	status: TeamRunEventPayload["run"]["status"],
): TeamRunEventPayload {
	return {
		type,
		run: {
			id: "run_00001",
			agentId: "models-investigator",
			status,
			message: "Inspect models boundaries.",
			taskId: "task_0001",
			currentActivity: type === "run_completed" ? "completed" : "investigating",
		},
	};
}

describe.sequential("kanban agent sync", () => {
	it("notifies listeners when a synced team task creates a board card", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-agent-sync-");
			try {
				const workspacePath = join(sandboxRoot, "project");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				await loadWorkspaceContext(workspacePath);

				const onBoardChanged = vi.fn(async () => undefined);
				const onTeamEvent = createTeamEventSink(workspacePath, { onBoardChanged });
				onTeamEvent(createTeamTaskEvent("task-123", "pending"));

				await waitForAssertion(async () => {
					const workspaceState = await loadWorkspaceState(workspacePath);
					expect(workspaceState.board.columns.find((column) => column.id === "backlog")?.cards).toEqual(
						expect.arrayContaining([expect.objectContaining({ id: "team-task-123" })]),
					);
					expect(onBoardChanged).toHaveBeenCalledTimes(1);
				});
			} finally {
				cleanup();
			}
		});
	});

	it("creates a teammate card in backlog and moves it to in progress when a run starts", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-team-run-sync-");
			try {
				const workspacePath = join(sandboxRoot, "project");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				await loadWorkspaceContext(workspacePath);

				const onBoardChanged = vi.fn(async () => undefined);
				const onTeamEvent = createTeamEventSink(workspacePath, { onBoardChanged });

				onTeamEvent(createTeammateSpawnedEvent("models-investigator"));
				await waitForAssertion(async () => {
					const workspaceState = await loadWorkspaceState(workspacePath);
					expect(workspaceState.board.columns.find((column) => column.id === "backlog")?.cards).toEqual(
						expect.arrayContaining([expect.objectContaining({ id: "teammate-models-investigator" })]),
					);
				});

				onTeamEvent(createTeamRunEvent("run_queued", "queued"));
				await waitForAssertion(async () => {
					const workspaceState = await loadWorkspaceState(workspacePath);
					expect(workspaceState.board.columns.find((column) => column.id === "in_progress")?.cards).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								id: "teammate-models-investigator",
								prompt: expect.stringContaining("Run: run_00001"),
							}),
						]),
					);
				});

				onTeamEvent(createTeamRunEvent("run_completed", "completed"));
				await waitForAssertion(async () => {
					const workspaceState = await loadWorkspaceState(workspacePath);
					expect(workspaceState.board.columns.find((column) => column.id === "backlog")?.cards).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								id: "teammate-models-investigator",
								prompt: expect.stringContaining("Status: completed"),
							}),
						]),
					);
					expect(onBoardChanged).toHaveBeenCalledTimes(3);
				});
			} finally {
				cleanup();
			}
		});
	});

	it("cleans up legacy split-model run cards when new team events arrive", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-team-run-cleanup-");
			try {
				const workspacePath = join(sandboxRoot, "project");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				await loadWorkspaceContext(workspacePath);

				const onBoardChanged = vi.fn(async () => undefined);
				const onTeamEvent = createTeamEventSink(workspacePath, { onBoardChanged });

				await mutateWorkspaceState(workspacePath, (state) => ({
					board: addTaskToColumn(
						state.board,
						"in_progress",
						{
							taskId: "team-run-run-00001",
							prompt: "Legacy run card",
							baseRef: "main",
							startInPlanMode: false,
						},
						() => "team-run-run-00001",
					).board,
					value: null,
				}));

				onTeamEvent(createTeammateSpawnedEvent("models-investigator"));

				await waitForAssertion(async () => {
					const workspaceState = await loadWorkspaceState(workspacePath);
					expect(
						workspaceState.board.columns.flatMap((column) => column.cards.map((card) => card.id)),
					).not.toContain("team-run-run-00001");
					expect(workspaceState.board.columns.find((column) => column.id === "backlog")?.cards).toEqual(
						expect.arrayContaining([expect.objectContaining({ id: "teammate-models-investigator" })]),
					);
				});
			} finally {
				cleanup();
			}
		});
	});

	it("notifies listeners when a spawned sub-agent card changes columns", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-sub-agent-sync-");
			try {
				const workspacePath = join(sandboxRoot, "project");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);
				await loadWorkspaceContext(workspacePath);

				const onBoardChanged = vi.fn(async () => undefined);
				const plugin = createSubAgentPlugin(workspacePath, { onBoardChanged });

				await plugin.handleSubAgentStart("root-session", {
					subAgentId: "models-analyst",
					conversationId: "conversation-1",
					parentAgentId: "home-agent",
					input: { task: "Inspect models/" },
				});
				await plugin.handleSubAgentEnd("root-session", {
					subAgentId: "models-analyst",
					conversationId: "conversation-1",
					parentAgentId: "home-agent",
					input: { task: "Inspect models/" },
					result: { text: "done", finishReason: "stop" },
				});

				const workspaceState = await loadWorkspaceState(workspacePath);
				expect(workspaceState.board.columns.find((column) => column.id === "trash")?.cards).toEqual(
					expect.arrayContaining([expect.objectContaining({ id: "agent-models-analyst" })]),
				);
				expect(onBoardChanged).toHaveBeenCalledTimes(2);
			} finally {
				cleanup();
			}
		});
	});
});
