import { loadWorkspaceState, saveWorkspaceState } from "../state/workspace-state.js";
import { updateTaskDependencies } from "../task-board-mutations.js";
import { deleteTaskWorktree } from "../workspace/task-worktree.js";
import type { RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "../api-contract.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";
import { collectProjectWorktreeTaskIdsForRemoval } from "./workspace-registry.js";
import type { TerminalSessionManager } from "../terminal/session-manager.js";

export interface RuntimeShutdownCoordinatorDependencies {
	workspaceRegistry: Pick<WorkspaceRegistry, "listManagedWorkspaces">;
	warn: (message: string) => void;
	closeRuntimeServer: () => Promise<void>;
}

function moveTaskToTrash(
	board: RuntimeWorkspaceStateResponse["board"],
	taskId: string,
): RuntimeWorkspaceStateResponse["board"] {
	const columns = board.columns.map((column) => ({
		...column,
		cards: [...column.cards],
	}));
	let removedCard: RuntimeWorkspaceStateResponse["board"]["columns"][number]["cards"][number] | undefined;

	for (const column of columns) {
		const cardIndex = column.cards.findIndex((candidate) => candidate.id === taskId);
		if (cardIndex === -1) {
			continue;
		}
		removedCard = column.cards[cardIndex];
		column.cards.splice(cardIndex, 1);
		break;
	}

	if (!removedCard) {
		return board;
	}
	const trashColumnIndex = columns.findIndex((column) => column.id === "trash");
	if (trashColumnIndex === -1) {
		return board;
	}
	const trashColumn = columns[trashColumnIndex];
	if (!trashColumn.cards.some((candidate) => candidate.id === taskId)) {
		trashColumn.cards.unshift({
			...removedCard,
			updatedAt: Date.now(),
		});
	}
	return updateTaskDependencies({
		...board,
		columns,
	});
}

async function persistInterruptedSessions(
	workspacePath: string,
	interruptedTaskIds: string[],
	terminalManager: TerminalSessionManager,
): Promise<string[]> {
	if (interruptedTaskIds.length === 0) {
		return [];
	}
	const workspaceState = await loadWorkspaceState(workspacePath);
	const worktreeTaskIds = collectProjectWorktreeTaskIdsForRemoval(workspaceState.board);
	const worktreeTaskIdsToCleanup = interruptedTaskIds.filter((taskId) => worktreeTaskIds.has(taskId));
	let nextBoard = workspaceState.board;
	for (const taskId of interruptedTaskIds) {
		nextBoard = moveTaskToTrash(nextBoard, taskId);
	}
	const nextSessions = {
		...workspaceState.sessions,
	};
	for (const taskId of interruptedTaskIds) {
		const summary = terminalManager.getSummary(taskId);
		if (summary) {
			nextSessions[taskId] = {
				...summary,
				state: "interrupted",
				reviewReason: "interrupted",
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
			const worktreeTaskIds = await persistInterruptedSessions(
				workspace.workspacePath,
				workspace.interruptedTaskIds,
				workspace.terminalManager,
			);
			await cleanupInterruptedTaskWorktrees(workspace.workspacePath, worktreeTaskIds, deps.warn);
		}),
	);

	await deps.closeRuntimeServer();
}
