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
	id: Exclude<RuntimeAgentId, "custom">;
	label: string;
	binary: string;
	defaultArgs: string[];
}

const AGENT_TEMPLATES: AgentTemplate[] = [
	{
		id: "claude",
		label: "Claude Code",
		binary: "claude",
		defaultArgs: ["--dangerously-skip-permissions"],
	},
	{
		id: "codex",
		label: "OpenAI Codex",
		binary: "codex",
		defaultArgs: ["--dangerously-bypass-approvals-and-sandbox"],
	},
	{
		id: "gemini",
		label: "Gemini CLI",
		binary: "gemini",
		defaultArgs: ["--yolo"],
	},
	{
		id: "opencode",
		label: "OpenCode",
		binary: "opencode",
		defaultArgs: [],
	},
];

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

export function parseCommandLine(commandLine: string): { binary: string; args: string[] } | null {
	const input = commandLine.trim();
	if (!input) {
		return null;
	}

	const tokens: string[] = [];
	let current = "";
	let quote: "single" | "double" | null = null;
	let escaping = false;

	for (let index = 0; index < input.length; index += 1) {
		const char = input[index];
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "single") {
			escaping = true;
			continue;
		}
		if (quote === "single") {
			if (char === "'") {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (quote === "double") {
			if (char === '"') {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === "'") {
			quote = "single";
			continue;
		}
		if (char === '"') {
			quote = "double";
			continue;
		}
		if (/\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}

	if (escaping || quote) {
		return null;
	}
	if (current) {
		tokens.push(current);
	}
	if (tokens.length === 0) {
		return null;
	}
	return {
		binary: tokens[0] ?? "",
		args: tokens.slice(1),
	};
}

export function detectInstalledCommands(): string[] {
	const candidates = ["claude", "codex", "gemini", "opencode", "npx"];
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
		const command = joinCommand(template.binary, template.defaultArgs);
		return {
			id: template.id,
			label: template.label,
			binary: template.binary,
			command,
			defaultArgs: template.defaultArgs,
			installed: detectedSet.has(template.binary),
			configured: runtimeConfig.selectedAgentId === template.id,
		};
	});
}

function getCustomDefinition(runtimeConfig: RuntimeConfigState): RuntimeAgentDefinition {
	const parsed = parseCommandLine(runtimeConfig.customAgentCommand ?? "");
	const binary = parsed?.binary ?? "";
	return {
		id: "custom",
		label: "Custom command",
		binary,
		command: runtimeConfig.customAgentCommand ?? "",
		defaultArgs: [],
		installed: Boolean(binary),
		configured: runtimeConfig.selectedAgentId === "custom",
	};
}

export function resolveAgentCommand(runtimeConfig: RuntimeConfigState): ResolvedAgentCommand | null {
	if (runtimeConfig.selectedAgentId === "custom") {
		const commandLine = runtimeConfig.customAgentCommand?.trim() ?? "";
		const parsed = parseCommandLine(commandLine);
		if (!parsed || !parsed.binary) {
			return null;
		}
		if (isBinaryAvailableOnPath(parsed.binary)) {
			return {
				agentId: "custom",
				label: "Custom command",
				command: commandLine || parsed.binary,
				binary: parsed.binary,
				args: parsed.args,
			};
		}
		if (isBinaryResolvableInShell(parsed.binary)) {
			const shellLaunch = toShellLaunchCommand(commandLine);
			if (!shellLaunch) {
				return null;
			}
			return {
				agentId: "custom",
				label: "Custom command",
				command: commandLine || parsed.binary,
				binary: shellLaunch.binary,
				args: shellLaunch.args,
			};
		}
		return null;
	}

	const selected = AGENT_TEMPLATES.find((template) => template.id === runtimeConfig.selectedAgentId);
	if (!selected) {
		return null;
	}
	const command = joinCommand(selected.binary, selected.defaultArgs);
	if (isBinaryAvailableOnPath(selected.binary)) {
		return {
			agentId: selected.id,
			label: selected.label,
			command,
			binary: selected.binary,
			args: [...selected.defaultArgs],
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
	const agents = [...getCuratedDefinitions(runtimeConfig, detectedCommands), getCustomDefinition(runtimeConfig)];
	const resolved = resolveAgentCommand(runtimeConfig);
	const effectiveCommand = resolved ? joinCommand(resolved.binary, resolved.args) : null;

	return {
		selectedAgentId: runtimeConfig.selectedAgentId,
		customAgentCommand: runtimeConfig.customAgentCommand,
		effectiveCommand,
		configPath: runtimeConfig.configPath,
		detectedCommands,
		agents,
		shortcuts: runtimeConfig.shortcuts,
	};
}
