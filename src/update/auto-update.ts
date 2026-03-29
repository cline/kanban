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
	updateTiming: "startup" | "shutdown";
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
	scheduleShutdownUpdate?: (update: PendingShutdownAutoUpdate) => void;
}

interface ParsedVersion {
	core: number[];
	prerelease: Array<number | string> | null;
}

interface PendingShutdownAutoUpdate {
	command: string;
	args: string[];
	latestVersion: string;
}

const DELETE_DIRECTORY_AFTER_DELAY_SCRIPT = `
const { rmSync } = require("node:fs");

const targetDirectory = process.argv[1];
if (!targetDirectory) {
	process.exit(0);
}

setTimeout(() => {
	try {
		rmSync(targetDirectory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
	} catch {}
}, 750);
`.trim();

let pendingShutdownAutoUpdate: PendingShutdownAutoUpdate | null = null;

function toPosixLowerPath(path: string): string {
	return path.replaceAll("\\", "/").toLowerCase();
}

function toPosixPath(path: string): string {
	return path.replaceAll("\\", "/");
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

function buildShutdownCacheRefreshCommand(cacheDirectory: string): AutoUpdateInstallCommand {
	return {
		command: process.execPath,
		args: ["-e", DELETE_DIRECTORY_AFTER_DELAY_SCRIPT, cacheDirectory],
	};
}

function splitResolvedPath(path: string): {
	hasLeadingSlash: boolean;
	segments: string[];
	normalizedSegments: string[];
} {
	const resolvedPath = toPosixPath(resolve(path));
	const hasLeadingSlash = resolvedPath.startsWith("/");
	const segments = resolvedPath.split("/").filter((_segment, index) => !(hasLeadingSlash && index === 0));
	return {
		hasLeadingSlash,
		segments,
		normalizedSegments: segments.map((segment) => segment.toLowerCase()),
	};
}

function buildDirectoryFromSegments(segments: string[], hasLeadingSlash: boolean, endIndex: number): string | null {
	if (endIndex <= 0 || segments.length < endIndex) {
		return null;
	}
	const directory = segments.slice(0, endIndex).join("/");
	if (directory.length === 0) {
		return null;
	}
	return hasLeadingSlash ? `/${directory}` : directory;
}

function findSegmentSequence(segments: string[], sequence: string[]): number {
	if (sequence.length === 0 || segments.length < sequence.length) {
		return -1;
	}

	for (let index = 0; index <= segments.length - sequence.length; index += 1) {
		let matches = true;
		for (let offset = 0; offset < sequence.length; offset += 1) {
			if (segments[index + offset] !== sequence[offset]) {
				matches = false;
				break;
			}
		}
		if (matches) {
			return index;
		}
	}

	return -1;
}

function extractDirectoryForSegmentSequence(
	entrypointPath: string,
	sequences: string[][],
	trailingSegmentCount: number,
): string | null {
	const { hasLeadingSlash, segments, normalizedSegments } = splitResolvedPath(entrypointPath);

	for (const sequence of sequences) {
		const sequenceIndex = findSegmentSequence(normalizedSegments, sequence);
		if (sequenceIndex < 0) {
			continue;
		}
		const endIndex = sequenceIndex + sequence.length + trailingSegmentCount;
		const requiredSegments = normalizedSegments.slice(sequenceIndex + sequence.length, endIndex);
		if (
			requiredSegments.length !== trailingSegmentCount ||
			requiredSegments.some(
				(segment) => segment.length === 0 || segment === "." || segment === ".." || segment === "node_modules",
			)
		) {
			continue;
		}
		const directory = buildDirectoryFromSegments(segments, hasLeadingSlash, endIndex);
		if (directory) {
			return directory;
		}
	}

	return null;
}

function extractDirectoryForSegmentPattern(entrypointPath: string, pattern: RegExp): string | null {
	const { hasLeadingSlash, segments, normalizedSegments } = splitResolvedPath(entrypointPath);
	const matchingIndex = normalizedSegments.findIndex((segment) => pattern.test(segment));
	return buildDirectoryFromSegments(segments, hasLeadingSlash, matchingIndex + 1);
}

function looksLikeTransientCachePath(path: string): boolean {
	const normalizedPath = toPosixLowerPath(path);
	return (
		normalizedPath.includes("/.npm/_npx/") ||
		normalizedPath.includes("/npm/_npx/") ||
		normalizedPath.includes("/npm-cache/_npx/") ||
		normalizedPath.includes("/.npx/") ||
		normalizedPath.includes("/pnpm/dlx/") ||
		normalizedPath.includes("/.yarn/cache/") ||
		normalizedPath.includes("/bunx-")
	);
}

function detectTransientAutoUpdateInstallation(options: {
	currentVersion: string;
	packageName: string;
	entrypointPath: string;
}): AutoUpdateInstallationInfo | null {
	const npmTag = getNpmTag(options.currentVersion);
	const normalizedPath = toPosixLowerPath(options.entrypointPath);

	if (!normalizedPath.includes(`/node_modules/${options.packageName.toLowerCase()}/`)) {
		return null;
	}

	const npxCacheDirectory = extractDirectoryForSegmentSequence(
		options.entrypointPath,
		[[".npm", "_npx"], ["npm", "_npx"], ["npm-cache", "_npx"], [".npx"]],
		1,
	);
	if (npxCacheDirectory) {
		return {
			packageManager: AutoUpdatePackageManager.NPX,
			npmTag,
			updateCommand: buildShutdownCacheRefreshCommand(npxCacheDirectory),
			updateTiming: "shutdown",
		};
	}

	const pnpmDlxCacheDirectory = extractDirectoryForSegmentSequence(options.entrypointPath, [["pnpm", "dlx"]], 2);
	if (pnpmDlxCacheDirectory) {
		return {
			packageManager: AutoUpdatePackageManager.PNPM,
			npmTag,
			updateCommand: buildShutdownCacheRefreshCommand(pnpmDlxCacheDirectory),
			updateTiming: "shutdown",
		};
	}

	const yarnDlxDirectory = extractDirectoryForSegmentPattern(options.entrypointPath, /^dlx-\d+$/u);
	if (yarnDlxDirectory) {
		return {
			packageManager: AutoUpdatePackageManager.YARN,
			npmTag,
			updateCommand: buildShutdownCacheRefreshCommand(yarnDlxDirectory),
			updateTiming: "shutdown",
		};
	}

	const bunxDirectory = extractDirectoryForSegmentPattern(options.entrypointPath, /^bunx-/u);
	if (bunxDirectory) {
		return {
			packageManager: AutoUpdatePackageManager.BUN,
			npmTag,
			updateCommand: buildShutdownCacheRefreshCommand(bunxDirectory),
			updateTiming: "shutdown",
		};
	}

	return null;
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

	if (isPathInside(options.entrypointPath, options.cwd)) {
		return {
			packageManager: AutoUpdatePackageManager.LOCAL,
			npmTag,
			updateCommand: null,
			updateTiming: "startup",
		};
	}

	const transientInstallation = detectTransientAutoUpdateInstallation({
		currentVersion: options.currentVersion,
		packageName: options.packageName,
		entrypointPath: options.entrypointPath,
	});
	if (transientInstallation) {
		return transientInstallation;
	}

	if (looksLikeTransientCachePath(options.entrypointPath)) {
		return {
			packageManager: AutoUpdatePackageManager.UNKNOWN,
			npmTag,
			updateCommand: null,
			updateTiming: "startup",
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
			updateTiming: "startup",
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
			updateTiming: "startup",
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
			updateTiming: "startup",
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
			updateTiming: "startup",
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
			updateTiming: "startup",
		};
	}

	return {
		packageManager: AutoUpdatePackageManager.UNKNOWN,
		npmTag,
		updateCommand: null,
		updateTiming: "startup",
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
	const child = spawn(resolveUpdateCommandForPlatform(command), args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
		windowsHide: true,
	});
	child.unref();
}

export function resolveUpdateCommandForPlatform(command: string, platform: NodeJS.Platform = process.platform): string {
	if (platform !== "win32") {
		return command;
	}

	if (command === "npm" || command === "pnpm" || command === "yarn") {
		return `${command}.cmd`;
	}

	return command;
}

function schedulePendingShutdownAutoUpdate(update: PendingShutdownAutoUpdate): void {
	pendingShutdownAutoUpdate = update;
}

export function runPendingAutoUpdateOnShutdown(options?: {
	spawnUpdate?: (command: string, args: string[]) => void;
	log?: (message: string) => void;
}): void {
	if (!pendingShutdownAutoUpdate) {
		return;
	}

	const pendingUpdate = pendingShutdownAutoUpdate;
	pendingShutdownAutoUpdate = null;

	const log = options?.log ?? console.log;
	log(`New version ${pendingUpdate.latestVersion} detected. Refreshing cached Kanban for next launch.`);

	const spawnUpdate = options?.spawnUpdate ?? spawnDetachedUpdate;
	spawnUpdate(pendingUpdate.command, pendingUpdate.args);
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
	const scheduleShutdownUpdate = options.scheduleShutdownUpdate ?? schedulePendingShutdownAutoUpdate;

	try {
		const latestVersion = await fetchLatestVersion({
			packageName,
			npmTag: installation.npmTag,
		});

		if (!latestVersion || compareVersions(options.currentVersion, latestVersion) >= 0) {
			return;
		}

		if (installation.updateTiming === "shutdown") {
			scheduleShutdownUpdate({
				command: installation.updateCommand.command,
				args: installation.updateCommand.args,
				latestVersion,
			});
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
