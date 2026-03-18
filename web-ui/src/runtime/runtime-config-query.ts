// Browser-side query helpers for workspace-scoped runtime settings and Cline actions.
// Keep TRPC request details here so components and controller hooks can focus
// on state orchestration instead of transport plumbing.
import { createWorkspaceTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeClineOauthLoginResponse,
	RuntimeClineOauthProvider,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
	RuntimeProjectShortcut,
} from "@/runtime/types";

export async function fetchRuntimeConfig(workspaceId: string): Promise<RuntimeConfigResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.getConfig.query();
}

export async function saveRuntimeConfig(
	workspaceId: string,
	nextConfig: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutLabel?: string | null;
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

export async function saveClineProviderSettings(
	workspaceId: string,
	input: {
		providerId: string;
		modelId?: string | null;
		apiKey?: string | null;
		baseUrl?: string | null;
	},
): Promise<RuntimeClineProviderSettings> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineProviderSettings.mutate(input);
}

export async function fetchClineProviderCatalog(workspaceId: string): Promise<RuntimeClineProviderCatalogItem[]> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderCatalog.query();
	return response.providers;
}

export async function fetchClineProviderModels(
	workspaceId: string,
	providerId: string,
): Promise<RuntimeClineProviderModel[]> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderModels.query({ providerId });
	return response.models;
}

export async function runClineProviderOauthLogin(
	workspaceId: string,
	input: {
		provider: RuntimeClineOauthProvider;
		baseUrl?: string | null;
	},
): Promise<RuntimeClineOauthLoginResponse> {
	const trpcClient = createWorkspaceTrpcClient(workspaceId);
	return await trpcClient.runtime.runClineProviderOAuthLogin.mutate(input);
}
