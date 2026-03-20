import type {
	RuntimeAgentId,
	RuntimeClineProviderSettings,
	RuntimeConfigResponse,
	RuntimeStateStreamTaskChatMessage,
	RuntimeTaskChatMessage,
} from "@/runtime/types";
import { isRuntimeAgentLaunchSupported } from "@runtime-agent-catalog";

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
			apiKeyConfigured: false,
			oauthProvider: null,
			oauthAccessTokenConfigured: false,
			oauthRefreshTokenConfigured: false,
			oauthAccountId: null,
			oauthExpiresAt: null,
		}
	);
}

export function isTaskAgentSetupSatisfied(
	config: Pick<RuntimeConfigResponse, "selectedAgentId" | "agents"> | null | undefined,
): boolean | null {
	if (!config) {
		return null;
	}
	if (isNativeClineAgentSelected(config.selectedAgentId)) {
		return true;
	}
	return config.agents.some((agent) => isRuntimeAgentLaunchSupported(agent.id) && agent.installed);
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
