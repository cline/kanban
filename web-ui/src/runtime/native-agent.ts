import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";
import type {
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
	RuntimeStateStreamTaskChatMessage,
	RuntimeTaskChatMessage,
} from "@/runtime/types";

export function isNativeClineAgentSelected(agentId: RuntimeAgentId | null | undefined): boolean {
	return agentId === "cline";
}

export function getRuntimeClineProviderSettings(
	config: Pick<RuntimeConfigResponse, "clineProviderSettings"> | null | undefined,
): RuntimeClineProviderSettings {
	return (
		config?.clineProviderSettings ?? {
			providerId: null,
			modelId: null,
			baseUrl: null,
			reasoningEffort: null,
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		}
	);
}

export function isClineProviderAuthenticated(settings: RuntimeClineProviderSettings | null | undefined): boolean {
	if (!settings) {
		return false;
	}
	const hasProviderSelection =
		(settings.providerId?.trim().length ?? 0) > 0 || (settings.oauthProvider?.trim().length ?? 0) > 0;
	if (!hasProviderSelection) {
		return false;
	}
	return settings.apiKeyConfigured || settings.oauthAccessTokenConfigured;
}

export function isTaskAgentSetupSatisfied(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents" | "clineProviderSettings"> | null | undefined,
): boolean | null {
	if (!config) {
		return null;
	}
	if (isNativeClineAgentSelected(config.selectedAgentId)) {
		if (isClineProviderAuthenticated(getRuntimeClineProviderSettings(config))) {
			return true;
		}
		return config.agents.some(
			(agent) => agent.id !== "cline" && isRuntimeAgentLaunchSupported(agent.id) && agent.installed,
		);
	}
	return config.agents.some((agent) => isRuntimeAgentLaunchSupported(agent.id) && agent.installed);
}

export function getTaskAgentNavbarHint(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents" | "clineProviderSettings"> | null | undefined,
	options?: {
		shouldUseNavigationPath?: boolean;
	},
): string | undefined {
	if (options?.shouldUseNavigationPath) {
		return undefined;
	}
	const isTaskAgentReady = isTaskAgentSetupSatisfied(config);
	if (isTaskAgentReady === null || isTaskAgentReady) {
		return undefined;
	}
	return "No agent configured";
}

export function selectLatestTaskChatMessageForTask(
	taskId: string | null | undefined,
	latestTaskChatMessage: RuntimeStateStreamTaskChatMessage | null,
): RuntimeTaskChatMessage | null {
	if (!taskId || !latestTaskChatMessage || latestTaskChatMessage.taskId !== taskId) {
		return null;
	}
	return latestTaskChatMessage.message;
}

export function selectTaskChatMessagesForTask(
	taskId: string | null | undefined,
	taskChatMessagesByTaskId: Record<string, RuntimeTaskChatMessage[]>,
): RuntimeTaskChatMessage[] {
	if (!taskId) {
		return [];
	}
	return taskChatMessagesByTaskId[taskId] ?? [];
}
