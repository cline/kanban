import type { RuntimeTaskSessionSummary } from "../api-contract.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";
import type { TerminalSessionManager } from "../terminal/session-manager.js";

export interface RuntimeShutdownCoordinatorDependencies {
	workspaceRegistry: Pick<WorkspaceRegistry, "listManagedWorkspaces">;
	persistInterruptedSessions: (
		workspacePath: string,
		interruptedTaskIds: string[],
		terminalManager: TerminalSessionManager,
	) => Promise<string[]>;
	cleanupInterruptedTaskWorktrees: (workspacePath: string, taskIds: string[]) => Promise<void>;
	closeRuntimeServer: () => Promise<void>;
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

export async function shutdownRuntimeServer(deps: RuntimeShutdownCoordinatorDependencies): Promise<void> {
	const interruptedByWorkspace: Array<{
		workspacePath: string;
		terminalManager: TerminalSessionManager;
		interruptedTaskIds: string[];
	}> = [];

	for (const { workspacePath, terminalManager } of deps.workspaceRegistry.listManagedWorkspaces()) {
		const interrupted = terminalManager.markInterruptedAndStopAll();
		const interruptedTaskIds = collectShutdownInterruptedTaskIds(interrupted, terminalManager);
		if (!workspacePath) {
			continue;
		}
		interruptedByWorkspace.push({
			workspacePath,
			terminalManager,
			interruptedTaskIds,
		});
	}

	await Promise.all(
		interruptedByWorkspace.map(async (workspace) => {
			const worktreeTaskIds = await deps.persistInterruptedSessions(
				workspace.workspacePath,
				workspace.interruptedTaskIds,
				workspace.terminalManager,
			);
			await deps.cleanupInterruptedTaskWorktrees(workspace.workspacePath, worktreeTaskIds);
		}),
	);

	await deps.closeRuntimeServer();
}
