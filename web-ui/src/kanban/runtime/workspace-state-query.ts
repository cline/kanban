import { TRPCClientError } from "@trpc/client";
import { createWorkspaceTrpcClient, readTrpcConflictRevision } from "@/kanban/runtime/trpc-client";
import type { RuntimeWorkspaceStateResponse, RuntimeWorkspaceStateSaveRequest } from "@/kanban/runtime/types";

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
