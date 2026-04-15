// Browser-side query helpers for runtime settings and Cline actions.
// Keep TRPC request details here so components and controller hooks can focus
// on state orchestration instead of transport plumbing.
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeClineAccountBalanceResponse,
	RuntimeClineAccountOrganizationsResponse,
	RuntimeClineAccountProfileResponse,
	RuntimeClineAccountSwitchResponse,
	RuntimeClineAddProviderResponse,
	RuntimeClineDeviceAuthCompleteRequest,
	RuntimeClineDeviceAuthCompleteResponse,
	RuntimeClineDeviceAuthStartResponse,
	RuntimeClineKanbanAccessResponse,
	RuntimeClineMcpAuthStatusResponse,
	RuntimeClineMcpOAuthResponse,
	RuntimeClineMcpServer,
	RuntimeClineMcpSettingsResponse,
	RuntimeClineOauthLoginResponse,
	RuntimeClineOauthProvider,
	RuntimeClineProviderCapability,
	RuntimeClineProviderCatalogItem,
	RuntimeClineProviderModel,
	RuntimeClineProviderSettings,
	RuntimeClineReasoningEffort,
	RuntimeClineUpdateProviderResponse,
	RuntimeConfigResponse,
	RuntimeDebugResetAllStateResponse,
	RuntimeFeaturebaseTokenResponse,
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
		reasoningEffort?: RuntimeClineReasoningEffort | null;
		region?: string | null;
		aws?: {
			accessKey?: string | null;
			secretKey?: string | null;
			sessionToken?: string | null;
			region?: string | null;
			profile?: string | null;
			authentication?: "iam" | "api-key" | "profile" | null;
			endpoint?: string | null;
		};
		gcp?: {
			projectId?: string | null;
			region?: string | null;
		};
	},
): Promise<RuntimeClineProviderSettings> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.saveClineProviderSettings.mutate(input);
}

export async function addClineProvider(
	workspaceId: string | null,
	input: {
		providerId: string;
		name: string;
		baseUrl: string;
		apiKey?: string | null;
		headers?: Record<string, string>;
		timeoutMs?: number;
		models: string[];
		defaultModelId?: string | null;
		modelsSourceUrl?: string | null;
		capabilities?: RuntimeClineProviderCapability[];
	},
): Promise<RuntimeClineAddProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.addClineProvider.mutate(input);
}

export async function updateClineProvider(
	workspaceId: string | null,
	input: {
		providerId: string;
		name?: string;
		baseUrl?: string;
		apiKey?: string | null;
		headers?: Record<string, string> | null;
		timeoutMs?: number | null;
		models?: string[];
		defaultModelId?: string | null;
		modelsSourceUrl?: string | null;
		capabilities?: RuntimeClineProviderCapability[];
	},
): Promise<RuntimeClineUpdateProviderResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.updateClineProvider.mutate(input);
}

export async function fetchClineProviderCatalog(
	workspaceId: string | null,
): Promise<RuntimeClineProviderCatalogItem[]> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	const response = await trpcClient.runtime.getClineProviderCatalog.query();
	return response.providers;
}

export async function fetchClineAccountProfile(
	workspaceId: string | null,
): Promise<RuntimeClineAccountProfileResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountProfile.query();
}

export async function fetchClineKanbanAccess(workspaceId: string | null): Promise<RuntimeClineKanbanAccessResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineKanbanAccess.query();
}

export async function fetchFeaturebaseToken(workspaceId: string | null): Promise<RuntimeFeaturebaseTokenResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getFeaturebaseToken.query();
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

export async function startClineDeviceAuth(workspaceId: string | null): Promise<RuntimeClineDeviceAuthStartResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.startClineDeviceAuth.mutate();
}

export async function completeClineDeviceAuth(
	workspaceId: string | null,
	input: RuntimeClineDeviceAuthCompleteRequest,
): Promise<RuntimeClineDeviceAuthCompleteResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.completeClineDeviceAuth.mutate(input);
}

export async function fetchClineMcpSettings(workspaceId: string | null): Promise<RuntimeClineMcpSettingsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineMcpSettings.query();
}

export async function fetchClineMcpAuthStatuses(
	workspaceId: string | null,
): Promise<RuntimeClineMcpAuthStatusResponse> {
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

export async function openFileOnHost(workspaceId: string | null, filePath: string): Promise<void> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	await trpcClient.runtime.openFile.mutate({ filePath });
}

export async function fetchClineAccountBalance(
	workspaceId: string | null,
): Promise<RuntimeClineAccountBalanceResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountBalance.query();
}

export async function fetchClineAccountOrganizations(
	workspaceId: string | null,
): Promise<RuntimeClineAccountOrganizationsResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.getClineAccountOrganizations.query();
}

export async function switchClineAccount(
	workspaceId: string | null,
	organizationId: string | null,
): Promise<RuntimeClineAccountSwitchResponse> {
	const trpcClient = getRuntimeTrpcClient(workspaceId);
	return await trpcClient.runtime.switchClineAccount.mutate({ organizationId });
}
