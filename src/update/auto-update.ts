import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

export enum AutoUpdatePackageManager {
	NPM = "npm",
	PNPM = "pnpm",
	YARN = "yarn",
	BUN = "bun",
	NPX = "npx",
	LOCAL = "local",
	UNKNOWN = "unknown",
}

interface AutoUpdateInstallCommand {
	command: string;
	args: string[];
}

interface AutoUpdateInstallationInfo {
	packageManager: AutoUpdatePackageManager;
	npmTag: string;
	updateCommand: AutoUpdateInstallCommand | null;
}

interface FetchLatestVersionInput {
	packageName: string;
	npmTag: string;
}

export interface AutoUpdateStartupOptions {
	currentVersion: string;
	packageName?: string;
	env?: NodeJS.ProcessEnv;
	argv?: string[];
	cwd?: string;
	resolveRealPath?: (path: string) => string;
	fetchLatestVersion?: (input: FetchLatestVersionInput) => Promise<string | null>;
	spawnUpdate?: (command: string, args: string[]) => void;
}

interface ParsedVersion {
	core: number[];
	prerelease: Array<number | string> | null;
}

function toPosixLowerPath(path: string): string {
	return path.replaceAll("\\", "/").toLowerCase();
}

function isPathInside(targetPath: string, containerPath: string): boolean {
	const normalizedTarget = toPosixLowerPath(resolve(targetPath));
	const normalizedContainer = toPosixLowerPath(resolve(containerPath));
	if (normalizedTarget === normalizedContainer) {
		return true;
	}
	return normalizedTarget.startsWith(`${normalizedContainer}/`);
}

function isNightlyVersion(version: string): boolean {
	return version.includes("-nightly.");
}

function getNpmTag(currentVersion: string): string {
	return isNightlyVersion(currentVersion) ? "nightly" : "latest";
}

function parseVersion(version: string): ParsedVersion {
	const versionWithoutBuild = version.split("+", 1)[0] ?? "";
	const [corePart, prereleasePart] = versionWithoutBuild.split("-", 2);
	const core = corePart
		.split(".")
		.filter((part) => part.length > 0)
		.map((part) => Number.parseInt(part, 10));
	const prerelease = prereleasePart
		? prereleasePart
				.split(".")
				.filter((part) => part.length > 0)
				.map((part) => (/^\d+$/u.test(part) ? Number.parseInt(part, 10) : part))
		: null;
	return {
		core,
		prerelease,
	};
}

function comparePrereleaseParts(left: Array<number | string> | null, right: Array<number | string> | null): number {
	if (!left && !right) {
		return 0;
	}
	if (!left) {
		return 1;
	}
	if (!right) {
		return -1;
	}

	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left[index];
		const rightPart = right[index];
		if (leftPart === undefined && rightPart === undefined) {
			return 0;
		}
		if (leftPart === undefined) {
			return -1;
		}
		if (rightPart === undefined) {
			return 1;
		}
		if (leftPart === rightPart) {
			continue;
		}
		if (typeof leftPart === "number" && typeof rightPart === "number") {
			return leftPart > rightPart ? 1 : -1;
		}
		if (typeof leftPart === "number") {
			return -1;
		}
		if (typeof rightPart === "number") {
			return 1;
		}
		return leftPart.localeCompare(rightPart);
	}
	return 0;
}

export function compareVersions(leftVersion: string, rightVersion: string): number {
	const left = parseVersion(leftVersion);
	const right = parseVersion(rightVersion);
	const length = Math.max(left.core.length, right.core.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = left.core[index] ?? 0;
		const rightPart = right.core[index] ?? 0;
		if (leftPart > rightPart) {
			return 1;
		}
		if (leftPart < rightPart) {
			return -1;
		}
	}
	return comparePrereleaseParts(left.prerelease, right.prerelease);
}

