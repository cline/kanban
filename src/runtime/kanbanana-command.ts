export interface RuntimeInvocationContext {
	execPath: string;
	argv: string[];
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
	return /kanbanana(?:\.(?:cmd|ps1|exe))?$/iu.test(value);
}

export function resolveKanbananaCommandParts(
	context: RuntimeInvocationContext = { execPath: process.execPath, argv: process.argv },
): string[] {
	const entrypoint = context.argv[1];
	if (!entrypoint || !looksLikeEntrypointPath(entrypoint)) {
		return [context.execPath];
	}

	const tsxTarget = context.argv[2];
	if (tsxTarget && isLikelyTsxCliEntrypoint(entrypoint) && looksLikeEntrypointPath(tsxTarget)) {
		return [context.execPath, entrypoint, tsxTarget];
	}

	return [context.execPath, entrypoint];
}

export function buildKanbananaCommandParts(
	args: string[],
	context: RuntimeInvocationContext = { execPath: process.execPath, argv: process.argv },
): string[] {
	return [...resolveKanbananaCommandParts(context), ...args];
}
