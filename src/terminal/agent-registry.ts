import { spawnSync } from "node:child_process";

import type { RuntimeAgentDefinition, RuntimeAgentId, RuntimeConfigResponse } from "../core/api-contract.js";
import { RUNTIME_AGENT_CATALOG } from "../core/agent-catalog.js";
import type { RuntimeConfigState } from "../config/runtime-config.js";

export interface ResolvedAgentCommand {
	agentId: RuntimeAgentId;
	label: string;
	command: string;
	binary: string;
	args: string[];
}

function getDefaultArgs(agentId: RuntimeAgentId): string[] {
	const entry = RUNTIME_AGENT_CATALOG.find((candidate) => candidate.id === agentId);
	if (!entry) {
		return [];
	}
	return [...entry.baseArgs];
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
	const candidates = [...RUNTIME_AGENT_CATALOG.map((entry) => entry.binary), "npx"];
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
	return RUNTIME_AGENT_CATALOG.map((entry) => {
		const defaultArgs = getDefaultArgs(entry.id);
		const command = joinCommand(entry.binary, defaultArgs);
		return {
			id: entry.id,
			label: entry.label,
			binary: entry.binary,
			command,
			defaultArgs,
			installed: detectedSet.has(entry.binary),
			configured: runtimeConfig.selectedAgentId === entry.id,
		};
	});
}

export function resolveAgentCommand(runtimeConfig: RuntimeConfigState): ResolvedAgentCommand | null {
	const selected = RUNTIME_AGENT_CATALOG.find((entry) => entry.id === runtimeConfig.selectedAgentId);
	if (!selected) {
		return null;
	}
	const defaultArgs = getDefaultArgs(selected.id);
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
		selectedShortcutLabel: runtimeConfig.selectedShortcutLabel,
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
