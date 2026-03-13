import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureTaskWorktreeIfDoesntExist } from "../../src/workspace/task-worktree.js";
import { createGitTestEnv } from "../utilities/git-env.js";
import { createTempDir } from "../utilities/temp-dir.js";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(
			[`git ${args.join(" ")} failed in ${cwd}`, result.stdout.trim(), result.stderr.trim()]
				.filter((part) => part.length > 0)
				.join("\n"),
		);
	}
	return result.stdout.trim();
}

async function withTemporaryHome<T>(run: () => Promise<T>): Promise<T> {
	const { path: tempHome, cleanup } = createTempDir("kanban-home-");
	const previousHome = process.env.HOME;
	const previousUserProfile = process.env.USERPROFILE;
	process.env.HOME = tempHome;
	process.env.USERPROFILE = tempHome;
	try {
		return await run();
	} finally {
		if (previousHome === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = previousHome;
		}
		if (previousUserProfile === undefined) {
			delete process.env.USERPROFILE;
		} else {
			process.env.USERPROFILE = previousUserProfile;
		}
		cleanup();
	}
}

describe.sequential("task-worktree integration", () => {
	it("keeps symlinked ignored paths ignored in task worktrees", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				mkdirSync(join(repoPath, ".husky", "_"), { recursive: true });
				writeFileSync(join(repoPath, ".husky", "pre-commit"), "#!/bin/sh\nexit 0\n", "utf8");
				writeFileSync(join(repoPath, ".husky", "_", ".gitignore"), "*\n", "utf8");
				writeFileSync(join(repoPath, ".husky", "_", "pre-commit"), "#!/bin/sh\nexit 0\n", "utf8");

				runGit(repoPath, ["add", "README.md", ".husky/pre-commit"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const ignoredPaths = runGit(repoPath, [
					"ls-files",
					"--others",
					"--ignored",
					"--exclude-per-directory=.gitignore",
					"--directory",
				]);
				expect(ignoredPaths).toContain(".husky/_/");

				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-1",
					baseRef: "HEAD",
				});
				expect(ensured.ok).toBe(true);
				if (!ensured.ok || !ensured.path) {
					throw new Error("Task worktree was not created");
				}

				expect(existsSync(join(ensured.path, ".husky", "_"))).toBe(true);
				expect(lstatSync(join(ensured.path, ".husky", "_")).isSymbolicLink()).toBe(true);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".husky/_"])).toBe("");
				expect(runGit(ensured.path, ["check-ignore", "-v", ".husky/_"])).toContain("info/exclude");

				const ensuredAgain = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-1",
					baseRef: "HEAD",
				});
				expect(ensuredAgain.ok).toBe(true);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".husky/_"])).toBe("");
				expect(existsSync(join(ensured.path, ".husky", "_"))).toBe(true);
				expect(lstatSync(join(ensured.path, ".husky", "_")).isSymbolicLink()).toBe(true);
			} finally {
				cleanup();
			}
		});
	});

	it("keeps symlinked directory-only ignored paths ignored in task worktrees", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-root-ignore-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				writeFileSync(join(repoPath, ".gitignore"), "/.next/\n/node_modules/\n", "utf8");
				mkdirSync(join(repoPath, ".next"), { recursive: true });
				mkdirSync(join(repoPath, "node_modules"), { recursive: true });
				writeFileSync(join(repoPath, ".next", "BUILD_ID"), "build\n", "utf8");
				writeFileSync(join(repoPath, "node_modules", "package.json"), '{\n  "name": "fixture"\n}\n', "utf8");

				runGit(repoPath, ["add", "README.md", ".gitignore"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-2",
					baseRef: "HEAD",
				});
				expect(ensured.ok).toBe(true);
				if (!ensured.ok || !ensured.path) {
					throw new Error("Task worktree was not created");
				}

				expect(lstatSync(join(ensured.path, ".next")).isSymbolicLink()).toBe(true);
				expect(lstatSync(join(ensured.path, "node_modules")).isSymbolicLink()).toBe(true);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".next"])).toBe("");
				expect(runGit(ensured.path, ["status", "--porcelain", "--", "node_modules"])).toBe("");
				expect(runGit(ensured.path, ["check-ignore", "-v", ".next"])).toContain("info/exclude");
				expect(runGit(ensured.path, ["check-ignore", "-v", "node_modules"])).toContain("info/exclude");
			} finally {
				cleanup();
			}
		});
	});
});
