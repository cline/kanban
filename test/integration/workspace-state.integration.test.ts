import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RuntimeBoardData, RuntimeTaskSessionSummary } from "../../src/core/api-contract.js";
import type { WorkspaceStateConflictError } from "../../src/state/workspace-state.js";
import {
	getWorkspacesRootPath,
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	removeWorkspaceIndexEntry,
	saveWorkspaceState,
} from "../../src/state/workspace-state.js";
import { createGitTestEnv } from "../utilities/git-env.js";
import { createTempDir } from "../utilities/temp-dir.js";

function createBoard(title: string): RuntimeBoardData {
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: Date.now(),
						updatedAt: Date.now(),
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createSessionSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		activityPreview: null,
		reviewReason: null,
		exitCode: null,
	};
}

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

describe.sequential("workspace-state integration", () => {
	it("persists revision numbers and rejects stale writes", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-");
			try {
				const workspacePath = join(sandboxRoot, "project-a");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const initial = await loadWorkspaceState(workspacePath);
				expect(initial.revision).toBe(0);

				const firstSave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task One"),
					sessions: {},
					expectedRevision: initial.revision,
				});
				expect(firstSave.revision).toBe(1);
				expect(firstSave.board.columns[0]?.cards[0]?.prompt).toBe("Task One");

				const secondSave = await saveWorkspaceState(workspacePath, {
					board: createBoard("Task Two"),
					sessions: {},
					expectedRevision: firstSave.revision,
				});
				expect(secondSave.revision).toBe(2);
				expect(secondSave.board.columns[0]?.cards[0]?.prompt).toBe("Task Two");

				await expect(
					saveWorkspaceState(workspacePath, {
						board: createBoard("Stale Task"),
						sessions: {},
						expectedRevision: firstSave.revision,
					}),
				).rejects.toMatchObject({
					name: "WorkspaceStateConflictError",
					currentRevision: secondSave.revision,
				} satisfies Partial<WorkspaceStateConflictError>);

				const loadedAfterConflict = await loadWorkspaceState(workspacePath);
				expect(loadedAfterConflict.revision).toBe(2);
				expect(loadedAfterConflict.board.columns[0]?.cards[0]?.prompt).toBe("Task Two");
			} finally {
				cleanup();
			}
		});
	});

	it("lists and removes workspace index entries across multiple projects", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspaces-");
			try {
				const workspaceAPath = join(sandboxRoot, "alpha");
				const workspaceBPath = join(sandboxRoot, "beta");
				mkdirSync(workspaceAPath, { recursive: true });
				mkdirSync(workspaceBPath, { recursive: true });
				initGitRepository(workspaceAPath);
				initGitRepository(workspaceBPath);

				const contextA = await loadWorkspaceContext(workspaceAPath);
				const contextB = await loadWorkspaceContext(workspaceBPath);

				const entries = await listWorkspaceIndexEntries();
				expect(entries).toHaveLength(2);
				expect(entries.map((entry) => entry.workspaceId).sort()).toEqual(
					[contextA.workspaceId, contextB.workspaceId].sort(),
				);

				expect(await loadWorkspaceContextById(contextA.workspaceId)).not.toBeNull();
				expect(await removeWorkspaceIndexEntry(contextA.workspaceId)).toBe(true);
				expect(await loadWorkspaceContextById(contextA.workspaceId)).toBeNull();
				expect(await removeWorkspaceIndexEntry(contextA.workspaceId)).toBe(false);

				const entriesAfterRemoval = await listWorkspaceIndexEntries();
				expect(entriesAfterRemoval).toHaveLength(1);
				expect(entriesAfterRemoval[0]?.workspaceId).toBe(contextB.workspaceId);
			} finally {
				cleanup();
			}
		});
	});

	it("can require an existing project without auto-creating workspace entries", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-autocreate-");
			try {
				const workspacePath = join(sandboxRoot, "gamma");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				await expect(
					loadWorkspaceContext(workspacePath, {
						autoCreateIfMissing: false,
					}),
				).rejects.toThrow("is not added to Kanban yet");

				const created = await loadWorkspaceContext(workspacePath);
				expect(created.repoPath).toBeTruthy();

				const existing = await loadWorkspaceContext(workspacePath, {
					autoCreateIfMissing: false,
				});
				expect(existing.workspaceId).toBe(created.workspaceId);
			} finally {
				cleanup();
			}
		});
	});

	it("fails loudly when persisted board data is malformed", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-malformed-board-");
			try {
				const workspacePath = join(sandboxRoot, "project-bad-board");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);
				mkdirSync(context.statePath, { recursive: true });
				writeFileSync(
					join(context.statePath, "board.json"),
					JSON.stringify(
						{
							columns: [
								{
									id: "backlog",
									title: "Backlog",
									cards: [
										{
											prompt: "Missing ID and baseRef",
											startInPlanMode: false,
											createdAt: Date.now(),
											updatedAt: Date.now(),
										},
									],
								},
								{ id: "in_progress", title: "In Progress", cards: [] },
								{ id: "review", title: "Review", cards: [] },
								{ id: "trash", title: "Trash", cards: [] },
							],
						},
						null,
						2,
					),
					"utf8",
				);

				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow("board.json");
				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow(/id|baseRef/);
			} finally {
				cleanup();
			}
		});
	});

	it("fails loudly when persisted sessions include unknown states", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-malformed-sessions-");
			try {
				const workspacePath = join(sandboxRoot, "project-bad-sessions");
				mkdirSync(workspacePath, { recursive: true });
				initGitRepository(workspacePath);

				const context = await loadWorkspaceContext(workspacePath);
				mkdirSync(context.statePath, { recursive: true });
				writeFileSync(
					join(context.statePath, "board.json"),
					JSON.stringify(createBoard("Valid board"), null, 2),
					"utf8",
				);
				writeFileSync(
					join(context.statePath, "sessions.json"),
					JSON.stringify(
						{
							"task-1": {
								...createSessionSummary("task-1"),
								state: "not-a-valid-state",
							},
						},
						null,
						2,
					),
					"utf8",
				);

				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow("sessions.json");
				await expect(loadWorkspaceState(workspacePath)).rejects.toThrow("state");
			} finally {
				cleanup();
			}
		});
	});

	it("fails loudly when persisted workspace index data is malformed", async () => {
		await withTemporaryHome(async () => {
			mkdirSync(getWorkspacesRootPath(), { recursive: true });
			writeFileSync(
				join(getWorkspacesRootPath(), "index.json"),
				JSON.stringify(
					{
						version: 1,
						entries: {
							"workspace-a": {
								workspaceId: "workspace-a",
							},
						},
						repoPathToId: {},
					},
					null,
					2,
				),
				"utf8",
			);

			await expect(listWorkspaceIndexEntries()).rejects.toThrow("index.json");
			await expect(listWorkspaceIndexEntries()).rejects.toThrow("repoPath");
		});
	});
});
