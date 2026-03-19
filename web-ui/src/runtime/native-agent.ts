import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeStateStreamTaskChatMessage,
	RuntimeTaskChatMessage,
} from "@/runtime/types";

export function isNativeClineAgentSelected(agentId: RuntimeAgentId | null | undefined): boolean {
	return agentId === "cline";
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
	return config.agents.some((agent) => agent.installed);
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
