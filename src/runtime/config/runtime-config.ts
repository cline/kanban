import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export function getRuntimeConfigPath(cwd: string): string {
	return join(cwd, ".kanbanana", "config.json");
}

export async function loadRuntimeConfig(cwd: string): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath(cwd);
	try {
		const raw = await readFile(configPath, "utf8");
		const parsed = JSON.parse(raw) as RuntimeConfigFileShape;
		return {
			configPath,
			acpCommand: normalizeCommand(parsed.acpCommand),
			shortcuts: normalizeShortcuts(parsed.shortcuts),
		};
	} catch {
		return {
			configPath,
			acpCommand: null,
			shortcuts: [],
		};
	}
}

export async function saveRuntimeConfig(
	cwd: string,
	config: { acpCommand: string | null; shortcuts: RuntimeProjectShortcut[] },
): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath(cwd);
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
