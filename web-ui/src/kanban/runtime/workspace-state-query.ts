import type {
	RuntimeWorkspaceStateConflictResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";

export class WorkspaceStateConflictError extends Error {
	readonly currentRevision: number;

	constructor(currentRevision: number, message = "Workspace state revision conflict.") {
		super(message);
		this.name = "WorkspaceStateConflictError";
		this.currentRevision = currentRevision;
	}
}

export async function fetchWorkspaceState(workspaceId: string): Promise<RuntimeWorkspaceStateResponse> {
	const response = await workspaceFetch("/api/workspace/state", {
		workspaceId,
	});
	if (!response.ok) {
		throw new Error(`Workspace state request failed with ${response.status}`);
	}
	return (await response.json()) as RuntimeWorkspaceStateResponse;
}

export async function saveWorkspaceState(
	workspaceId: string,
	payload: RuntimeWorkspaceStateSaveRequest,
): Promise<RuntimeWorkspaceStateResponse> {
	const response = await workspaceFetch("/api/workspace/state", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
		workspaceId,
	});
	if (response.status === 409) {
		const conflict = (await response.json().catch(() => null)) as RuntimeWorkspaceStateConflictResponse | null;
		if (conflict && typeof conflict.currentRevision === "number") {
			throw new WorkspaceStateConflictError(conflict.currentRevision, conflict.error);
		}
		throw new WorkspaceStateConflictError(0);
	}
	if (!response.ok) {
		throw new Error(`Workspace save request failed with ${response.status}`);
	}
	return (await response.json()) as RuntimeWorkspaceStateResponse;
}
