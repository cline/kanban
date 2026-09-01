import { basename, delimiter, dirname, isAbsolute } from "node:path";

import { resolveBinaryOnPath } from "./command-discovery";

export const GENPRO_EXECUTABLE_ENV = "KANBAN_GENPRO_EXECUTABLE";
export const GENPRO_CODEX_EXECUTABLE_ENV = "KANBAN_GENPRO_CODEX_EXECUTABLE";

function configuredAbsoluteExecutable(
	environment: NodeJS.ProcessEnv,
	name: typeof GENPRO_EXECUTABLE_ENV | typeof GENPRO_CODEX_EXECUTABLE_ENV,
): string | null {
	if (!Object.hasOwn(environment, name)) {
		return null;
	}
	const configured = environment[name]?.trim() ?? "";
	if (!configured) {
		throw new Error(`${name} must be a non-empty absolute executable path`);
	}
	if (!isAbsolute(configured)) {
		throw new Error(`${name} must be an absolute executable path`);
	}
	const resolved = resolveBinaryOnPath(configured);
	if (!resolved) {
		throw new Error(`${name} does not identify an accessible executable: ${configured}`);
	}
	return resolved;
}

export function resolveGenproExecutable(
	requestedBinary = "genpro-supervisor-adapter",
	environment: NodeJS.ProcessEnv = process.env,
): string {
	const configured = configuredAbsoluteExecutable(environment, GENPRO_EXECUTABLE_ENV);
	if (configured) {
		return configured;
	}
	const discovered = resolveBinaryOnPath(requestedBinary, environment);
	if (!discovered) {
		throw new Error(
			`GenPro Supervisor launcher was not found; set ${GENPRO_EXECUTABLE_ENV} to its absolute executable path`,
		);
	}
	return discovered;
}

export function resolveOptionalGenproExecutable(
	requestedBinary = "genpro-supervisor-adapter",
	environment: NodeJS.ProcessEnv = process.env,
): string | null {
	try {
		return resolveGenproExecutable(requestedBinary, environment);
	} catch {
		return null;
	}
}

export function buildGenproProviderDiscoveryEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
	const codexExecutable = configuredAbsoluteExecutable(environment, GENPRO_CODEX_EXECUTABLE_ENV);
	if (!codexExecutable) {
		return {};
	}
	const executableName = process.platform === "win32" ? "codex.exe" : "codex";
	if (basename(codexExecutable).toLowerCase() !== executableName) {
		throw new Error(`${GENPRO_CODEX_EXECUTABLE_ENV} must identify an executable named ${executableName}`);
	}
	const currentPath = environment.PATH?.trim();
	return {
		PATH: currentPath ? `${dirname(codexExecutable)}${delimiter}${currentPath}` : dirname(codexExecutable),
	};
}
