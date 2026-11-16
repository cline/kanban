import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

function canAccessPath(path: string): boolean {
	try {
		accessSync(path, process.platform === "win32" ? constants.F_OK : constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

function getPathValue(env: NodeJS.ProcessEnv): string | undefined {
	return process.platform === "win32" ? (env.PATH ?? env.Path) : env.PATH;
}

function getWindowsExecutableCandidates(binary: string, env: NodeJS.ProcessEnv): string[] {
	const pathext = (env.PATHEXT ?? process.env.PATHEXT)?.split(";").filter(Boolean) ?? [".COM", ".EXE", ".BAT", ".CMD"];
	const lowerBinary = binary.toLowerCase();
	if (pathext.some((extension) => lowerBinary.endsWith(extension.toLowerCase()))) {
		return [binary];
	}
	return [binary, ...pathext.map((extension) => `${binary}${extension}`)];
}

function normalizePathEntryForComparison(entry: string): string {
	return process.platform === "win32" ? entry.toLowerCase() : entry;
}

function getStandardExecutablePathEntries(): string[] {
	if (process.platform === "win32") {
		return [];
	}

	const entries: string[] = [];
	const homePath = homedir().trim();
	if (homePath.length > 0) {
		entries.push(join(homePath, ".local", "bin"), join(homePath, "bin"));
	}
	return entries;
}

function getExecutableSearchPathEntries(env: NodeJS.ProcessEnv = process.env): string[] {
	const mergedEntries = [...(getPathValue(env) ?? "").split(delimiter), ...getStandardExecutablePathEntries()];
	const searchEntries: string[] = [];
	const seen = new Set<string>();

	for (const candidate of mergedEntries) {
		const normalized = candidate.trim();
		if (normalized.length === 0) {
			continue;
		}
		const comparisonKey = normalizePathEntryForComparison(normalized);
		if (seen.has(comparisonKey)) {
			continue;
		}
		seen.add(comparisonKey);
		searchEntries.push(normalized);
	}

	return searchEntries;
}

export function augmentEnvironmentPath(env: Record<string, string | undefined>): Record<string, string | undefined> {
	const pathEntries = getExecutableSearchPathEntries(env);
	if (pathEntries.length === 0) {
		return env;
	}

	const nextPath = pathEntries.join(delimiter);
	if (getPathValue(env) === nextPath) {
		return env;
	}

	return {
		...env,
		PATH: nextPath,
	};
}

// Intentionally perform PATH inspection in-process instead of spawning `which`, `where`,
// `command -v`, or an interactive shell.
//
// Why this exists:
// Kanban is launched from the user's shell and inherits that shell's environment, including
// PATH and exported variables. For agent detection and other startup-time capability checks,
// the question we care about is "can the current Kanban process directly execute this binary
// from its inherited environment?" A direct PATH scan answers exactly that question.
//
// Why we do not delegate to shell commands:
// 1. Spawning helper commands like `which` or `where` adds unnecessary subprocess overhead
//    to hot paths such as loading runtime config.
// 2. Falling back to `zsh -ic 'command -v ...'` or similar is much worse because it can
//    trigger full interactive shell startup. On machines with heavy shell init like `conda`
//    or `nvm`, doing that repeatedly per task or per config read can freeze the runtime and
//    even make new terminal windows feel hung while the machine is saturated.
// 3. Depending on external lookup commands is also less robust than inspecting PATH directly.
//    For example, detection should not depend on `which` itself being available on PATH.
//
// GUI app launches can still arrive with a reduced PATH that omits common user-local install
// locations such as ~/.local/bin. Instead of shelling out to reconstruct the user's login
// environment, we deterministically append a short allowlist of home-directory executable
// directories before scanning. That keeps startup predictable while covering the most common
// packaged-app PATH gaps without broadening detection to unrelated system-wide installs.
//
// Why this is acceptable:
// If a binary is only available after re-running shell init files, Kanban should treat it as
// unavailable for task-agent startup. That keeps behavior predictable and aligned with the
// environment the Kanban process already has, instead of silently relying on hidden shell
// side effects.
export function isBinaryAvailableOnPath(binary: string, env: NodeJS.ProcessEnv = process.env): boolean {
	const trimmed = binary.trim();
	if (!trimmed) {
		return false;
	}
	if (trimmed.includes("/") || trimmed.includes("\\")) {
		return canAccessPath(trimmed);
	}

	const pathEntries = getExecutableSearchPathEntries(env);
	if (pathEntries.length === 0) {
		return false;
	}

	if (process.platform === "win32") {
		const candidates = getWindowsExecutableCandidates(trimmed, env);
		for (const entry of pathEntries) {
			for (const candidate of candidates) {
				if (canAccessPath(join(entry, candidate))) {
					return true;
				}
			}
		}
		return false;
	}

	for (const entry of pathEntries) {
		if (canAccessPath(join(entry, trimmed))) {
			return true;
		}
	}
	return false;
}
