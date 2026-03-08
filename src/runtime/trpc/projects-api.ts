import type {
	RuntimeBoardData,
	RuntimeProjectAddResponse,
	RuntimeProjectSummary,
	RuntimeProjectTaskCounts,
} from "../api-contract.js";
import { parseProjectAddRequest, parseProjectRemoveRequest } from "../api-validation.js";
import {
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
} from "../state/workspace-state.js";
import type { TerminalSessionManager } from "../terminal/session-manager.js";
import { deleteTaskWorktree } from "../workspace/task-worktree.js";
import type { RuntimeTrpcContext } from "./app-router.js";

interface DisposeWorkspaceOptions {
	stopTerminalSessions?: boolean;
}

export interface CreateProjectsApiDependencies {
	getActiveWorkspacePath: () => string | null;
	getActiveWorkspaceId: () => string | null;
	rememberWorkspace: (workspaceId: string, repoPath: string) => void;
	setActiveWorkspace: (workspaceId: string, repoPath: string) => Promise<void>;
	clearActiveWorkspace: () => void;
	resolveProjectInputPath: (inputPath: string, cwd: string) => string;
	assertPathIsDirectory: (path: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	summarizeProjectTaskCounts: (workspaceId: string, repoPath: string) => Promise<RuntimeProjectTaskCounts>;
	createProjectSummary: (project: {
		workspaceId: string;
		repoPath: string;
		taskCounts: RuntimeProjectTaskCounts;
	}) => RuntimeProjectSummary;
	broadcastRuntimeProjectsUpdated: (preferredCurrentProjectId: string | null) => Promise<void> | void;
	getTerminalManagerForWorkspace: (workspaceId: string) => TerminalSessionManager | null;
	disposeWorkspace: (
		workspaceId: string,
		options?: DisposeWorkspaceOptions,
	) => { terminalManager: TerminalSessionManager | null; workspacePath: string | null };
	collectProjectWorktreeTaskIdsForRemoval: (board: RuntimeBoardData) => Set<string>;
	warn: (message: string) => void;
	buildProjectsPayload: (preferredCurrentProjectId: string | null) => Promise<{
		currentProjectId: string | null;
		projects: RuntimeProjectSummary[];
	}>;
	pickDirectoryPathFromSystemDialog: () => string | null;
}

export function createProjectsApi(deps: CreateProjectsApiDependencies): RuntimeTrpcContext["projectsApi"] {
	return {
		listProjects: async (preferredWorkspaceId) => {
			const payload = await deps.buildProjectsPayload(preferredWorkspaceId);
			return {
				currentProjectId: payload.currentProjectId,
				projects: payload.projects,
			};
		},
		addProject: async (preferredWorkspaceId, input) => {
			const body = parseProjectAddRequest(input);
			const preferredWorkspaceContext = preferredWorkspaceId
				? await loadWorkspaceContextById(preferredWorkspaceId)
				: null;
			const resolveBasePath = preferredWorkspaceContext?.repoPath ?? deps.getActiveWorkspacePath() ?? process.cwd();
			try {
				const projectPath = deps.resolveProjectInputPath(body.path, resolveBasePath);
				await deps.assertPathIsDirectory(projectPath);
				if (!deps.hasGitRepository(projectPath)) {
					return {
						ok: false,
						project: null,
						error: "No git repository detected. Only projects with git initialized can be added.",
					} satisfies RuntimeProjectAddResponse;
				}
				const context = await loadWorkspaceContext(projectPath);
				deps.rememberWorkspace(context.workspaceId, context.repoPath);
				const projectsAfterAdd = await listWorkspaceIndexEntries();
				const activeWorkspaceId = deps.getActiveWorkspaceId();
				const hasActiveWorkspace = activeWorkspaceId
					? projectsAfterAdd.some((project) => project.workspaceId === activeWorkspaceId)
					: false;
				if (!hasActiveWorkspace) {
					await deps.setActiveWorkspace(context.workspaceId, context.repoPath);
				}
				const taskCounts = await deps.summarizeProjectTaskCounts(context.workspaceId, context.repoPath);
				void deps.broadcastRuntimeProjectsUpdated(context.workspaceId);
				return {
					ok: true,
					project: deps.createProjectSummary({
						workspaceId: context.workspaceId,
						repoPath: context.repoPath,
						taskCounts,
					}),
				} satisfies RuntimeProjectAddResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					project: null,
					error: message,
				} satisfies RuntimeProjectAddResponse;
			}
		},
		removeProject: async (_preferredWorkspaceId, input) => {
			try {
				const body = parseProjectRemoveRequest(input);
				const projectsBeforeRemoval = await listWorkspaceIndexEntries();
				const projectToRemove = projectsBeforeRemoval.find((project) => project.workspaceId === body.projectId);
				if (!projectToRemove) {
					return {
						ok: false,
						error: `Unknown project ID: ${body.projectId}`,
					};
				}

				const taskIdsToCleanup = new Set<string>();
				try {
					const workspaceState = await loadWorkspaceState(projectToRemove.repoPath);
					for (const taskId of deps.collectProjectWorktreeTaskIdsForRemoval(workspaceState.board)) {
						taskIdsToCleanup.add(taskId);
					}
				} catch {
					// Best effort: if board state cannot be read, skip worktree cleanup IDs.
				}

				const removedTerminalManager = deps.getTerminalManagerForWorkspace(body.projectId);
				if (removedTerminalManager) {
					removedTerminalManager.markInterruptedAndStopAll();
				}

				const removed = await removeWorkspaceIndexEntry(body.projectId);
				if (!removed) {
					throw new Error(`Could not remove project index entry for "${body.projectId}".`);
				}
				await removeWorkspaceStateFiles(body.projectId);
				deps.disposeWorkspace(body.projectId, {
					stopTerminalSessions: false,
				});

				if (deps.getActiveWorkspaceId() === body.projectId) {
					const remaining = await listWorkspaceIndexEntries();
					const fallbackWorkspace = remaining[0];
					if (fallbackWorkspace) {
						await deps.setActiveWorkspace(fallbackWorkspace.workspaceId, fallbackWorkspace.repoPath);
					} else {
						deps.clearActiveWorkspace();
					}
				}
				void deps.broadcastRuntimeProjectsUpdated(deps.getActiveWorkspaceId());
				if (taskIdsToCleanup.size > 0) {
					const cleanupTaskIds = Array.from(taskIdsToCleanup);
					void (async () => {
						const deletions = await Promise.all(
							cleanupTaskIds.map(async (taskId) => ({
								taskId,
								deleted: await deleteTaskWorktree({
									repoPath: projectToRemove.repoPath,
									taskId,
								}),
							})),
						);
						for (const { taskId, deleted } of deletions) {
							if (deleted.ok) {
								continue;
							}
							const message = deleted.error ?? `Could not delete task workspace for task "${taskId}".`;
							deps.warn(message);
						}
					})();
				}
				return {
					ok: true,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					error: message,
				};
			}
		},
		pickProjectDirectory: async () => {
			try {
				const selectedPath = deps.pickDirectoryPathFromSystemDialog();
				if (!selectedPath) {
					return {
						ok: false,
						path: null,
						error: "No directory was selected.",
					};
				}
				return {
					ok: true,
					path: selectedPath,
				};
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return {
					ok: false,
					path: null,
					error: message,
				};
			}
		},
	};
}
