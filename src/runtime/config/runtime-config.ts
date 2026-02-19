import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface RuntimeConfigFileShape {
	acpCommand?: string;
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeProjectShortcut {
	id: string;
	label: string;
	command: string;
	icon?: string;
}

export interface RuntimeConfigState {
	configPath: string;
	acpCommand: string | null;
	shortcuts: RuntimeProjectShortcut[];
}

const RUNTIME_HOME_DIR = ".kanbanana";
const CONFIG_FILENAME = "config.json";

function getRuntimeHomePath(): string {
	return join(homedir(), RUNTIME_HOME_DIR);
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

function getLegacyRuntimeHomePath(cwd: string): string {
	return join(cwd, RUNTIME_HOME_DIR);
}

function getLegacyRuntimeConfigPath(cwd: string): string {
	return join(getLegacyRuntimeHomePath(cwd), CONFIG_FILENAME);
}

function toRuntimeConfigState(configPath: string, parsed: RuntimeConfigFileShape | null): RuntimeConfigState {
	return {
		configPath,
		acpCommand: normalizeCommand(parsed?.acpCommand),
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

async function writeRuntimeConfigFile(
	configPath: string,
	config: { acpCommand: string | null; shortcuts: RuntimeProjectShortcut[] },
): Promise<RuntimeConfigState> {
	const normalizedCommand = normalizeCommand(config.acpCommand);
	const normalizedShortcuts = normalizeShortcuts(config.shortcuts);

	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				acpCommand: normalizedCommand,
				shortcuts: normalizedShortcuts,
			},
			null,
			2,
		),
		"utf8",
	);

	return {
		configPath,
		acpCommand: normalizedCommand,
		shortcuts: normalizedShortcuts,
	};
}

async function removeLegacyRuntimeState(cwd: string): Promise<void> {
	const legacyRuntimeHomePath = getLegacyRuntimeHomePath(cwd);
	if (legacyRuntimeHomePath === getRuntimeHomePath()) {
		return;
	}

	await rm(legacyRuntimeHomePath, { recursive: true, force: true });
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath();
	const parsedGlobalConfig = await readRuntimeConfigFile(configPath);
	if (parsedGlobalConfig) {
		await removeLegacyRuntimeState(cwd);
		return toRuntimeConfigState(configPath, parsedGlobalConfig);
	}

	const legacyConfigPath = getLegacyRuntimeConfigPath(cwd);
	const parsedLegacyConfig = await readRuntimeConfigFile(legacyConfigPath);
	if (parsedLegacyConfig) {
		const migrated = await writeRuntimeConfigFile(configPath, {
			acpCommand: normalizeCommand(parsedLegacyConfig.acpCommand),
			shortcuts: normalizeShortcuts(parsedLegacyConfig.shortcuts),
		});
		await removeLegacyRuntimeState(cwd);
		return migrated;
	}

	await removeLegacyRuntimeState(cwd);

	return {
		configPath,
		acpCommand: null,
		shortcuts: [],
	};
}

export async function saveRuntimeConfig(
	cwd: string,
	config: {
		acpCommand: string | null;
		shortcuts: RuntimeProjectShortcut[];
	},
): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath();
	const savedConfig = await writeRuntimeConfigFile(configPath, config);
	await removeLegacyRuntimeState(cwd);
	return savedConfig;
}
