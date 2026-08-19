import type { RuntimeAgentId } from "./api-contract";

export type AgentUiSurface = "chat" | "terminal";
export type AgentBackend = "cline-sdk" | "pty";
export type AgentSessionKind = "long-lived" | "oneshot";
export type AgentSlashSource = "none" | "cline-sdk" | "project-skills";
export type AgentFollowUp = "sdk-send" | "pty-stdin" | "restart-pty-with-context";

export interface RuntimeAgentCapabilities {
	uiSurface: AgentUiSurface;
	backend: AgentBackend;
	sessionKind: AgentSessionKind;
	autoRestart: boolean;
	preserveChatAcrossRestarts: boolean;
	slashSource: AgentSlashSource;
	followUp: AgentFollowUp;
	showModelPicker: boolean;
	rejectFollowUpWhileRunning: boolean;
}

export interface RuntimeAgentCatalogEntry {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	baseArgs: string[];
	autonomousArgs: string[];
	installUrl: string;
	capabilities: RuntimeAgentCapabilities;
}

export const PTY_TUI_CAPABILITIES: RuntimeAgentCapabilities = {
	uiSurface: "terminal",
	backend: "pty",
	sessionKind: "long-lived",
	autoRestart: true,
	preserveChatAcrossRestarts: false,
	slashSource: "none",
	followUp: "pty-stdin",
	showModelPicker: false,
	rejectFollowUpWhileRunning: false,
};

export const CLINE_SDK_CAPABILITIES: RuntimeAgentCapabilities = {
	uiSurface: "chat",
	backend: "cline-sdk",
	sessionKind: "long-lived",
	autoRestart: false,
	preserveChatAcrossRestarts: true,
	slashSource: "cline-sdk",
	followUp: "sdk-send",
	showModelPicker: true,
	rejectFollowUpWhileRunning: false,
};

export const PTY_CHAT_CAPABILITIES: RuntimeAgentCapabilities = {
	uiSurface: "chat",
	backend: "pty",
	sessionKind: "oneshot",
	autoRestart: false,
	preserveChatAcrossRestarts: true,
	slashSource: "project-skills",
	followUp: "restart-pty-with-context",
	showModelPicker: false,
	rejectFollowUpWhileRunning: true,
};

export const RUNTIME_AGENT_CATALOG: RuntimeAgentCatalogEntry[] = [
	{
		id: "claude",
		label: "Claude Code",
		binary: "claude",
		baseArgs: [],
		autonomousArgs: ["--permission-mode", "auto"],
		installUrl: "https://docs.anthropic.com/en/docs/claude-code/quickstart",
		capabilities: PTY_TUI_CAPABILITIES,
	},
	{
		id: "codex",
		label: "OpenAI Codex",
		binary: "codex",
		baseArgs: [],
		autonomousArgs: ["--dangerously-bypass-approvals-and-sandbox"],
		installUrl: "https://github.com/openai/codex",
		capabilities: PTY_TUI_CAPABILITIES,
	},
	{
		id: "cline",
		label: "Cline",
		binary: "cline",
		baseArgs: [],
		autonomousArgs: ["--auto-approve-all"],
		installUrl: "https://github.com/cline/cline",
		capabilities: CLINE_SDK_CAPABILITIES,
	},
	{
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		baseArgs: [],
		autonomousArgs: [],
		installUrl: "https://github.com/sst/opencode",
		capabilities: PTY_TUI_CAPABILITIES,
	},
	{
		id: "droid",
		label: "Factory Droid",
		binary: "droid",
		baseArgs: [],
		autonomousArgs: ["--auto", "high"],
		installUrl: "https://docs.factory.ai/cli/getting-started/quickstart",
		capabilities: PTY_TUI_CAPABILITIES,
	},
	{
		id: "kiro",
		label: "Kiro",
		binary: "kiro-cli",
		baseArgs: ["chat"],
		autonomousArgs: ["--trust-all-tools"],
		installUrl: "https://kiro.dev",
		capabilities: PTY_TUI_CAPABILITIES,
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		baseArgs: [],
		autonomousArgs: ["--yolo"],
		installUrl: "https://github.com/google-gemini/gemini-cli",
		capabilities: PTY_TUI_CAPABILITIES,
	},
	{
		id: "ag2",
		label: "AG2",
		binary: "mlx-agents",
		baseArgs: ["ag2-run"],
		autonomousArgs: [],
		installUrl: "https://github.com/ag2ai/ag2",
		capabilities: PTY_CHAT_CAPABILITIES,
	},
];

// Temporarily keep launch support scoped to the core agent set.
// Re-enable additional CLIs by uncommenting entries below when ready.
export const RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS: readonly RuntimeAgentId[] = [
	"cline",
	"claude",
	"codex",
	"droid",
	"kiro",
	"ag2",
	// "opencode",
	// "gemini",
];

const RUNTIME_LAUNCH_SUPPORTED_AGENT_ID_SET = new Set<RuntimeAgentId>(RUNTIME_LAUNCH_SUPPORTED_AGENT_IDS);

export function isRuntimeAgentLaunchSupported(agentId: RuntimeAgentId): boolean {
	return RUNTIME_LAUNCH_SUPPORTED_AGENT_ID_SET.has(agentId);
}

export function getRuntimeLaunchSupportedAgentCatalog(): RuntimeAgentCatalogEntry[] {
	return RUNTIME_AGENT_CATALOG.filter((entry) => isRuntimeAgentLaunchSupported(entry.id));
}

export function getRuntimeAgentCatalogEntry(agentId: RuntimeAgentId): RuntimeAgentCatalogEntry | null {
	return RUNTIME_AGENT_CATALOG.find((entry) => entry.id === agentId) ?? null;
}

export function getAgentCapabilities(agentId: RuntimeAgentId | null | undefined): RuntimeAgentCapabilities | null {
	if (!agentId) {
		return null;
	}
	return getRuntimeAgentCatalogEntry(agentId)?.capabilities ?? PTY_TUI_CAPABILITIES;
}

export function isChatPanelAgent(agentId: RuntimeAgentId | null | undefined): boolean {
	return getAgentCapabilities(agentId)?.uiSurface === "chat";
}

export function isClineSdkBackend(agentId: RuntimeAgentId | null | undefined): boolean {
	return getAgentCapabilities(agentId)?.backend === "cline-sdk";
}
