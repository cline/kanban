import { accessSync, constants } from "node:fs";
import { extname, join } from "node:path";

const WINDOWS_CMD_META_CHARS_REGEXP = /([()\][%!^"`<>&|;, *?])/g;
const WINDOWS_CMD_EXTENSIONS = new Set([".cmd", ".bat"]);
const WINDOWS_DIRECT_EXTENSIONS = new Set([".exe", ".com"]);
const DEFAULT_WINDOWS_PATHEXT = [".COM", ".EXE", ".BAT", ".CMD"];

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

function resolveWindowsBinaryExtension(binary: string, env: NodeJS.ProcessEnv): string | null {
	const trimmed = binary.trim();
	if (!trimmed) {
		return null;
	}

	const extension = extname(trimmed);
	if (extension) {
		return extension.toLowerCase();
	}

	const pathExtensions = getWindowsPathExtensions(env);
	const hasDirectorySeparators = trimmed.includes("\\") || trimmed.includes("/");
	if (hasDirectorySeparators) {
		for (const pathExtension of pathExtensions) {
			const candidate = `${trimmed}${pathExtension}`;
			if (canAccessPath(candidate)) {
				return pathExtension.toLowerCase();
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
				return pathExtension.toLowerCase();
			}
		}
	}
	return null;
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
