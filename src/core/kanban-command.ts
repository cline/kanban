export interface RuntimeInvocationContext {
	execPath: string;
	argv: string[];
	execArgv?: string[];
}

function resolveNodeCommandPrefix(context: RuntimeInvocationContext): string[] {
	const execArgv = context.execArgv ?? [];
	if (execArgv.length === 0) {
		return [context.execPath];
	}
	return [context.execPath, ...execArgv];
}

function isLikelyTsxCliEntrypoint(value: string): boolean {
	const normalized = value.replaceAll("\\", "/").toLowerCase();
	if (normalized.endsWith("/tsx") || normalized.endsWith("/tsx.js")) {
		return true;
	}
	return normalized.includes("/tsx/") && normalized.endsWith("/cli.mjs");
}

function looksLikeEntrypointPath(value: string): boolean {
	if (!value) {
		return false;
	}
	if (value.includes("/") || value.includes("\\")) {
		return true;
	}
	if (/\.(?:mjs|cjs|js|ts|mts|cts)$/iu.test(value)) {
		return true;
	}
	return /kanban(?:\.(?:cmd|ps1|exe))?$/iu.test(value);
}

/**
 * Resolve the shell command parts needed to invoke the Kanban CLI.
 *
 * Resolution priority:
 *   1. KANBAN_CLI_COMMAND env var — set explicitly by the desktop app or by
 *      the user.  This is the single source of truth for packaged desktop
 *      builds and avoids any inference from process.execPath / argv, which
 *      are unreliable inside Electron.
 *   2. Standard Node.js inference from process.execPath and argv — works for
 *      CLI-launched runtimes, tsx dev servers, and npm global installs.
 */
export function resolveKanbanCommandParts(
	context: RuntimeInvocationContext = {
		execPath: process.execPath,
		argv: process.argv,
		execArgv: process.execArgv,
	},
): string[] {
	// Priority 1: explicit env var — set by the desktop app or by the user.
	// This completely bypasses process-path inference, which is the right
	// thing to do inside Electron where execPath is the helper binary.
	const envOverride = process.env.KANBAN_CLI_COMMAND?.trim();
	if (envOverride) {
		return envOverride.split(/\s+/);
	}

	// Priority 2: infer from process.execPath / argv (CLI context).
	const commandPrefix = resolveNodeCommandPrefix(context);
	const entrypoint = context.argv[1];
	if (!entrypoint || !looksLikeEntrypointPath(entrypoint)) {
		return commandPrefix;
	}

	const tsxTarget = context.argv[2];
	if (tsxTarget && isLikelyTsxCliEntrypoint(entrypoint) && looksLikeEntrypointPath(tsxTarget)) {
		return [...commandPrefix, entrypoint, tsxTarget];
	}

	return [...commandPrefix, entrypoint];
}

export function buildKanbanCommandParts(
	args: string[],
	context: RuntimeInvocationContext = {
		execPath: process.execPath,
		argv: process.argv,
		execArgv: process.execArgv,
	},
): string[] {
	return [...resolveKanbanCommandParts(context), ...args];
}
