import { homedir } from "node:os";
import { join } from "node:path";

interface OpenCodePathCandidatesInput {
	explicitPath?: string | undefined;
	env?: NodeJS.ProcessEnv;
	homePath?: string;
}

function uniquePaths(paths: string[]): string[] {
	const seen = new Set<string>();
	const unique: string[] = [];
	for (const path of paths) {
		const trimmed = path.trim();
		if (!trimmed || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		unique.push(trimmed);
	}
	return unique;
}

function appendFromEnv(paths: string[], envValue: string | undefined, ...segments: string[]): void {
	const root = envValue?.trim();
	if (!root) {
		return;
	}
	paths.push(join(root, ...segments));
}

export function getOpenCodeConfigPathCandidates(input: OpenCodePathCandidatesInput = {}): string[] {
	const env = input.env ?? process.env;
	const homePath = input.homePath ?? homedir();
	const candidates: string[] = [];

	const explicit = input.explicitPath?.trim();
	if (explicit) {
		candidates.push(explicit);
	}

	const envExplicit = env.OPENCODE_CONFIG?.trim();
	if (envExplicit) {
		candidates.push(envExplicit);
	}

	appendFromEnv(candidates, env.APPDATA, "opencode", "config.json");
	appendFromEnv(candidates, env.APPDATA, "opencode", "opencode.jsonc");
	appendFromEnv(candidates, env.APPDATA, "opencode", "opencode.json");
	appendFromEnv(candidates, env.LOCALAPPDATA, "opencode", "config.json");
	appendFromEnv(candidates, env.LOCALAPPDATA, "opencode", "opencode.jsonc");
	appendFromEnv(candidates, env.LOCALAPPDATA, "opencode", "opencode.json");

	candidates.push(
		join(homePath, ".config", "opencode", "config.json"),
		join(homePath, ".config", "opencode", "opencode.jsonc"),
		join(homePath, ".config", "opencode", "opencode.json"),
		join(homePath, ".opencode", "opencode.jsonc"),
		join(homePath, ".opencode", "opencode.json"),
	);

	return uniquePaths(candidates);
}

export function getOpenCodeModelStatePathCandidates(input: Omit<OpenCodePathCandidatesInput, "explicitPath"> = {}): string[] {
	const env = input.env ?? process.env;
	const homePath = input.homePath ?? homedir();
	const candidates: string[] = [];

	appendFromEnv(candidates, env.LOCALAPPDATA, "opencode", "state", "model.json");
	appendFromEnv(candidates, env.APPDATA, "opencode", "state", "model.json");
	candidates.push(join(homePath, ".local", "state", "opencode", "model.json"));

	return uniquePaths(candidates);
}

export function getOpenCodeAuthPathCandidates(input: Omit<OpenCodePathCandidatesInput, "explicitPath"> = {}): string[] {
	const env = input.env ?? process.env;
	const homePath = input.homePath ?? homedir();
	const candidates: string[] = [];

	appendFromEnv(candidates, env.APPDATA, "opencode", "auth.json");
	appendFromEnv(candidates, env.LOCALAPPDATA, "opencode", "auth.json");
	candidates.push(join(homePath, ".local", "share", "opencode", "auth.json"));

	return uniquePaths(candidates);
}
