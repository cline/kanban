import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
			[
				`git ${args.join(" ")} failed in ${cwd}`,
				result.stdout.trim(),
				result.stderr.trim(),
			]
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

				expect(existsSync(join(ensured.path, ".husky", "_"))).toBe(false);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".husky/_"])).toBe("");

				const ensuredAgain = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-1",
					baseRef: "HEAD",
				});
				expect(ensuredAgain.ok).toBe(true);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".husky/_"])).toBe("");
				expect(existsSync(join(ensured.path, ".husky", "_"))).toBe(false);
			} finally {
				cleanup();
			}
		});
	});
});
