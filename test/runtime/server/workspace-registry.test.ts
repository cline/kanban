import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { CodexHostNotification, CodexHostService } from "../../../src/codex-sdk/global-codex-host-service";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "../../../src/config/runtime-config";
import { createWorkspaceRegistry } from "../../../src/server/workspace-registry";
import { loadWorkspaceContext, loadWorkspaceState } from "../../../src/state/workspace-state";
import { createGitTestEnv } from "../../utilities/git-env";
import { createTempDir } from "../../utilities/temp-dir";

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

async function waitFor<T>(predicate: () => Promise<T | null>, timeoutMs = 5_000): Promise<T> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		const value = await predicate();
		if (value !== null) {
			return value;
		}
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out after ${timeoutMs}ms`);
}

describe.sequential("workspace-registry", () => {
	it("persists Codex shared-host session ids and restore snapshots for hydration", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-workspace-");
			try {
				const repoPath = join(sandboxRoot, "project-a");
				mkdirSync(repoPath, { recursive: true });
				writeFileSync(join(repoPath, "README.md"), "# test\n");
				initGitRepository(repoPath);
				const workspaceContext = await loadWorkspaceContext(repoPath);

				const threadListeners = new Map<string, (notification: CodexHostNotification) => void>();
				const host: CodexHostService = {
					getPid: () => 777,
					start: vi.fn(async () => undefined),
					dispose: vi.fn(async () => undefined),
					startThread: vi.fn(async () => ({
						threadId: "thread-1",
						cwd: repoPath,
					})),
					resumeThread: vi.fn(async () => ({
						threadId: "thread-1",
						cwd: repoPath,
					})),
					startTurn: vi.fn(async () => ({ turnId: "turn-1" })),
					interruptTurn: vi.fn(async () => undefined),
					releaseThread: vi.fn(),
					subscribe: (threadId, listener) => {
						threadListeners.set(threadId, listener);
						return () => {
							threadListeners.delete(threadId);
						};
					},
				};

				const registry = await createWorkspaceRegistry({
					cwd: repoPath,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: () => true,
					pathIsDirectory: async (path) => {
						try {
							return (await stat(path)).isDirectory();
						} catch {
							return false;
						}
					},
					globalCodexHostService: host,
				});
				const manager = await registry.ensureTerminalManagerForWorkspace(workspaceContext.workspaceId, repoPath);

				await manager.startTaskSession({
					taskId: "task-1",
					agentId: "codex",
					binary: "codex",
					args: [],
					cwd: repoPath,
					prompt: "say hello",
					resumeFromTrash: false,
				});

				threadListeners.get("thread-1")?.({
					method: "item/agentMessage/delta",
					threadId: "thread-1",
					turnId: "turn-1",
					delta: "hello",
				});
				threadListeners.get("thread-1")?.({
					method: "turn/completed",
					threadId: "thread-1",
					turnId: "turn-1",
					status: "completed",
					errorMessage: null,
				});

				const persistedSession = await waitFor(async () => {
					const state = await loadWorkspaceState(repoPath);
					const session = state.sessions["task-1"];
					if (!session?.agentSessionId || !session.terminalRestoreSnapshot) {
						return null;
					}
					return session;
				});

				expect(persistedSession.agentSessionId).toBe("thread-1");
				expect(persistedSession.lastKnownWorkspacePath).toBe(repoPath);
				expect(persistedSession.terminalRestoreSnapshot?.snapshot).toContain("hello");

				registry.disposeWorkspace(workspaceContext.workspaceId, {
					stopTerminalSessions: false,
				});

				const rehydratedRegistry = await createWorkspaceRegistry({
					cwd: repoPath,
					loadGlobalRuntimeConfig,
					loadRuntimeConfig,
					hasGitRepository: () => true,
					pathIsDirectory: async (path) => {
						try {
							return (await stat(path)).isDirectory();
						} catch {
							return false;
						}
					},
					globalCodexHostService: host,
				});
				const rehydratedManager = await rehydratedRegistry.ensureTerminalManagerForWorkspace(
					workspaceContext.workspaceId,
					repoPath,
				);
				const rehydratedSummary = rehydratedManager.getSummary("task-1");
				const restoreSnapshot = await rehydratedManager.getRestoreSnapshot("task-1");

				expect(rehydratedSummary?.agentSessionId).toBe("thread-1");
				expect(restoreSnapshot?.snapshot).toContain("hello");
			} finally {
				cleanup();
			}
		});
	});
});
