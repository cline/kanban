import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { searchWorkspaceFiles } from "../../src/workspace/search-workspace-files";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function initRepository(path: string): void {
	runGit(path, ["init", "-q"]);
	runGit(path, ["config", "user.name", "Test User"]);
	runGit(path, ["config", "user.email", "test@example.com"]);
}

function commitAll(cwd: string, message: string): string {
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-qm", message]);
	return runGit(cwd, ["rev-parse", "HEAD"]);
}

describe.sequential("search workspace files runtime", () => {
	it("finds modified tracked files with non-ASCII paths using UTF-8 query text", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-search-files-nonascii-tracked-");
		try {
			initRepository(repoPath);
			const directory = "提出書類";
			const fileName = "設計書.md";
			const relativePath = `${directory}/${fileName}`;
			mkdirSync(join(repoPath, directory), { recursive: true });
			writeFileSync(join(repoPath, relativePath), "first\n", "utf8");
			commitAll(repoPath, "add non-ascii tracked file");
			writeFileSync(join(repoPath, relativePath), "updated\n", "utf8");

			const results = await searchWorkspaceFiles(repoPath, "提出", 20);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				path: relativePath,
				name: fileName,
				changed: true,
			});
		} finally {
			cleanup();
		}
	});

	it("finds untracked files with non-ASCII paths using UTF-8 query text", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-search-files-nonascii-untracked-");
		try {
			initRepository(repoPath);
			const directory = "新規資料";
			const fileName = "メモ.txt";
			const relativePath = `${directory}/${fileName}`;
			mkdirSync(join(repoPath, directory), { recursive: true });
			writeFileSync(join(repoPath, relativePath), "draft\n", "utf8");

			const results = await searchWorkspaceFiles(repoPath, "新規", 20);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				path: relativePath,
				name: fileName,
				changed: true,
			});
		} finally {
			cleanup();
		}
	});
});
