import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getCommitDiff, getGitRefs } from "../../src/workspace/git-history.js";
import { discardGitChanges } from "../../src/workspace/git-sync.js";
import { createGitTestEnv } from "../utilities/git-env.js";
import { createTempDir } from "../utilities/temp-dir.js";

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

describe.sequential("git history runtime", () => {
	it("returns correct metadata for root commit diffs", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-root-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "first.txt"), "hello\nworld\n", "utf8");
			const rootCommit = commitAll(repoPath, "first commit");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash: rootCommit,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: "first.txt",
				status: "added",
				additions: 2,
				deletions: 0,
			});
			expect(response.files[0]?.patch).toContain("+++ b/first.txt");
		} finally {
			cleanup();
		}
	});

	it("returns rename metadata for rename-only commits", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-rename-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "old.txt"), "hello\n", "utf8");
			commitAll(repoPath, "init");

			runGit(repoPath, ["mv", "old.txt", "new.txt"]);
			const renameCommit = commitAll(repoPath, "rename file");

			const response = await getCommitDiff({
				cwd: repoPath,
				commitHash: renameCommit,
			});

			expect(response.ok).toBe(true);
			expect(response.files).toHaveLength(1);
			expect(response.files[0]).toMatchObject({
				path: "new.txt",
				previousPath: "old.txt",
				status: "renamed",
				additions: 0,
				deletions: 0,
			});
			expect(response.files[0]?.patch).toContain("rename from old.txt");
			expect(response.files[0]?.patch).toContain("rename to new.txt");
		} finally {
			cleanup();
		}
	});

	it("discards tracked, staged, and untracked working copy changes", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-git-history-discard-");
		try {
			initRepository(repoPath);
			writeFileSync(join(repoPath, "tracked.txt"), "original\n", "utf8");
			commitAll(repoPath, "init");

			writeFileSync(join(repoPath, "tracked.txt"), "changed\n", "utf8");
			runGit(repoPath, ["add", "tracked.txt"]);
			mkdirSync(join(repoPath, "scratch"), { recursive: true });
			writeFileSync(join(repoPath, "scratch", "note.txt"), "temp\n", "utf8");

			const response = await discardGitChanges({ cwd: repoPath });

			expect(response.ok).toBe(true);
			expect(response.summary.changedFiles).toBe(0);
			expect(readFileSync(join(repoPath, "tracked.txt"), "utf8")).toBe("original\n");
			expect(existsSync(join(repoPath, "scratch", "note.txt"))).toBe(false);
		} finally {
			cleanup();
		}
	});

	it("reads ahead and behind counts from tracked branches", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-git-history-refs-");
		try {
			const remotePath = join(sandboxRoot, "remote.git");
			const localPath = join(sandboxRoot, "local");
			const peerPath = join(sandboxRoot, "peer");

			mkdirSync(remotePath, { recursive: true });
			runGit(remotePath, ["init", "--bare", "-q"]);

			mkdirSync(localPath, { recursive: true });
			initRepository(localPath);
			writeFileSync(join(localPath, "file.txt"), "base\n", "utf8");
			commitAll(localPath, "init");
			runGit(localPath, ["remote", "add", "origin", remotePath]);
			const currentBranch = runGit(localPath, ["symbolic-ref", "--short", "HEAD"]);
			runGit(localPath, ["push", "-u", "origin", currentBranch]);

			runGit(sandboxRoot, ["clone", "-q", remotePath, peerPath]);
			runGit(peerPath, ["config", "user.name", "Peer User"]);
			runGit(peerPath, ["config", "user.email", "peer@example.com"]);
			writeFileSync(join(peerPath, "peer.txt"), "remote\n", "utf8");
			commitAll(peerPath, "remote commit");
			runGit(peerPath, ["push", "origin", currentBranch]);

			writeFileSync(join(localPath, "local.txt"), "local\n", "utf8");
			commitAll(localPath, "local commit");
			runGit(localPath, ["fetch", "origin"]);

			const refsResponse = await getGitRefs(localPath);
			expect(refsResponse.ok).toBe(true);
			const headBranch = refsResponse.refs.find((ref) => ref.isHead);
			expect(headBranch).toMatchObject({
				name: currentBranch,
				ahead: 1,
				behind: 1,
			});
		} finally {
			cleanup();
		}
	});
});
