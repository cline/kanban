// Browser-side query helpers for runtime settings and Cline actions.
// Keep TRPC request details here so components and controller hooks can focus
// on state orchestration instead of transport plumbing.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeClineMcpAuthStatusResponse,
	RuntimeClineAccountProfileResponse,
	RuntimeClineMcpOAuthResponse,
	RuntimeClineMcpServer,
	RuntimeClineMcpSettingsResponse,
	RuntimeClineOauthLoginResponse,
	RuntimeClineOauthProvider,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
	RuntimeDebugResetAllStateResponse,
	RuntimeProjectShortcut,
} from "@/runtime/types";

export async function fetchRuntimeConfig(workspaceId: string | null): Promise<RuntimeConfigResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getConfig.query();
}

export async function saveRuntimeConfig(
	workspaceId: string | null,
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
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveConfig.mutate(nextConfig);
}

export async function saveClineProviderSettings(
	workspaceId: string | null,
	input: {
		providerId: string;
		modelId?: string | null;
		apiKey?: string | null;
		baseUrl?: string | null;
	},
): Promise<RuntimeClineProviderSettings> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineProviderSettings.mutate(input);
}

export async function fetchClineProviderCatalog(workspaceId: string | null): Promise<RuntimeClineProviderCatalogItem[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderCatalog.query();
	return response.providers;
}

export async function fetchClineAccountProfile(workspaceId: string | null): Promise<RuntimeClineAccountProfileResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountProfile.query();
}

export async function fetchClineProviderModels(
	workspaceId: string | null,
	providerId: string,
): Promise<RuntimeClineProviderModel[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderModels.query({ providerId });
	return response.models;
}

export async function runClineProviderOauthLogin(
	workspaceId: string | null,
	input: {
		provider: RuntimeClineOauthProvider;
		baseUrl?: string | null;
	},
): Promise<RuntimeClineOauthLoginResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runClineProviderOAuthLogin.mutate(input);
}

export async function fetchClineMcpSettings(workspaceId: string | null): Promise<RuntimeClineMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineMcpSettings.query();
}

export async function fetchClineMcpAuthStatuses(workspaceId: string | null): Promise<RuntimeClineMcpAuthStatusResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineMcpAuthStatuses.query();
}

export async function saveClineMcpSettings(
	workspaceId: string | null,
	input: {
		servers: RuntimeClineMcpServer[];
	},
): Promise<RuntimeClineMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineMcpSettings.mutate(input);
}

export async function runClineMcpServerOAuth(
	workspaceId: string | null,
	input: {
		serverName: string;
	},
): Promise<RuntimeClineMcpOAuthResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.runClineMcpServerOAuth.mutate(input);
}

export async function resetRuntimeDebugState(workspaceId: string | null): Promise<RuntimeDebugResetAllStateResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.resetAllState.mutate();
}
