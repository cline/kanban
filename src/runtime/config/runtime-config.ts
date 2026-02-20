import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { RuntimeAgentId, RuntimeProjectShortcut } from "../api-contract.js";

interface RuntimeConfigFileShape {
	selectedAgentId?: RuntimeAgentId;
	customAgentCommand?: string | null;
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeConfigState {
	configPath: string;
	selectedAgentId: RuntimeAgentId;
	customAgentCommand: string | null;
	shortcuts: RuntimeProjectShortcut[];
}

const RUNTIME_HOME_DIR = ".kanbanana";
const CONFIG_FILENAME = "config.json";
const DEFAULT_AGENT_ID: RuntimeAgentId = "claude";

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_DIR);
}

function normalizeAgentId(agentId: RuntimeAgentId | string | null | undefined): RuntimeAgentId {
	if (
		agentId === "claude" ||
		agentId === "codex" ||
		agentId === "gemini" ||
		agentId === "opencode" ||
		agentId === "custom"
	) {
		return agentId;
	}
	return DEFAULT_AGENT_ID;
}

function normalizeCommand(command: string | null | undefined): string | null {
	if (typeof command !== "string") {
		return null;
	}
	const trimmed = command.trim();
	return trimmed ? trimmed : null;
}

function normalizeShortcut(shortcut: RuntimeProjectShortcut): RuntimeProjectShortcut | null {
	if (!shortcut || typeof shortcut !== "object") {
		return null;
	}

	const id = typeof shortcut.id === "string" ? shortcut.id.trim() : "";
	const label = typeof shortcut.label === "string" ? shortcut.label.trim() : "";
	const command = typeof shortcut.command === "string" ? shortcut.command.trim() : "";
	const icon = typeof shortcut.icon === "string" ? shortcut.icon.trim() : "";

	if (!id || !label || !command) {
		return null;
	}

	return {
		id,
		label,
		command,
		icon: icon || undefined,
	};
}

function normalizeShortcuts(shortcuts: RuntimeProjectShortcut[] | null | undefined): RuntimeProjectShortcut[] {
	if (!Array.isArray(shortcuts)) {
		return [];
	}
	const normalized: RuntimeProjectShortcut[] = [];
	for (const shortcut of shortcuts) {
		const parsed = normalizeShortcut(shortcut);
		if (parsed) {
			normalized.push(parsed);
		}
	}
	return normalized;
}

export function getRuntimeConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

function toRuntimeConfigState(configPath: string, parsed: RuntimeConfigFileShape | null): RuntimeConfigState {
	const selectedAgentId = normalizeAgentId(parsed?.selectedAgentId);
	const customAgentCommand = normalizeCommand(parsed?.customAgentCommand);

	return {
		configPath,
		selectedAgentId,
		customAgentCommand,
		shortcuts: normalizeShortcuts(parsed?.shortcuts),
	};
}

async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFileShape | null> {
	try {
		const raw = await readFile(configPath, "utf8");
		return JSON.parse(raw) as RuntimeConfigFileShape;
	} catch {
		return null;
	}
}

async function writeRuntimeConfigFile(configPath: string, config: RuntimeConfigState): Promise<RuntimeConfigState> {
	const selectedAgentId = normalizeAgentId(config.selectedAgentId);
	const customAgentCommand = normalizeCommand(config.customAgentCommand);
	const shortcuts = normalizeShortcuts(config.shortcuts);

	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				selectedAgentId,
				customAgentCommand,
				shortcuts,
			},
			null,
			2,
		),
		"utf8",
	);

	return {
		configPath,
		selectedAgentId,
		customAgentCommand,
		shortcuts,
	};
}

export async function loadRuntimeConfig(): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath();
	const parsedGlobalConfig = await readRuntimeConfigFile(configPath);
	if (parsedGlobalConfig) {
		return toRuntimeConfigState(configPath, parsedGlobalConfig);
	}

	return {
		configPath,
		selectedAgentId: DEFAULT_AGENT_ID,
		customAgentCommand: null,
		shortcuts: [],
	};
}

export async function saveRuntimeConfig(config: {
	selectedAgentId: RuntimeAgentId;
	customAgentCommand: string | null;
	shortcuts: RuntimeProjectShortcut[];
}): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath();
	const savedConfig = await writeRuntimeConfigFile(configPath, {
		configPath,
		selectedAgentId: config.selectedAgentId,
		customAgentCommand: config.customAgentCommand,
		shortcuts: config.shortcuts,
	});
	return savedConfig;
}
