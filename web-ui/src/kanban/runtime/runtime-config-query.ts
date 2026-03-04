import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/kanban/runtime/types";
import { createWorkspaceTrpcClient } from "@/kanban/runtime/trpc-client";

export async function fetchRuntimeConfig(workspaceId: string): Promise<RuntimeConfigResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.getConfig.query();
}

export async function saveRuntimeConfig(
	workspaceId: string,
	nextConfig: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutId?: string | null;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
	},
): Promise<RuntimeConfigResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.saveConfig.mutate(nextConfig);
}
