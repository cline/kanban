import { TRPCClientError } from "@trpc/client";
import { createWorkspaceTrpcClient, readTrpcConflictRevision } from "@/runtime/trpc-client";
import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "@/runtime/types";
import { isPendingGitActionStale, type TaskPendingGitAction } from "@/types";

export class WorkspaceStateConflictError extends Error {
	readonly currentRevision: number;

	constructor(currentRevision: number, message = "Workspace state revision conflict.") {
		super(message);
		this.name = "WorkspaceStateConflictError";
		this.currentRevision = currentRevision;
	}
}

export async function fetchWorkspaceState(workspaceId: string): Promise<RuntimeWorkspaceStateResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.workspace.getState.query();
}

export async function saveWorkspaceState(
	workspaceId: string,
	payload: RuntimeWorkspaceStateSaveRequest,
): Promise<RuntimeWorkspaceStateResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	try {
		return await trpcClient.workspace.saveState.mutate(payload);
	} catch (error) {
		if (error instanceof TRPCClientError) {
			const conflictRevision = readTrpcConflictRevision(error);
			if (typeof conflictRevision === "number") {
				throw new WorkspaceStateConflictError(conflictRevision, error.message);
			}
		}
		throw error;
	}
}

/**
 * Persists (or clears) `pendingGitAction` on a single board card via a server-side
 * read-modify-write of the workspace state. The server revision check makes this safe
 * across browser tabs: two tabs arming the same card cannot both succeed, so the
 * persisted field doubles as a cross-tab lock.
 *
 * Returns `true` when the server state ends up matching `value`, and `false` when the
 * write was refused (another recent pending action already holds the lock, the card is
 * gone, or revision conflicts could not be resolved).
 */
export async function patchCardPendingGitAction(
	workspaceId: string | null,
	taskId: string,
	value: TaskPendingGitAction | null,
): Promise<boolean> {
	if (!workspaceId) {
		return false;
	}
	const maxAttempts = 3;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const state = await fetchWorkspaceState(workspaceId);
		const card = findCardInBoard(state.board, taskId);
		if (!card) {
			return false;
		}
		const existing = card.pendingGitAction ?? null;
		let nextValue = value;
		if (value === null) {
			if (existing === null) {
				return true;
			}
		} else {
			if (existing !== null && !isPendingGitActionStale(existing)) {
				// Another tab (or an earlier request in this tab) already armed this card.
				return false;
			}
			if (existing !== null) {
				nextValue = { ...value, attempt: existing.attempt + 1 };
			}
		}
		const board = patchBoardCardPendingGitAction(state.board, taskId, nextValue ?? null);
		try {
			await saveWorkspaceState(workspaceId, {
				board,
				sessions: state.sessions,
				expectedRevision: state.revision,
			});
			return true;
		} catch (error) {
			if (error instanceof WorkspaceStateConflictError) {
				continue;
			}
			throw error;
		}
	}
	return false;
}

function findCardInBoard(board: RuntimeBoardData, taskId: string): RuntimeBoardCard | null {
	for (const column of board.columns) {
		for (const card of column.cards) {
			if (card.id === taskId) {
				return card;
			}
		}
	}
	return null;
}

function patchBoardCardPendingGitAction(
	board: RuntimeBoardData,
	taskId: string,
	value: TaskPendingGitAction | null,
): RuntimeBoardData {
	return {
		...board,
		columns: board.columns.map((column) => {
			if (!column.cards.some((card) => card.id === taskId)) {
				return column;
			}
			return {
				...column,
				cards: column.cards.map((card) => (card.id === taskId ? { ...card, pendingGitAction: value } : card)),
			};
		}),
	};
}
