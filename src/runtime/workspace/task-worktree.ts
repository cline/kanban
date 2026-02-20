import { execFile } from "node:child_process";
import { access, lstat, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import type {
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "../api-contract.js";
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
	});
	return String(stdout).trim();
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

async function listIgnoredPaths(repoPath: string): Promise<string[]> {
	const output = await runGit([
		"-C",
		repoPath,
		"ls-files",
		"--others",
		"--ignored",
		"--exclude-standard",
		"--directory",
	]);
	return output
		.split("\n")
		.map((line) => toPlatformRelativePath(line))
		.filter((line) => line.length > 0);
}

async function symlinkIgnoredPaths(repoPath: string, worktreePath: string): Promise<void> {
	const ignoredPaths = await listIgnoredPaths(repoPath);
	for (const relativePath of ignoredPaths) {
		if (shouldSkipSymlink(relativePath)) {
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

function resolveBaseRef(baseRef: string | null | undefined, fallback: string | null): string | null {
	if (baseRef === null) {
		return null;
	}
	if (typeof baseRef === "string") {
		const normalized = baseRef.trim();
		return normalized || null;
	}
	if (fallback?.trim()) {
		return fallback.trim();
	}
	return null;
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

export async function ensureTaskWorktree(options: {
	cwd: string;
	taskId: string;
	baseRef?: string | null;
}): Promise<RuntimeWorktreeEnsureResponse> {
	try {
		const context = await loadWorkspaceContext(options.cwd);
		const taskId = normalizeTaskId(options.taskId);
		if (!context.git.hasGit) {
			return {
				ok: true,
				enabled: false,
				path: context.repoPath,
				baseRef: null,
				baseCommit: null,
			};
		}

		const requestedBaseRef = resolveBaseRef(
			options.baseRef,
			context.git.currentBranch ?? context.git.defaultBranch ?? "HEAD",
		);
		if (!requestedBaseRef) {
			return {
				ok: true,
				enabled: false,
				path: context.repoPath,
				baseRef: null,
				baseCommit: null,
			};
		}

		const baseCommit = await tryRunGit([
			"-C",
			context.repoPath,
			"rev-parse",
			"--verify",
			`${requestedBaseRef}^{commit}`,
		]);
		if (!baseCommit) {
			return {
				ok: false,
				enabled: true,
				path: context.repoPath,
				baseRef: requestedBaseRef,
				baseCommit: null,
				error: `Branch or ref '${requestedBaseRef}' does not exist in this repository.`,
			};
		}

		const worktreePath = getTaskWorktreePath(context.repoPath, taskId);
		const existingCommit = await tryRunGit(["-C", worktreePath, "rev-parse", "HEAD"]);
		if (existingCommit === baseCommit) {
			return {
				ok: true,
				enabled: true,
				path: worktreePath,
				baseRef: requestedBaseRef,
				baseCommit,
			};
		}

		if (existingCommit || (await pathExists(worktreePath))) {
			await removeTaskWorktreeInternal(context.repoPath, worktreePath);
		}

		await mkdir(dirname(worktreePath), { recursive: true });
		await runGit(["-C", context.repoPath, "worktree", "add", "--detach", worktreePath, baseCommit]);
		await symlinkIgnoredPaths(context.repoPath, worktreePath);

		return {
			ok: true,
			enabled: true,
			path: worktreePath,
			baseRef: requestedBaseRef,
			baseCommit,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			enabled: true,
			path: options.cwd,
			baseRef: typeof options.baseRef === "string" ? options.baseRef.trim() || null : null,
			baseCommit: null,
			error: message,
		};
	}
}

export async function deleteTaskWorktree(options: {
	cwd: string;
	taskId: string;
}): Promise<RuntimeWorktreeDeleteResponse> {
	try {
		const context = await loadWorkspaceContext(options.cwd);
		const taskId = normalizeTaskId(options.taskId);
		if (!context.git.hasGit) {
			return {
				ok: true,
				enabled: false,
				removed: false,
			};
		}

		const rootPath = getWorktreesBaseRootPath();
		const worktreePath = getTaskWorktreePath(context.repoPath, taskId);
		const removed = await removeTaskWorktreeInternal(context.repoPath, worktreePath);
		await pruneEmptyParents(rootPath, dirname(worktreePath));

		return {
			ok: true,
			enabled: true,
			removed,
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ok: false,
			enabled: true,
			removed: false,
			error: message,
		};
	}
}

export async function resolveTaskCwd(options: {
	cwd: string;
	taskId: string;
	baseRef?: string | null;
	ensure?: boolean;
}): Promise<string> {
	const context = await loadWorkspaceContext(options.cwd);
	if (!context.git.hasGit) {
		return context.repoPath;
	}

	const normalizedBaseRef = resolveBaseRef(options.baseRef, null);
	if (!normalizedBaseRef) {
		return context.repoPath;
	}

	if (options.ensure) {
		const ensured = await ensureTaskWorktree({
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
	return (await pathExists(worktreePath)) ? worktreePath : context.repoPath;
}

export async function getTaskWorkspaceInfo(options: {
	cwd: string;
	taskId: string;
	baseRef?: string | null;
}): Promise<RuntimeTaskWorkspaceInfoResponse> {
	const context = await loadWorkspaceContext(options.cwd);
	const taskId = normalizeTaskId(options.taskId);
	const normalizedBaseRef = resolveBaseRef(options.baseRef, null);

	if (!context.git.hasGit || !normalizedBaseRef) {
		const headInfo = context.git.hasGit
			? await readGitHeadInfo(context.repoPath)
			: { branch: null, headCommit: null, isDetached: false };
		return {
			taskId,
			mode: "local",
			path: context.repoPath,
			exists: true,
			deleted: false,
			baseRef: null,
			hasGit: context.git.hasGit,
			branch: headInfo.branch,
			isDetached: headInfo.isDetached,
			headCommit: headInfo.headCommit,
		};
	}

	const worktreePath = getTaskWorktreePath(context.repoPath, taskId);
	const exists = await pathExists(worktreePath);
	if (!exists) {
		return {
			taskId,
			mode: "worktree",
			path: worktreePath,
			exists: false,
			deleted: true,
			baseRef: normalizedBaseRef,
			hasGit: true,
			branch: null,
			isDetached: false,
			headCommit: null,
		};
	}

	const headInfo = await readGitHeadInfo(worktreePath);
	return {
		taskId,
		mode: "worktree",
		path: worktreePath,
		exists: true,
		deleted: false,
		baseRef: normalizedBaseRef,
		hasGit: true,
		branch: headInfo.branch,
		isDetached: headInfo.isDetached,
		headCommit: headInfo.headCommit,
	};
}
