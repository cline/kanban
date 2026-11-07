import { accessSync, constants, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";

const WINDOWS_CMD_META_CHARS_REGEXP = /([()\][%!^"`<>&|;, *?])/g;
const WINDOWS_CMD_EXTENSIONS = new Set([".cmd", ".bat"]);
const WINDOWS_DIRECT_EXTENSIONS = new Set([".exe", ".com"]);
const DEFAULT_WINDOWS_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];
const WINDOWS_BATCH_INDIRECT_NODE_PATTERN = /"%_prog%"\s+"([^"]+\.(?:c?js|mjs))"\s+%\*/i;
// Match a quoted or bare `node(.exe)` command token, not an exact fixed path,
// because Yarn/pnpm-style shims can invoke either a bundled node.exe or PATH node.
const WINDOWS_BATCH_DIRECT_NODE_PATTERN =
	/(?:"([^"]*node(?:\.exe)?)"|\b(node(?:\.exe)?)\b)\s+"([^"]+\.(?:c?js|mjs))"\s+%\*/i;
const WINDOWS_BATCH_DIRECT_EXECUTABLE_PATTERN = /"([^"]+\.(?:exe|com))"\s+%\*/i;

interface WindowsResolvedLaunch {
	binary: string;
	args: string[];
}

// `process.env` behaves case-insensitively on Windows, but once we copy env into a
// plain object for child-process merging we need to preserve that behavior ourselves.
function getWindowsEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
	const directValue = env[key];
	if (typeof directValue === "string") {
		return directValue;
	}

	const normalizedKey = key.toLowerCase();
	for (const [entryKey, entryValue] of Object.entries(env)) {
		if (entryKey.toLowerCase() !== normalizedKey) {
			continue;
		}
		if (typeof entryValue === "string") {
			return entryValue;
		}
	}

	return undefined;
}

