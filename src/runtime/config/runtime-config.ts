import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { RuntimeAgentId, RuntimeProjectShortcut } from "../api-contract.js";

interface RuntimeGlobalConfigFileShape {
	selectedAgentId?: RuntimeAgentId;
}

interface RuntimeProjectConfigFileShape {
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeConfigState {
	globalConfigPath: string;
	projectConfigPath: string;
	selectedAgentId: RuntimeAgentId;
	shortcuts: RuntimeProjectShortcut[];
}

const RUNTIME_HOME_DIR = ".kanbanana";
const CONFIG_FILENAME = "config.json";
const PROJECT_CONFIG_DIR = ".kanbanana";
const PROJECT_CONFIG_FILENAME = "config.json";
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
		agentId === "cline"
	) {
		return agentId;
	}
	return DEFAULT_AGENT_ID;
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

export function getRuntimeGlobalConfigPath(): string {
	return join(getRuntimeHomePath(), CONFIG_FILENAME);
}

export function getRuntimeProjectConfigPath(cwd: string): string {
	return join(resolve(cwd), PROJECT_CONFIG_DIR, PROJECT_CONFIG_FILENAME);
}

function toRuntimeConfigState({
	globalConfigPath,
	projectConfigPath,
	globalConfig,
	projectConfig,
}: {
	globalConfigPath: string;
	projectConfigPath: string;
	globalConfig: RuntimeGlobalConfigFileShape | null;
	projectConfig: RuntimeProjectConfigFileShape | null;
}): RuntimeConfigState {
	return {
		globalConfigPath,
		projectConfigPath,
		selectedAgentId: normalizeAgentId(globalConfig?.selectedAgentId),
		shortcuts: normalizeShortcuts(projectConfig?.shortcuts),
	};
}

async function readRuntimeConfigFile<T>(configPath: string): Promise<T | null> {
	try {
		const raw = await readFile(configPath, "utf8");
		return JSON.parse(raw) as T;
	} catch {
		return null;
	}
}

async function writeRuntimeGlobalConfigFile(
	configPath: string,
	config: { selectedAgentId: RuntimeAgentId },
): Promise<void> {
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				selectedAgentId: normalizeAgentId(config.selectedAgentId),
			},
			null,
			2,
		),
		"utf8",
	);
}

async function writeRuntimeProjectConfigFile(
	configPath: string,
	config: { shortcuts: RuntimeProjectShortcut[] },
): Promise<void> {
	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				shortcuts: normalizeShortcuts(config.shortcuts),
			},
			null,
			2,
		),
		"utf8",
	);
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	const projectConfigPath = getRuntimeProjectConfigPath(cwd);
	const globalConfig = await readRuntimeConfigFile<RuntimeGlobalConfigFileShape>(globalConfigPath);
	const projectConfig = await readRuntimeConfigFile<RuntimeProjectConfigFileShape>(projectConfigPath);
	return toRuntimeConfigState({
		globalConfigPath,
		projectConfigPath,
		globalConfig,
		projectConfig,
	});
}

export async function saveRuntimeConfig(
	cwd: string,
	config: {
		selectedAgentId: RuntimeAgentId;
		shortcuts: RuntimeProjectShortcut[];
	},
): Promise<RuntimeConfigState> {
	const globalConfigPath = getRuntimeGlobalConfigPath();
	const projectConfigPath = getRuntimeProjectConfigPath(cwd);
	await writeRuntimeGlobalConfigFile(globalConfigPath, { selectedAgentId: config.selectedAgentId });
	await writeRuntimeProjectConfigFile(projectConfigPath, { shortcuts: config.shortcuts });
	return {
		globalConfigPath,
		projectConfigPath,
		selectedAgentId: normalizeAgentId(config.selectedAgentId),
		shortcuts: normalizeShortcuts(config.shortcuts),
	};
}
