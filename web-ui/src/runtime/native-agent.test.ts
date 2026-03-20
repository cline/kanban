import { describe, expect, it } from "vitest";

import {
	isNativeClineAgentSelected,
	isTaskAgentSetupSatisfied,
	selectLatestTaskChatMessageForTask,
} from "@/runtime/native-agent";
import type { RuntimeConfigResponse, RuntimeStateStreamTaskChatMessage } from "@/runtime/types";

function createRuntimeConfigResponse(selectedAgentId: RuntimeConfigResponse["selectedAgentId"]): RuntimeConfigResponse {
	return {
		selectedAgentId,
		selectedShortcutLabel: null,
		agentAutonomousModeEnabled: true,
		effectiveCommand: selectedAgentId === "cline" ? null : selectedAgentId,
		globalConfigPath: "/tmp/global-config.json",
		projectConfigPath: "/tmp/project/.kanban/config.json",
		readyForReviewNotificationsEnabled: true,
		detectedCommands: ["claude", "codex"],
		agents: [
			{
				id: "cline",
				label: "Cline",
				binary: "cline",
				command: "cline",
				defaultArgs: [],
				installed: false,
				configured: true,
			},
			{
				id: "claude",
				label: "Claude Code",
				binary: "claude",
				command: "claude",
				defaultArgs: [],
				installed: true,
				configured: true,
			},
		],
		taskStartSetupAvailability: {
			githubCli: false,
			linearMcp: false,
		},
		shortcuts: [],
		clineProviderSettings: {
			providerId: "cline",
			modelId: "sonnet",
			baseUrl: null,
			apiKeyConfigured: false,
			oauthProvider: "cline",
			oauthAccessTokenConfigured: true,
			oauthRefreshTokenConfigured: true,
			oauthAccountId: "acct_123",
			oauthExpiresAt: 123,
		},
		commitPromptTemplate: "",
		openPrPromptTemplate: "",
		commitPromptTemplateDefault: "",
		openPrPromptTemplateDefault: "",
	};
}

function createLatestTaskChatMessage(taskId: string): RuntimeStateStreamTaskChatMessage {
	return {
		type: "task_chat_message",
		workspaceId: "workspace-1",
		taskId,
		message: {
			id: "message-1",
			role: "assistant",
			content: "Hello",
			createdAt: Date.now(),
			meta: null,
		},
	};
}

describe("native-agent helpers", () => {
	it("treats cline as the native chat agent", () => {
		expect(isNativeClineAgentSelected("cline")).toBe(true);
		expect(isNativeClineAgentSelected("codex")).toBe(false);
	});

	it("treats the selected cline agent as task-ready even without an installed CLI binary", () => {
		expect(isTaskAgentSetupSatisfied(createRuntimeConfigResponse("cline"))).toBe(true);
		expect(isTaskAgentSetupSatisfied(null)).toBeNull();
	});

	it("ignores non-launch agents when checking native CLI availability", () => {
		const config = createRuntimeConfigResponse("claude");
		config.agents = [
			{
				id: "gemini",
				label: "Gemini CLI",
				binary: "gemini",
				command: "gemini",
				defaultArgs: [],
				installed: true,
				configured: false,
			},
		];
		expect(isTaskAgentSetupSatisfied(config)).toBe(false);
	});

	it("selects the latest incoming chat message only for the matching task", () => {
		const messageEvent = createLatestTaskChatMessage("task-1");
		expect(selectLatestTaskChatMessageForTask("task-1", messageEvent)).toEqual(messageEvent.message);
		expect(selectLatestTaskChatMessageForTask("task-2", messageEvent)).toBeNull();
		expect(selectLatestTaskChatMessageForTask(null, messageEvent)).toBeNull();
	});
});
