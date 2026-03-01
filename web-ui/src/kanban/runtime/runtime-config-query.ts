import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";

interface RuntimeConfigError {
	error: string;
}

export async function fetchRuntimeConfig(workspaceId: string): Promise<RuntimeConfigResponse> {
	const response = await workspaceFetch("/api/runtime/config", {
		workspaceId,
	});
	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as RuntimeConfigError | null;
		throw new Error(payload?.error ?? `Runtime config request failed with ${response.status}`);
	}
	return (await response.json()) as RuntimeConfigResponse;
}

export async function saveRuntimeConfig(
	workspaceId: string,
	nextConfig: {
		selectedAgentId: RuntimeAgentId;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitLocalPromptTemplate?: string;
		commitWorktreePromptTemplate?: string;
		openPrLocalPromptTemplate?: string;
		openPrWorktreePromptTemplate?: string;
	},
): Promise<RuntimeConfigResponse> {
	const response = await workspaceFetch("/api/runtime/config", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(nextConfig),
		workspaceId,
	});
	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as RuntimeConfigError | null;
		throw new Error(payload?.error ?? `Runtime config save failed with ${response.status}`);
	}
	return (await response.json()) as RuntimeConfigResponse;
}
