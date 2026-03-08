import { spawnSync } from "node:child_process";

import type { RuntimeAgentDefinition, RuntimeAgentId, RuntimeConfigResponse } from "../api-contract.js";
import type { RuntimeConfigState } from "../config/runtime-config.js";

export interface ResolvedAgentCommand {
	agentId: RuntimeAgentId;
	label: string;
	command: string;
	binary: string;
	args: string[];
}

interface AgentTemplate {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	baseArgs: string[];
	autonomousArgs: string[];
}

const AGENT_TEMPLATES: AgentTemplate[] = [
	{
		id: "claude",
		label: "Claude Code",
		binary: "claude",
		baseArgs: [],
		autonomousArgs: ["--dangerously-skip-permissions"],
	},
	{
		id: "codex",
		label: "OpenAI Codex",
		binary: "codex",
		baseArgs: [],
		autonomousArgs: ["--dangerously-bypass-approvals-and-sandbox"],
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		baseArgs: [],
		autonomousArgs: ["--yolo"],
	},
	{
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		baseArgs: [],
		autonomousArgs: [],
	},
	{
		id: "cline",
		label: "Cline CLI",
		binary: "cline",
		baseArgs: [],
		autonomousArgs: ["--auto-approve-all"],
	},
];

function getDefaultArgs(template: AgentTemplate, runtimeConfig: RuntimeConfigState): string[] {
	return runtimeConfig.agentAutonomousModeEnabled
		? [...template.baseArgs, ...template.autonomousArgs]
		: [...template.baseArgs];
}

function isBinaryAvailableOnPath(binary: string): boolean {
	const trimmed = binary.trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		// Path-based commands are validated at spawn-time.
		return true;
	}
	const lookupCommand = process.platform === "win32" ? "where" : "which";
	const result = spawnSync(lookupCommand, [trimmed], {
		stdio: "ignore",
	});
	return result.status === 0;
}

function getShellBinary(): string | null {
	if (process.platform === "win32") {
		return process.env.ComSpec?.trim() || "cmd.exe";
	}
	const shell = process.env.SHELL?.trim();
	return shell || "/bin/bash";
}

function quotePosixWord(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

function isBinaryResolvableInShell(binary: string): boolean {
	const trimmed = binary.trim();
	if (!trimmed) {
		return false;
	}
	const shellBinary = getShellBinary();
	if (!shellBinary) {
		return false;
	}
	if (process.platform === "win32") {
		const result = spawnSync(shellBinary, ["/d", "/s", "/c", `where ${trimmed} >NUL 2>NUL`], {
			stdio: "ignore",
		});
		return result.status === 0;
	}
	const result = spawnSync(shellBinary, ["-ic", `command -v ${quotePosixWord(trimmed)} >/dev/null 2>&1`], {
		stdio: "ignore",
	});
	return result.status === 0;
}

function toShellLaunchCommand(commandLine: string): { binary: string; args: string[] } | null {
	const trimmed = commandLine.trim();
	if (!trimmed) {
		return null;
	}
	const shellBinary = getShellBinary();
	if (!shellBinary) {
		return null;
	}
	if (process.platform === "win32") {
		return {
			binary: shellBinary,
			args: ["/d", "/s", "/c", trimmed],
		};
	}
	return {
		binary: shellBinary,
		args: ["-ic", trimmed],
	};
}

function quoteForDisplay(part: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(part)) {
		return part;
	}
	return JSON.stringify(part);
}

function joinCommand(binary: string, args: string[]): string {
	if (args.length === 0) {
		return binary;
	}
	return [binary, ...args.map(quoteForDisplay)].join(" ");
}

export function detectInstalledCommands(): string[] {
	const candidates = ["claude", "codex", "gemini", "opencode", "cline", "npx"];
	const detected: string[] = [];

	for (const candidate of candidates) {
		if (isBinaryAvailableOnPath(candidate) || isBinaryResolvableInShell(candidate)) {
			detected.push(candidate);
		}
	}

	return detected;
}

function getCuratedDefinitions(runtimeConfig: RuntimeConfigState, detected: string[]): RuntimeAgentDefinition[] {
	const detectedSet = new Set(detected);
	return AGENT_TEMPLATES.map((template) => {
		const defaultArgs = getDefaultArgs(template, runtimeConfig);
		const command = joinCommand(template.binary, defaultArgs);
		return {
			id: template.id,
			label: template.label,
			binary: template.binary,
			command,
			defaultArgs,
			installed: detectedSet.has(template.binary),
			configured: runtimeConfig.selectedAgentId === template.id,
		};
	});
}

export function resolveAgentCommand(runtimeConfig: RuntimeConfigState): ResolvedAgentCommand | null {
	const selected = AGENT_TEMPLATES.find((template) => template.id === runtimeConfig.selectedAgentId);
	if (!selected) {
		return null;
	}
	const defaultArgs = getDefaultArgs(selected, runtimeConfig);
	const command = joinCommand(selected.binary, defaultArgs);
	if (isBinaryAvailableOnPath(selected.binary)) {
		return {
			agentId: selected.id,
			label: selected.label,
			command,
			binary: selected.binary,
			args: defaultArgs,
		};
	}
	if (isBinaryResolvableInShell(selected.binary)) {
		const shellLaunch = toShellLaunchCommand(command);
		if (!shellLaunch) {
			return null;
		}
		return {
			agentId: selected.id,
			label: selected.label,
			command,
			binary: shellLaunch.binary,
			args: shellLaunch.args,
		};
	}
	return null;
}

export function buildRuntimeConfigResponse(runtimeConfig: RuntimeConfigState): RuntimeConfigResponse {
	const detectedCommands = detectInstalledCommands();
	const agents = getCuratedDefinitions(runtimeConfig, detectedCommands);
	const resolved = resolveAgentCommand(runtimeConfig);
	const effectiveCommand = resolved ? joinCommand(resolved.binary, resolved.args) : null;

	return {
		selectedAgentId: runtimeConfig.selectedAgentId,
		selectedShortcutId: runtimeConfig.selectedShortcutId,
		agentAutonomousModeEnabled: runtimeConfig.agentAutonomousModeEnabled,
		effectiveCommand,
		globalConfigPath: runtimeConfig.globalConfigPath,
		projectConfigPath: runtimeConfig.projectConfigPath,
		readyForReviewNotificationsEnabled: runtimeConfig.readyForReviewNotificationsEnabled,
		detectedCommands,
		agents,
		shortcuts: runtimeConfig.shortcuts,
		commitPromptTemplate: runtimeConfig.commitPromptTemplate,
		openPrPromptTemplate: runtimeConfig.openPrPromptTemplate,
		commitPromptTemplateDefault: runtimeConfig.commitPromptTemplateDefault,
		openPrPromptTemplateDefault: runtimeConfig.openPrPromptTemplateDefault,
	};
}
