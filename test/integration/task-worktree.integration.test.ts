import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { deleteTaskWorktree, ensureTaskWorktreeIfDoesntExist } from "../../src/workspace/task-worktree";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function expectMirroredPathBehavior(path: string): void {
	const exists = existsSync(path);
	if (process.platform === "win32") {
		if (exists) {
			expect(lstatSync(path).isSymbolicLink()).toBe(true);
		}
		return;
	}
	expect(exists).toBe(true);
	expect(lstatSync(path).isSymbolicLink()).toBe(true);
}

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
	it("returns a friendly error when the repository has no initial commit", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-unborn-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				const currentBranch = runGit(repoPath, ["symbolic-ref", "--short", "HEAD"]);
				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-no-initial-commit",
					baseRef: currentBranch,
				});

				expect(ensured.ok).toBe(false);
				expect(ensured.error).toContain("does not have an initial commit yet");
				expect(ensured.error).toContain(`base ref "${currentBranch}"`);
			} finally {
				cleanup();
			}
		});
	});

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

				const huskyIgnoredPath = join(ensured.path, ".husky", "_");
				expectMirroredPathBehavior(huskyIgnoredPath);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".husky/_"])).toBe("");
				if (existsSync(huskyIgnoredPath)) {
					expect(runGit(ensured.path, ["check-ignore", "-v", ".husky/_"])).toContain("info/exclude");
				}

				const ensuredAgain = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-1",
					baseRef: "HEAD",
				});
				expect(ensuredAgain.ok).toBe(true);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".husky/_"])).toBe("");
				expectMirroredPathBehavior(huskyIgnoredPath);
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

				const nextPath = join(ensured.path, ".next");
				const nodeModulesPath = join(ensured.path, "node_modules");
				expectMirroredPathBehavior(nextPath);
				expectMirroredPathBehavior(nodeModulesPath);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".next"])).toBe("");
				expect(runGit(ensured.path, ["status", "--porcelain", "--", "node_modules"])).toBe("");
				if (existsSync(nextPath)) {
					expect(runGit(ensured.path, ["check-ignore", "-v", ".next"])).toContain("info/exclude");
				}
				if (existsSync(nodeModulesPath)) {
					expect(runGit(ensured.path, ["check-ignore", "-v", "node_modules"])).toContain("info/exclude");
				}
			} finally {
				cleanup();
			}
		});
	});

	it("skips symlinking root node_modules for root Next apps without a next config file", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-root-turbopack-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				writeFileSync(
					join(repoPath, "package.json"),
					'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev"\n  }\n}\n',
					"utf8",
				);
				writeFileSync(join(repoPath, ".gitignore"), "/.next/\n/node_modules/\n", "utf8");
				mkdirSync(join(repoPath, ".next"), { recursive: true });
				mkdirSync(join(repoPath, "node_modules"), { recursive: true });
				writeFileSync(join(repoPath, ".next", "BUILD_ID"), "build\n", "utf8");
				writeFileSync(join(repoPath, "node_modules", "package.json"), '{\n  "name": "fixture"\n}\n', "utf8");

				runGit(repoPath, ["add", "README.md", "package.json", ".gitignore"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-root-turbopack",
					baseRef: "HEAD",
				});
				expect(ensured.ok).toBe(true);
				if (!ensured.ok || !ensured.path) {
					throw new Error("Task worktree was not created");
				}

				const nextPath = join(ensured.path, ".next");
				const nodeModulesPath = join(ensured.path, "node_modules");
				expectMirroredPathBehavior(nextPath);
				expect(existsSync(nodeModulesPath)).toBe(false);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", ".next"])).toBe("");
				expect(runGit(ensured.path, ["status", "--porcelain", "--", "node_modules"])).toBe("");
			} finally {
				cleanup();
			}
		});
	});

	it("skips only nested Turbopack app node_modules while keeping root node_modules symlinked", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-nested-turbopack-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				const appPath = join(repoPath, "apps", "web");
				mkdirSync(appPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				writeFileSync(join(repoPath, "package.json"), '{\n  "private": true\n}\n', "utf8");
				writeFileSync(
					join(appPath, "package.json"),
					'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev --turbopack"\n  }\n}\n',
					"utf8",
				);
				writeFileSync(join(repoPath, ".gitignore"), "/node_modules/\n/apps/web/node_modules/\n", "utf8");
				mkdirSync(join(repoPath, "node_modules"), { recursive: true });
				mkdirSync(join(appPath, "node_modules"), { recursive: true });
				writeFileSync(join(repoPath, "node_modules", "package.json"), '{\n  "name": "root-fixture"\n}\n', "utf8");
				writeFileSync(join(appPath, "node_modules", "package.json"), '{\n  "name": "app-fixture"\n}\n', "utf8");

				runGit(repoPath, ["add", "README.md", "package.json", "apps/web/package.json", ".gitignore"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId: "task-nested-turbopack",
					baseRef: "HEAD",
				});
				expect(ensured.ok).toBe(true);
				if (!ensured.ok || !ensured.path) {
					throw new Error("Task worktree was not created");
				}

				const rootNodeModulesPath = join(ensured.path, "node_modules");
				const appNodeModulesPath = join(ensured.path, "apps", "web", "node_modules");
				expectMirroredPathBehavior(rootNodeModulesPath);
				expect(existsSync(appNodeModulesPath)).toBe(false);
				expect(runGit(ensured.path, ["status", "--porcelain", "--", "node_modules"])).toBe("");
				expect(runGit(ensured.path, ["status", "--porcelain", "--", "apps/web/node_modules"])).toBe("");
				if (existsSync(rootNodeModulesPath)) {
					expect(runGit(ensured.path, ["check-ignore", "-v", "node_modules"])).toContain("info/exclude");
				}
			} finally {
				cleanup();
			}
		});
	});

	it("restores a trashed task patch onto the saved commit", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-restore-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				writeFileSync(join(repoPath, "tracked.txt"), "base\n", "utf8");
				runGit(repoPath, ["add", "README.md", "tracked.txt"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const taskId = `task-restore-${Date.now()}`;
				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId,
					baseRef: "HEAD",
				});
				expect(ensured.ok).toBe(true);
				if (!ensured.ok || !ensured.path) {
					throw new Error("Task worktree was not created");
				}

				const createdCommit = runGit(ensured.path, ["rev-parse", "HEAD"]);
				writeFileSync(join(ensured.path, "tracked.txt"), "base\nlocal change\n", "utf8");
				writeFileSync(join(ensured.path, "notes.txt"), "untracked\n", "utf8");

				const deleted = await deleteTaskWorktree({
					repoPath,
					taskId,
				});
				expect(deleted.ok).toBe(true);
				expect(deleted.removed).toBe(true);

				const patchPath = join(
					process.env.HOME ?? sandboxRoot,
					".cline",
					"kanban",
					"trashed-task-patches",
					`${taskId}.${createdCommit}.patch`,
				);
				expect(existsSync(patchPath)).toBe(true);
				expect(readFileSync(patchPath, "utf8")).toContain("tracked.txt");
				expect(readFileSync(patchPath, "utf8")).toContain("notes.txt");

				writeFileSync(join(repoPath, "README.md"), "hello again\n", "utf8");
				runGit(repoPath, ["add", "README.md"]);
				runGit(repoPath, ["commit", "-m", "advance"]);
				const advancedCommit = runGit(repoPath, ["rev-parse", "HEAD"]);
				expect(advancedCommit).not.toBe(createdCommit);

				const restored = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId,
					baseRef: "HEAD",
				});
				expect(restored.ok).toBe(true);
				if (!restored.ok || !restored.path) {
					throw new Error("Task worktree was not restored");
				}

				expect(restored.baseCommit).toBe(createdCommit);
				expect(runGit(restored.path, ["rev-parse", "HEAD"])).toBe(createdCommit);
				expect(readFileSync(join(restored.path, "tracked.txt"), "utf8")).toBe("base\nlocal change\n");
				expect(readFileSync(join(restored.path, "notes.txt"), "utf8")).toBe("untracked\n");
				expect(existsSync(patchPath)).toBe(false);
			} finally {
				cleanup();
			}
		});
	});

	it("resumes a trashed task even when the saved patch is invalid", async () => {
		await withTemporaryHome(async () => {
			const { path: sandboxRoot, cleanup } = createTempDir("kanban-task-worktree-invalid-patch-");
			try {
				const repoPath = join(sandboxRoot, "repo");
				mkdirSync(repoPath, { recursive: true });

				runGit(repoPath, ["init"]);
				runGit(repoPath, ["config", "user.name", "Kanban Test"]);
				runGit(repoPath, ["config", "user.email", "kanban-test@example.com"]);

				writeFileSync(join(repoPath, "README.md"), "hello\n", "utf8");
				runGit(repoPath, ["add", "README.md"]);
				runGit(repoPath, ["commit", "-m", "init"]);

				const taskId = `task-invalid-patch-${Date.now()}`;
				const ensured = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId,
					baseRef: "HEAD",
				});
				expect(ensured.ok).toBe(true);
				if (!ensured.ok || !ensured.path) {
					throw new Error("Task worktree was not created");
				}

				const createdCommit = runGit(ensured.path, ["rev-parse", "HEAD"]);
				const deleted = await deleteTaskWorktree({
					repoPath,
					taskId,
				});
				expect(deleted.ok).toBe(true);

				const patchesDir = join(process.env.HOME ?? sandboxRoot, ".cline", "kanban", "trashed-task-patches");
				mkdirSync(patchesDir, { recursive: true });
				const patchPath = join(patchesDir, `${taskId}.${createdCommit}.patch`);
				writeFileSync(
					patchPath,
					[
						"diff --git a/README.md b/README.md",
						"new file mode 100644",
						"index 0000000..1111111",
						"--- /dev/null",
						"+++ b/README.md",
						"@@ -0,0 +1 @@",
						"+hello",
						"GIT binary patch",
						"this-is-not-valid-binary-patch-data",
						"",
					].join("\n"),
					"utf8",
				);

				const restored = await ensureTaskWorktreeIfDoesntExist({
					cwd: repoPath,
					taskId,
					baseRef: "HEAD",
				});
				expect(restored.ok).toBe(true);
				if (!restored.ok || !restored.path) {
					throw new Error("Task worktree was not restored");
				}

				expect(restored.warning).toContain("Saved task changes could not be reapplied automatically.");
				expect(runGit(restored.path, ["rev-parse", "HEAD"])).toBe(createdCommit);
			} finally {
				cleanup();
			}
		});
	});
});
