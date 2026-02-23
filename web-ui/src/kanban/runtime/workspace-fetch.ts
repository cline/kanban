export interface WorkspaceRequestInit extends RequestInit {
	workspaceId: string | null;
}

export async function workspaceFetch(input: string, init?: WorkspaceRequestInit): Promise<Response> {
	const requestedWorkspaceId = init?.workspaceId ?? null;
	const headers = new Headers(init?.headers ?? {});
	if (requestedWorkspaceId) {
		headers.set("x-kanbanana-workspace-id", requestedWorkspaceId);
	}
	const requestInit: RequestInit = {
		...init,
		headers,
	};
	return await fetch(input, requestInit);
}
