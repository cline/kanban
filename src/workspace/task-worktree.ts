import { execFile } from "node:child_process";
import { access, lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import type {
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "../core/api-contract.js";
import { createGitProcessEnv } from "../core/git-process-env.js";
import { getRuntimeHomePath, loadWorkspaceContext } from "../state/workspace-state.js";

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const WORKTREES_DIR = "worktrees";

const SYMLINK_PATH_SEGMENT_BLACKLIST = new Set([
	".git",
	".DS_Store",
	"Thumbs.db",
	"Desktop.ini",
	"Icon\r",
	".Spotlight-V100",
	".Trashes",
]);

function normalizeTaskId(taskId: string): string {
	const normalized = taskId.trim();
	if (!normalized || normalized.includes("/") || normalized.includes("\\") || normalized.includes("..")) {
		throw new Error("Invalid task id for worktree path.");
	}
	return normalized;
}

function getWorkspaceFolderLabel(repoPath: string): string {
	const trimmed = repoPath.trim().replace(/[\\/]+$/g, "");
	const folder = basename(trimmed);
	if (!folder) {
		return "workspace";
	}
	const cleaned = [...folder]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.trim();
	return cleaned || "workspace";
}

function toPlatformRelativePath(path: string): string {
	return path
		.trim()
		.replace(/\/+$/g, "")
		.split("/")
		.filter((segment) => segment.length > 0)
		.join("/");
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function runGit(args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, {
		encoding: "utf8",
		maxBuffer: GIT_MAX_BUFFER_BYTES,
		env: createGitProcessEnv(),
	});
	return String(stdout).trim();
}

function getGitCommandErrorMessage(error: unknown): string {
	if (error && typeof error === "object" && "stderr" in error) {
		const stderr = (error as { stderr?: unknown }).stderr;
		if (typeof stderr === "string" && stderr.trim()) {
			return stderr.trim();
		}
	}
	return error instanceof Error ? error.message : String(error);
}

async function tryRunGit(args: string[]): Promise<string | null> {
	try {
		return await runGit(args);
	} catch {
		return null;
	}
}

async function readGitHeadInfo(cwd: string): Promise<{
	branch: string | null;
	headCommit: string | null;
	isDetached: boolean;
}> {
	const headCommit = await tryRunGit(["-C", cwd, "rev-parse", "--verify", "HEAD"]);
	const branch = await tryRunGit(["-C", cwd, "symbolic-ref", "--quiet", "--short", "HEAD"]);
	return {
		branch,
		headCommit,
		isDetached: headCommit !== null && branch === null,
	};
}

function getWorktreesRootPath(taskId: string): string {
	const normalizedTaskId = normalizeTaskId(taskId);
	return join(getRuntimeHomePath(), WORKTREES_DIR, normalizedTaskId);
}

function getWorktreesBaseRootPath(): string {
	return join(getRuntimeHomePath(), WORKTREES_DIR);
}

function getTaskWorktreePath(repoPath: string, taskId: string): string {
	const workspaceLabel = getWorkspaceFolderLabel(repoPath);
	return join(getWorktreesRootPath(taskId), workspaceLabel);
}

function shouldSkipSymlink(relativePath: string): boolean {
	const segments = relativePath.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return true;
	}
	return segments.some((segment) => SYMLINK_PATH_SEGMENT_BLACKLIST.has(segment));
}

function isPathWithinRoot(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}

function isPathWithinAnyRoot(path: string, roots: Set<string>): boolean {
	for (const root of roots) {
		if (isPathWithinRoot(path, root)) {
			return true;
		}
	}
	return false;
}

function getRootIgnoredPaths(relativePaths: string[]): string[] {
	const uniquePaths = Array.from(new Set(relativePaths.map((path) => toPlatformRelativePath(path)).filter(Boolean)));
	uniquePaths.sort((left, right) => {
		const leftDepth = left.split("/").length;
		const rightDepth = right.split("/").length;
		if (leftDepth !== rightDepth) {
			return leftDepth - rightDepth;
		}
		return left.localeCompare(right);
	});

	const roots: string[] = [];
	for (const path of uniquePaths) {
		if (roots.some((root) => isPathWithinRoot(path, root))) {
			continue;
		}
		roots.push(path);
	}

	return roots;
}

async function listIgnoredPaths(repoPath: string): Promise<string[]> {
	const output = await runGit([
		"-C",
		repoPath,
		"ls-files",
		"--others",
		"--ignored",
		"--exclude-per-directory=.gitignore",
		"--directory",
	]);
	return output
		.split("\n")
		.map((line) => toPlatformRelativePath(line))
		.filter((line) => line.length > 0);
}

function isIgnoredByOwnNestedRule(ignoredPath: string, ignoreSourcePath: string): boolean {
	const normalizedIgnoredPath = toPlatformRelativePath(ignoredPath);
	const normalizedIgnoreSourcePath = toPlatformRelativePath(ignoreSourcePath);
	if (!normalizedIgnoredPath || !normalizedIgnoreSourcePath) {
		return false;
	}
	return normalizedIgnoreSourcePath.startsWith(`${normalizedIgnoredPath}/`);
}

function parseCheckIgnoreVerboseLine(line: string): { ignoredPath: string; ignoreSourcePath: string } | null {
	const [sourceMetadata, ignoredPathRaw] = line.split("\t");
	if (!sourceMetadata || !ignoredPathRaw) {
		return null;
	}

	const sourceMatch = sourceMetadata.match(/^(.*):(\d+):(.*)$/u);
	if (!sourceMatch) {
		return null;
	}

	const ignoreSourcePath = toPlatformRelativePath(sourceMatch[1] ?? "");
	const ignoredPath = toPlatformRelativePath(ignoredPathRaw);
	if (!ignoreSourcePath || !ignoredPath) {
		return null;
	}

	return {
		ignoredPath,
		ignoreSourcePath,
	};
}

async function listSelfIgnoredPaths(repoPath: string, relativePaths: string[]): Promise<Set<string>> {
	// Some tool-managed directories are ignored by nested rules inside the directory itself,
	// e.g. Husky's `.husky/_/.gitignore` with `*` ignores `.husky/_/`.
	// If we symlink those directories into a worktree, git won't apply the nested ignore rule
	// through the symlink boundary and the path shows up as untracked (`?? .husky/_`).
	// We detect those root paths and skip symlinking them.
	const rootIgnoredPaths = getRootIgnoredPaths(relativePaths);
	if (rootIgnoredPaths.length === 0) {
		return new Set<string>();
	}

	const selfIgnoredPaths = new Set<string>();
	for (const relativePath of rootIgnoredPaths) {
		const sourcePath = join(repoPath, relativePath);
		const sourceStat = await lstat(sourcePath).catch(() => null);
		if (!sourceStat?.isDirectory()) {
			continue;
		}

		const output = await tryRunGit(["-C", repoPath, "check-ignore", "-v", "--", `${relativePath}/`]);
		if (!output) {
			continue;
		}

		const parsed = parseCheckIgnoreVerboseLine(output.split("\n")[0] ?? "");
		if (!parsed) {
			continue;
		}
		if (parsed.ignoredPath !== relativePath) {
			continue;
		}
		if (isIgnoredByOwnNestedRule(relativePath, parsed.ignoreSourcePath)) {
			selfIgnoredPaths.add(relativePath);
		}
	}

	return selfIgnoredPaths;
}

async function symlinkIgnoredPaths(repoPath: string, worktreePath: string): Promise<void> {
	const ignoredPaths = await listIgnoredPaths(repoPath);
	const selfIgnoredRootPaths = await listSelfIgnoredPaths(repoPath, ignoredPaths);
	for (const relativePath of ignoredPaths) {
		if (shouldSkipSymlink(relativePath)) {
			continue;
		}

		if (isPathWithinAnyRoot(relativePath, selfIgnoredRootPaths)) {
			continue;
		}

		const sourcePath = join(repoPath, relativePath);
		if (!(await pathExists(sourcePath))) {
			continue;
		}

		const targetPath = join(worktreePath, relativePath);
		if (await pathExists(targetPath)) {
			continue;
		}

		const sourceStat = await lstat(sourcePath);
		await mkdir(dirname(targetPath), { recursive: true });
		await symlink(sourcePath, targetPath, sourceStat.isDirectory() ? "dir" : "file");
	}
}

async function removeTaskWorktreeInternal(repoPath: string, worktreePath: string): Promise<boolean> {
	const existed = await pathExists(worktreePath);
	await tryRunGit(["-C", repoPath, "worktree", "remove", "--force", worktreePath]);
	await rm(worktreePath, { recursive: true, force: true });
	return existed;
}

async function pruneEmptyParents(rootPath: string, fromPath: string): Promise<void> {
	let current = fromPath;
	while (current.startsWith(rootPath) && current !== rootPath) {
		try {
			const entries = await readdir(current);
			if (entries.length > 0) {
				return;
			}
			await rm(current, { recursive: true, force: true });
			current = dirname(current);
		} catch {
			return;
		}
	}
}

export async function ensureTaskWorktreeIfDoesntExist(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<RuntimeWorktreeEnsureResponse> {
	try {
		const context = await loadWorkspaceContext(options.cwd);
		const taskId = normalizeTaskId(options.taskId);
		const worktreePath = getTaskWorktreePath(context.repoPath, taskId);
		// Investigation note: ensure is called on every task start. The previous implementation
		// compared the worktree HEAD to the latest baseRef commit and recreated the worktree
		// when the base branch advanced, which could destroy valid task progress. Existing
		// worktrees are now treated as authoritative and only missing worktrees are created.
		const existingCommit = await tryRunGit(["-C", worktreePath, "rev-parse", "HEAD"]);
		if (existingCommit) {
			return {
				ok: true,
				path: worktreePath,
				baseRef: options.baseRef.trim(),
				baseCommit: existingCommit,
			};
		}

		const requestedBaseRef = options.baseRef.trim();
		if (!requestedBaseRef) {
			return {
				ok: false,
				path: null,
				baseRef: requestedBaseRef,
				baseCommit: null,
				error: "Task base branch is required for worktree creation.",
			};
		}

		let baseCommit: string;
		try {
			baseCommit = await runGit(["-C", context.repoPath, "rev-parse", "--verify", `${requestedBaseRef}^{commit}`]);
		} catch (error) {
			return {
				ok: false,
				path: null,
				baseRef: requestedBaseRef,
				baseCommit: null,
				error: getGitCommandErrorMessage(error),
			};
		}

		if (await pathExists(worktreePath)) {
			await removeTaskWorktreeInternal(context.repoPath, worktreePath);
		}

		await mkdir(dirname(worktreePath), { recursive: true });
		await runGit(["-C", context.repoPath, "worktree", "add", "--detach", worktreePath, baseCommit]);
		await symlinkIgnoredPaths(context.repoPath, worktreePath);

		return {
			ok: true,
			path: worktreePath,
			baseRef: requestedBaseRef,
			baseCommit,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			path: null,
			baseRef: options.baseRef.trim(),
			baseCommit: null,
			error: message,
		};
	}
}

export async function deleteTaskWorktree(options: {
	repoPath: string;
	taskId: string;
}): Promise<RuntimeWorktreeDeleteResponse> {
	try {
		const taskId = normalizeTaskId(options.taskId);
		const rootPath = getWorktreesBaseRootPath();
		const worktreePath = getTaskWorktreePath(options.repoPath, taskId);
		const removed = await removeTaskWorktreeInternal(options.repoPath, worktreePath);
		await pruneEmptyParents(rootPath, dirname(worktreePath));

		return {
			ok: true,
			removed,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			removed: false,
			error: message,
		};
	}
}

export async function resolveTaskCwd(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
	ensure?: boolean;
}): Promise<string> {
	const context = await loadWorkspaceContext(options.cwd);

	const normalizedBaseRef = options.baseRef.trim();
	if (!normalizedBaseRef) {
		throw new Error("Task base branch is required for task workspace resolution.");
	}

	if (options.ensure) {
		const ensured = await ensureTaskWorktreeIfDoesntExist({
			cwd: options.cwd,
			taskId: options.taskId,
			baseRef: normalizedBaseRef,
		});
		if (!ensured.ok) {
			throw new Error(ensured.error ?? "Worktree setup failed.");
		}
		return ensured.path;
	}

	const worktreePath = getTaskWorktreePath(context.repoPath, options.taskId);
	if (await pathExists(worktreePath)) {
		return worktreePath;
	}
	throw new Error(`Task worktree not found for task "${options.taskId}".`);
}

export async function getTaskWorkspaceInfo(options: {
	cwd: string;
	taskId: string;
	baseRef: string;
}): Promise<RuntimeTaskWorkspaceInfoResponse> {
	const context = await loadWorkspaceContext(options.cwd);
	const taskId = normalizeTaskId(options.taskId);
	const normalizedBaseRef = options.baseRef.trim();

	if (!normalizedBaseRef) {
		throw new Error("Task base branch is required for task workspace info.");
	}

	const worktreePath = getTaskWorktreePath(context.repoPath, taskId);
	const exists = await pathExists(worktreePath);
	if (!exists) {
		return {
			taskId,
			path: worktreePath,
			exists: false,
			baseRef: normalizedBaseRef,
			branch: null,
			isDetached: false,
			headCommit: null,
		};
	}

	const headInfo = await readGitHeadInfo(worktreePath);
	return {
		taskId,
		path: worktreePath,
		exists: true,
		baseRef: normalizedBaseRef,
		branch: headInfo.branch,
		isDetached: headInfo.isDetached,
		headCommit: headInfo.headCommit,
	};
}
