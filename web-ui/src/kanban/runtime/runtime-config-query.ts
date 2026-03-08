import { createWorkspaceTrpcClient } from "@/kanban/runtime/trpc-client";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/kanban/runtime/types";

export async function fetchRuntimeConfig(workspaceId: string): Promise<RuntimeConfigResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.getConfig.query();
}

export async function saveRuntimeConfig(
	workspaceId: string,
	nextConfig: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutId?: string | null;
		agentAutonomousModeEnabled?: boolean;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
	},
): Promise<RuntimeConfigResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.saveConfig.mutate(nextConfig);
}
