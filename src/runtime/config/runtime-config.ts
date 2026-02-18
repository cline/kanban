import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

interface RuntimeConfigFileShape {
	acpCommand?: string;
}

export interface RuntimeConfigState {
	configPath: string;
	acpCommand: string | null;
}

function normalizeCommand(command: string | null | undefined): string | null {
	if (typeof command !== "string") {
		return null;
	}
	const trimmed = command.trim();
	return trimmed ? trimmed : null;
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
		};
	} catch {
		return {
			configPath,
			acpCommand: null,
		};
	}
}

export async function saveRuntimeConfig(cwd: string, acpCommand: string | null): Promise<RuntimeConfigState> {
	const configPath = getRuntimeConfigPath(cwd);
	const normalized = normalizeCommand(acpCommand);

	await mkdir(dirname(configPath), { recursive: true });
	await writeFile(
		configPath,
		JSON.stringify(
			{
				acpCommand: normalized,
			},
			null,
			2,
		),
		"utf8",
	);

	return {
		configPath,
		acpCommand: normalized,
	};
}
