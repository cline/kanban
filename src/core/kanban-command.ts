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

export function resolveKanbanCommandParts(
	context: RuntimeInvocationContext = {
		execPath: process.execPath,
		argv: process.argv,
		execArgv: process.execArgv,
	},
): string[] {
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