function canAccessPath(path: string): boolean {
	try {
		accessSync(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function normalizeWindowsPathExtension(extension: string): string {
	if (!extension) {
		return extension;
	}
	return extension.startsWith(".") ? extension : `.${extension}`;
}

function getWindowsPathExtensions(env: NodeJS.ProcessEnv): string[] {
	const configured = getWindowsEnvValue(env, "PATHEXT")
		?.split(";")
		.map((entry) => normalizeWindowsPathExtension(entry.trim()))
		.filter(Boolean);
	if (!configured || configured.length === 0) {
		return DEFAULT_WINDOWS_PATHEXT;
	}
	return configured;
}

function resolveWindowsBinaryPath(binary: string, env: NodeJS.ProcessEnv): string | null {
	const trimmed = binary.trim();
	if (!trimmed) {
		return null;
	}

	const extension = extname(trimmed);
	if (extension) {
		if (trimmed.includes("\\") || trimmed.includes("/")) {
			return canAccessPath(trimmed) ? trimmed : null;
		}
		if (canAccessPath(trimmed)) {
			return trimmed;
		}
		const pathEntries = (getWindowsEnvValue(env, "PATH") ?? "")
			.split(";")
			.map((entry) => entry.trim())
			.filter(Boolean);
		for (const pathEntry of pathEntries) {
			const candidate = join(pathEntry, trimmed);
			if (canAccessPath(candidate)) {
				return candidate;
			}
		}
		return null;
	}

	const pathExtensions = getWindowsPathExtensions(env);
	const hasDirectorySeparators = trimmed.includes("\\") || trimmed.includes("/");
	if (hasDirectorySeparators) {
		for (const pathExtension of pathExtensions) {
			const candidate = `${trimmed}${pathExtension}`;
			if (canAccessPath(candidate)) {
				return candidate;
			}
		}
		return null;
	}

	const pathEntries = (getWindowsEnvValue(env, "PATH") ?? "")
		.split(";")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (pathEntries.length === 0) {
		return null;
	}

	for (const pathEntry of pathEntries) {
		for (const pathExtension of pathExtensions) {
			const candidate = join(pathEntry, `${trimmed}${pathExtension}`);
			if (canAccessPath(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

function resolveWindowsBinaryExtension(binary: string, env: NodeJS.ProcessEnv): string | null {
	const resolvedBinaryPath = resolveWindowsBinaryPath(binary, env);
	if (resolvedBinaryPath) {
		return extname(resolvedBinaryPath).toLowerCase();
	}

	const trimmed = binary.trim();
	if (!trimmed) {
		return null;
	}

	const extension = extname(trimmed);
	return extension ? extension.toLowerCase() : null;
}

function resolveWindowsBatchShimPath(value: string, shimPath: string): string {
	const shimDirectory = dirname(shimPath);
	const dp0 = shimDirectory.endsWith("\\") ? shimDirectory : `${shimDirectory}\\`;
	const expanded = value.replace(/%dp0%/gi, dp0);
	if (isAbsolute(expanded)) {
		return resolve(expanded);
	}
	return resolve(shimDirectory, expanded);
}

function resolveWindowsBatchShimNodeBinary(shimPath: string, env: NodeJS.ProcessEnv): string | null {
	const bundledNode = join(dirname(shimPath), "node.exe");
	if (canAccessPath(bundledNode)) {
		return bundledNode;
	}

	return resolveWindowsBinaryPath("node", env);
}

function readWindowsBatchShim(shimPath: string): string | null {
	try {
		return readFileSync(shimPath, "utf8");
	} catch {
		return null;
	}
}

export function resolveWindowsBatchShimLaunch(
	binary: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): WindowsResolvedLaunch | null {
	if (platform !== "win32") {
		return null;
	}

	const resolvedBinaryPath = resolveWindowsBinaryPath(binary, env);
	if (!resolvedBinaryPath) {
		return null;
	}

	const resolvedExtension = extname(resolvedBinaryPath).toLowerCase();
	if (!WINDOWS_CMD_EXTENSIONS.has(resolvedExtension)) {
		return null;
	}

	const shimContent = readWindowsBatchShim(resolvedBinaryPath);
	if (!shimContent) {
		return null;
	}

	const indirectNodeMatch = shimContent.match(WINDOWS_BATCH_INDIRECT_NODE_PATTERN);
	if (indirectNodeMatch) {
		const nodeBinary = resolveWindowsBatchShimNodeBinary(resolvedBinaryPath, env);
		if (!nodeBinary) {
			return null;
		}
		const scriptPath = resolveWindowsBatchShimPath(indirectNodeMatch[1], resolvedBinaryPath);
		return {
			binary: nodeBinary,
			args: [scriptPath, ...args],
		};
	}

	const directNodeMatch = shimContent.match(WINDOWS_BATCH_DIRECT_NODE_PATTERN);
	if (directNodeMatch) {
		const nodeBinaryToken = directNodeMatch[1] || directNodeMatch[2];
		const scriptPath = resolveWindowsBatchShimPath(directNodeMatch[3], resolvedBinaryPath);
		let nodeBinary: string | null = null;
		if (nodeBinaryToken) {
			const normalizedNodeBinaryToken = nodeBinaryToken.trim().toLowerCase();
			if (normalizedNodeBinaryToken === "node" || normalizedNodeBinaryToken === "node.exe") {
				nodeBinary = resolveWindowsBatchShimNodeBinary(resolvedBinaryPath, env);
			} else {
				nodeBinary = resolveWindowsBatchShimPath(nodeBinaryToken, resolvedBinaryPath);
			}
		}
		if (!nodeBinary || !canAccessPath(nodeBinary)) {
			return null;
		}
		return {
			binary: nodeBinary,
			args: [scriptPath, ...args],
		};
	}

	const directExecutableMatch = shimContent.match(WINDOWS_BATCH_DIRECT_EXECUTABLE_PATTERN);
	if (directExecutableMatch) {
		const executablePath = resolveWindowsBatchShimPath(directExecutableMatch[1], resolvedBinaryPath);
		if (!canAccessPath(executablePath)) {
			return null;
		}
		return {
			binary: executablePath,
			args: [...args],
		};
	}

	return null;
}

export function resolveWindowsSpawnLaunch(
	binary: string,
	args: string[],
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): { binary: string; args: string[]; useCmdShell: boolean } {
	const resolvedBatchShimLaunch = resolveWindowsBatchShimLaunch(binary, args, platform, env);
	if (resolvedBatchShimLaunch) {
		return {
			...resolvedBatchShimLaunch,
			useCmdShell: false,
		};
	}

	if (!shouldUseWindowsCmdLaunch(binary, platform, env)) {
		return {
			binary,
			args,
			useCmdShell: false,
		};
	}

	return {
		binary: resolveWindowsComSpec(env),
		args,
		useCmdShell: true,
	};
}

function normalizeWindowsCmdArgument(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "\\n");
}

function escapeWindowsCommand(value: string): string {
	return value.replace(WINDOWS_CMD_META_CHARS_REGEXP, "^$1");
}

function escapeWindowsArgument(value: string): string {
	let escaped = normalizeWindowsCmdArgument(`${value}`);
	escaped = escaped.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
	escaped = escaped.replace(/(?=(\\+?)?)\1$/g, "$1$1");
	escaped = `"${escaped}"`;
	escaped = escaped.replace(WINDOWS_CMD_META_CHARS_REGEXP, "^$1");
	return escaped;
}

export function resolveWindowsComSpec(env: NodeJS.ProcessEnv = process.env): string {
	const comSpec = getWindowsEnvValue(env, "ComSpec")?.trim();
	return comSpec || "cmd.exe";
}

export function buildWindowsCmdArgsCommandLine(binary: string, args: string[]): string {
	const escapedCommand = escapeWindowsCommand(binary);
	const escapedArgs = args.map((part) => escapeWindowsArgument(part));
	const shellCommand = [escapedCommand, ...escapedArgs].join(" ");
	return `/d /s /c "${shellCommand}"`;
}

export function buildWindowsCmdArgsArray(binary: string, args: string[]): string[] {
	const escapedCommand = escapeWindowsCommand(binary);
	const escapedArgs = args.map((part) => escapeWindowsArgument(part));
	const shellCommand = [escapedCommand, ...escapedArgs].join(" ");
	return ["/d", "/s", "/c", `"${shellCommand}"`];
}

export function shouldUseWindowsCmdLaunch(
	binary: string,
	platform: NodeJS.Platform = process.platform,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	if (platform !== "win32") {
		return false;
	}
	const normalized = binary.trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	if (normalized === "cmd" || normalized === "cmd.exe") {
		return false;
	}
	if (normalized === resolveWindowsComSpec(env).toLowerCase()) {
		return false;
	}

	const explicitExtension = extname(normalized).toLowerCase();
	if (WINDOWS_CMD_EXTENSIONS.has(explicitExtension)) {
		return true;
	}
	if (WINDOWS_DIRECT_EXTENSIONS.has(explicitExtension)) {
		return false;
	}

	const resolvedExtension = resolveWindowsBinaryExtension(binary, env);
	if (resolvedExtension && WINDOWS_DIRECT_EXTENSIONS.has(resolvedExtension)) {
		return false;
	}
	if (resolvedExtension && WINDOWS_CMD_EXTENSIONS.has(resolvedExtension)) {
		return true;
	}

	return true;
}
