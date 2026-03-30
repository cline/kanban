import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import { trashTaskAndGetReadyLinkedTaskIds } from "../core/task-board-mutations";
import { listWorkspaceIndexEntries, loadWorkspaceState, saveWorkspaceState } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { deleteTaskWorktree } from "../workspace/task-worktree";
import type { WorkspaceRegistry } from "./workspace-registry";
import { collectProjectWorktreeTaskIdsForRemoval } from "./workspace-registry";

export interface RuntimeShutdownCoordinatorDependencies {
	workspaceRegistry: Pick<WorkspaceRegistry, "listManagedWorkspaces">;
	warn: (message: string) => void;
	closeRuntimeServer: () => Promise<void>;
	skipSessionCleanup?: boolean;
}

async function persistInterruptedSessions(
	workspacePath: string,
	interruptedTaskIds: string[],
	options?: {
		workspaceState?: RuntimeWorkspaceStateResponse;
		resolveSummary?: (taskId: string) => RuntimeTaskSessionSummary | null;
	},
): Promise<string[]> {
	if (interruptedTaskIds.length === 0) {
		return [];
	}
	const workspaceState = options?.workspaceState ?? (await loadWorkspaceState(workspacePath));
	const worktreeTaskIds = collectProjectWorktreeTaskIdsForRemoval(workspaceState.board);
	const worktreeTaskIdsToCleanup = interruptedTaskIds.filter((taskId) => worktreeTaskIds.has(taskId));
	let nextBoard = workspaceState.board;
	for (const taskId of interruptedTaskIds) {
		const trashed = trashTaskAndGetReadyLinkedTaskIds(nextBoard, taskId);
		nextBoard = trashed.board;
	}
	const nextSessions = {
		...workspaceState.sessions,
	};
	for (const taskId of interruptedTaskIds) {
		const summary = options?.resolveSummary?.(taskId) ?? workspaceState.sessions[taskId] ?? null;
		if (summary) {
			nextSessions[taskId] = {
				...summary,
				state: "interrupted",
				reviewReason: "interrupted",
				pid: null,
				updatedAt: Date.now(),
			};
		}
	}
	await saveWorkspaceState(workspacePath, {
		board: nextBoard,
		sessions: nextSessions,
	});
	return worktreeTaskIdsToCleanup;
}

async function cleanupInterruptedTaskWorktrees(
	repoPath: string,
	taskIds: string[],
	warn: (message: string) => void,
): Promise<void> {
	if (taskIds.length === 0) {
		return;
	}
	const deletions = await Promise.all(
		taskIds.map(async (taskId) => ({
			taskId,
			deleted: await deleteTaskWorktree({
				repoPath,
				taskId,
			}),
		})),
	);
	for (const { taskId, deleted } of deletions) {
		if (deleted.ok) {
			continue;
		}
		const message = deleted.error ?? `Could not delete task workspace for task "${taskId}" during shutdown.`;
		warn(message);
	}
}

function shouldInterruptSessionOnShutdown(summary: RuntimeTaskSessionSummary): boolean {
	if (summary.state === "running") {
		return true;
	}
	return summary.state === "awaiting_review";
}

function collectShutdownInterruptedTaskIds(
	interruptedSummaries: RuntimeTaskSessionSummary[],
	terminalManager: TerminalSessionManager,
): string[] {
	const taskIds = new Set(interruptedSummaries.map((summary) => summary.taskId));
	for (const summary of terminalManager.listSummaries()) {
		if (!shouldInterruptSessionOnShutdown(summary)) {
			continue;
		}
		taskIds.add(summary.taskId);
	}
	return Array.from(taskIds);
}

function collectWorkColumnTaskIds(workspaceState: RuntimeWorkspaceStateResponse): string[] {
	return Array.from(collectProjectWorktreeTaskIdsForRemoval(workspaceState.board));
}

export async function shutdownRuntimeServer(deps: RuntimeShutdownCoordinatorDependencies): Promise<void> {
	if (deps.skipSessionCleanup) {
		await deps.closeRuntimeServer();
		return;
	}

	const interruptedByWorkspace: Array<{
		workspacePath: string;
		interruptedTaskIds: string[];
		workspaceState?: RuntimeWorkspaceStateResponse;
		resolveSummary?: (taskId: string) => RuntimeTaskSessionSummary | null;
	}> = [];
	const managedWorkspacePaths = new Set<string>();

	for (const { workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
		const interrupted = terminalManager.markInterruptedAndStopAll();
		const interruptedTaskIds = new Set(collectShutdownInterruptedTaskIds(interrupted, terminalManager));
		if (!workspacePath) {
			continue;
		}
		managedWorkspacePaths.add(workspacePath);
		try {
			const workspaceState = await loadWorkspaceState(workspacePath);
			for (const taskId of collectWorkColumnTaskIds(workspaceState)) {
				interruptedTaskIds.add(taskId);
			}
			interruptedByWorkspace.push({
				workspacePath,
				interruptedTaskIds: Array.from(interruptedTaskIds),
				workspaceState,
				resolveSummary: (taskId) => terminalManager.getSummary(taskId),
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not load workspace state for ${workspacePath} during shutdown cleanup. ${message}`);
		}
	}

	const indexedWorkspaces = await listWorkspaceIndexEntries();
	for (const workspace of indexedWorkspaces) {
		if (managedWorkspacePaths.has(workspace.repoPath)) {
			continue;
		}
		try {
			const workspaceState = await loadWorkspaceState(workspace.repoPath);
			const interruptedTaskIds = collectWorkColumnTaskIds(workspaceState);
			if (interruptedTaskIds.length === 0) {
				continue;
			}
			interruptedByWorkspace.push({
				workspacePath: workspace.repoPath,
				interruptedTaskIds,
				workspaceState,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			deps.warn(`Could not load workspace state for ${workspace.repoPath} during shutdown cleanup. ${message}`);
		}
	}

	await Promise.all(
		interruptedByWorkspace.map(async (workspace) => {
			const worktreeTaskIds = await persistInterruptedSessions(
				workspace.workspacePath,
				workspace.interruptedTaskIds,
				{
					workspaceState: workspace.workspaceState,
					resolveSummary: workspace.resolveSummary,
				},
			);
			await cleanupInterruptedTaskWorktrees(workspace.workspacePath, worktreeTaskIds, deps.warn);
		}),
	);

	await deps.closeRuntimeServer();
}