export function detectAutoUpdateInstallation(options: {
	currentVersion: string;
	packageName: string;
	entrypointPath: string;
	cwd: string;
}): AutoUpdateInstallationInfo {
	const normalizedPath = toPosixLowerPath(options.entrypointPath);
	const npmTag = getNpmTag(options.currentVersion);

	if (normalizedPath.includes("/.npm/_npx/") || normalizedPath.includes("/npm/_npx/")) {
		return {
			packageManager: AutoUpdatePackageManager.NPX,
			npmTag,
			updateCommand: null,
		};
	}

	if (isPathInside(options.entrypointPath, options.cwd)) {
		return {
			packageManager: AutoUpdatePackageManager.LOCAL,
			npmTag,
			updateCommand: null,
		};
	}

	if (normalizedPath.includes("/.pnpm/global/") || normalizedPath.includes("/pnpm/global/")) {
		return {
			packageManager: AutoUpdatePackageManager.PNPM,
			npmTag,
			updateCommand: {
				command: "pnpm",
				args: ["add", "-g", `${options.packageName}@${npmTag}`],
			},
		};
	}

	if (normalizedPath.includes("/.yarn/") || normalizedPath.includes("/yarn/global/")) {
		return {
			packageManager: AutoUpdatePackageManager.YARN,
			npmTag,
			updateCommand: {
				command: "yarn",
				args: ["global", "add", `${options.packageName}@${npmTag}`],
			},
		};
	}

	if (normalizedPath.includes("/.bun/bin/")) {
		return {
			packageManager: AutoUpdatePackageManager.BUN,
			npmTag,
			updateCommand: {
				command: "bun",
				args: ["add", "-g", `${options.packageName}@${npmTag}`],
			},
		};
	}

	if (normalizedPath.includes(`/lib/node_modules/${options.packageName}/`)) {
		return {
			packageManager: AutoUpdatePackageManager.NPM,
			npmTag,
			updateCommand: {
				command: "npm",
				args: ["install", "-g", `${options.packageName}@${npmTag}`],
			},
		};
	}

	if (normalizedPath.includes(`/node_modules/${options.packageName}/`)) {
		return {
			packageManager: AutoUpdatePackageManager.NPM,
			npmTag,
			updateCommand: {
				command: "npm",
				args: ["install", "-g", `${options.packageName}@${npmTag}`],
			},
		};
	}

	return {
		packageManager: AutoUpdatePackageManager.UNKNOWN,
		npmTag,
		updateCommand: null,
	};
}

function isAutoUpdateDisabled(env: NodeJS.ProcessEnv): boolean {
	if (env.KANBAN_NO_AUTO_UPDATE === "1") {
		return true;
	}
	if (env.NODE_ENV === "test" || env.VITEST === "true") {
		return true;
	}
	if (env.CI === "true") {
		return true;
	}
	return false;
}

async function fetchLatestVersionFromRegistry(input: FetchLatestVersionInput): Promise<string | null> {
	try {
		const response = await fetch(`https://registry.npmjs.org/${input.packageName}/${input.npmTag}`, {
			signal: AbortSignal.timeout(2_500),
		});
		if (!response.ok) {
			return null;
		}
		const payload = (await response.json()) as unknown;
		if (!payload || typeof payload !== "object") {
			return null;
		}
		const version = (payload as { version?: unknown }).version;
		if (typeof version !== "string") {
			return null;
		}
		const normalized = version.trim();
		return normalized.length > 0 ? normalized : null;
	} catch {
		return null;
	}
}

function spawnDetachedUpdate(command: string, args: string[]): void {
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
		windowsHide: true,
	});
	child.unref();
}

export async function runAutoUpdateCheck(options: AutoUpdateStartupOptions): Promise<void> {
	const env = options.env ?? process.env;
	if (isAutoUpdateDisabled(env)) {
		return;
	}

	const entrypointArg = options.argv?.[1] ?? process.argv[1];
	if (!entrypointArg) {
		return;
	}

	const resolveRealPath = options.resolveRealPath ?? ((path: string) => realpathSync(path));
	let entrypointPath: string;
	try {
		entrypointPath = resolveRealPath(entrypointArg);
	} catch {
		return;
	}

	const packageName = options.packageName ?? "kanban";
	const installation = detectAutoUpdateInstallation({
		currentVersion: options.currentVersion,
		packageName,
		entrypointPath,
		cwd: options.cwd ?? process.cwd(),
	});
	if (!installation.updateCommand) {
		return;
	}

	const fetchLatestVersion = options.fetchLatestVersion ?? fetchLatestVersionFromRegistry;
	const spawnUpdate = options.spawnUpdate ?? spawnDetachedUpdate;

	try {
		const latestVersion = await fetchLatestVersion({
			packageName,
			npmTag: installation.npmTag,
		});

		if (!latestVersion || compareVersions(options.currentVersion, latestVersion) >= 0) {
			return;
		}

		spawnUpdate(installation.updateCommand.command, installation.updateCommand.args);
	} catch {
		return;
	}
}

export function autoUpdateOnStartup(options: AutoUpdateStartupOptions): void {
	void runAutoUpdateCheck(options);
}
