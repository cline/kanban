import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const NODE_MODULES_RELATIVE_PATH = "node_modules";
const TURBOPACK_SCAN_MAX_DIRECTORY_DEPTH = 3;
const TURBOPACK_SCRIPT_FLAG_PATTERN = /(^|\s)--(?:turbo|turbopack)(?=\s|$)/i;
const TURBOPACK_SCRIPT_ENV_PATTERN = /(^|\s)(?:TURBOPACK|NEXT_TURBOPACK)\s*=\s*(?:1|true|yes)(?=\s|$)/i;
const TURBOPACK_CONFIG_PATTERN = /\bturbopack\b/i;
const NEXT_CONFIG_FILENAMES = [
	"next.config.js",
	"next.config.mjs",
	"next.config.cjs",
	"next.config.ts",
	"next.config.mts",
	"next.config.cts",
];
const TURBOPACK_SCAN_DIRECTORY_SKIP = new Set([".git", ".next", "build", "coverage", "dist", "node_modules"]);

interface PackageJsonShape {
	scripts?: Record<string, unknown>;
	dependencies?: Record<string, unknown>;
	devDependencies?: Record<string, unknown>;
	peerDependencies?: Record<string, unknown>;
}

function toPlatformRelativePath(path: string): string {
	return path
		.trim()
		.replaceAll("\\", "/")
		.replace(/\/+$/g, "")
		.split("/")
		.filter((segment) => segment.length > 0)
		.join("/");
}

function scriptUsesTurbopack(script: string): boolean {
	return TURBOPACK_SCRIPT_FLAG_PATTERN.test(script) || TURBOPACK_SCRIPT_ENV_PATTERN.test(script);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getStringScripts(packageJson: PackageJsonShape): string[] {
	const scripts = packageJson.scripts;
	if (!isObjectRecord(scripts)) {
		return [];
	}

	return Object.values(scripts).filter((script): script is string => typeof script === "string");
}

function packageDependsOnNext(packageJson: PackageJsonShape): boolean {
	for (const dependencyGroup of [
		packageJson.dependencies,
		packageJson.devDependencies,
		packageJson.peerDependencies,
	]) {
		if (!isObjectRecord(dependencyGroup)) {
			continue;
		}

		if ("next" in dependencyGroup) {
			return true;
		}
	}

	return false;
}

function packageLooksLikeNextApp(packageJson: PackageJsonShape): boolean {
	return packageDependsOnNext(packageJson);
}

async function readPackageJson(packageDir: string): Promise<PackageJsonShape | null> {
	try {
		const packageJsonContent = await readFile(join(packageDir, "package.json"), "utf8");
		return JSON.parse(packageJsonContent) as PackageJsonShape;
	} catch {
		return null;
	}
}

async function repoConfigMentionsTurbopack(repoPath: string): Promise<boolean> {
	for (const filename of NEXT_CONFIG_FILENAMES) {
		try {
			const content = await readFile(join(repoPath, filename), "utf8");
			if (TURBOPACK_CONFIG_PATTERN.test(content)) {
				return true;
			}
		} catch {}
	}

	return false;
}

async function packageDirectoryUsesTurbopack(packageDir: string): Promise<boolean> {
	const packageJson = await readPackageJson(packageDir);
	if (!packageJson) {
		return false;
	}

	const scripts = getStringScripts(packageJson);
	const hasTurbopackScript = scripts.some((script) => scriptUsesTurbopack(script));
	if (hasTurbopackScript) {
		return true;
	}

	const hasNextAppHints = packageLooksLikeNextApp(packageJson);
	if (hasNextAppHints) {
		return true;
	}

	const hasTurbopackConfig = await repoConfigMentionsTurbopack(packageDir);
	return hasTurbopackConfig;
}

async function collectNestedPackageDirs(rootDir: string): Promise<string[]> {
	const packageDirs: string[] = [];

	async function visitDirectory(currentDir: string, depth: number): Promise<void> {
		if (depth >= TURBOPACK_SCAN_MAX_DIRECTORY_DEPTH) {
			return;
		}

		const entries = await readdir(currentDir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isDirectory() || TURBOPACK_SCAN_DIRECTORY_SKIP.has(entry.name)) {
				continue;
			}

			const childDir = join(currentDir, entry.name);
			if ((await readPackageJson(childDir)) !== null) {
				packageDirs.push(childDir);
			}

			await visitDirectory(childDir, depth + 1);
		}
	}

	await visitDirectory(rootDir, 0);
	return packageDirs;
}

function getNodeModulesPathForPackageDir(repoPath: string, packageDir: string): string {
	const packageRelativePath = toPlatformRelativePath(relative(repoPath, packageDir));
	return packageRelativePath.length > 0
		? `${packageRelativePath}/${NODE_MODULES_RELATIVE_PATH}`
		: NODE_MODULES_RELATIVE_PATH;
}

export async function listTurbopackNodeModulesSymlinkSkipPaths(repoPath: string): Promise<string[]> {
	const skipPaths = new Set<string>();

	if (await packageDirectoryUsesTurbopack(repoPath)) {
		skipPaths.add(NODE_MODULES_RELATIVE_PATH);
	}

	const nestedPackageDirs = await collectNestedPackageDirs(repoPath);
	for (const packageDir of nestedPackageDirs) {
		if (await packageDirectoryUsesTurbopack(packageDir)) {
			skipPaths.add(getNodeModulesPathForPackageDir(repoPath, packageDir));
		}
	}

	return Array.from(skipPaths).sort();
}
