import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
	getFileGitLineStatus,
	listDirectoryEntries,
	readWorkspaceFile,
	writeWorkspaceFile,
} from "../../src/workspace/browse-workspace-files";
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

function commitAll(cwd: string, message: string): void {
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-qm", message]);
}

describe.sequential("listDirectoryEntries", () => {
	it("lists files and directories sorted with directories first", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-list-");
		try {
			mkdirSync(join(root, "beta"), { recursive: true });
			mkdirSync(join(root, "alpha"), { recursive: true });
			writeFileSync(join(root, "readme.md"), "hello", "utf8");
			writeFileSync(join(root, "app.ts"), "code", "utf8");

			const result = await listDirectoryEntries(root, "");

			expect(result.entries).toEqual([
				{ name: "alpha", path: "alpha", type: "directory" },
				{ name: "beta", path: "beta", type: "directory" },
				{ name: "app.ts", path: "app.ts", type: "file" },
				{ name: "readme.md", path: "readme.md", type: "file" },
			]);
		} finally {
			cleanup();
		}
	});

	it("filters out .git, node_modules, and .worktrees", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-ignore-");
		try {
			mkdirSync(join(root, ".git"), { recursive: true });
			mkdirSync(join(root, "node_modules"), { recursive: true });
			mkdirSync(join(root, ".worktrees"), { recursive: true });
			writeFileSync(join(root, "index.ts"), "code", "utf8");

			const result = await listDirectoryEntries(root, "");

			expect(result.entries).toEqual([{ name: "index.ts", path: "index.ts", type: "file" }]);
		} finally {
			cleanup();
		}
	});

	it("lists entries in a subdirectory with relative paths from root", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-subdir-");
		try {
			mkdirSync(join(root, "src", "utils"), { recursive: true });
			writeFileSync(join(root, "src", "index.ts"), "code", "utf8");

			const result = await listDirectoryEntries(root, "src");

			expect(result.entries).toEqual([
				{ name: "utils", path: "src/utils", type: "directory" },
				{ name: "index.ts", path: "src/index.ts", type: "file" },
			]);
		} finally {
			cleanup();
		}
	});
});

describe.sequential("readWorkspaceFile", () => {
	it("reads a text file and returns its content", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-read-");
		try {
			writeFileSync(join(root, "hello.txt"), "world", "utf8");

			const result = await readWorkspaceFile(root, "hello.txt");

			expect(result.content).toBe("world");
			expect(result.isBinary).toBe(false);
			expect(result.size).toBe(5);
			expect(result.error).toBeUndefined();
		} finally {
			cleanup();
		}
	});

	it("returns isBinary true for binary extension files", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-binary-ext-");
		try {
			writeFileSync(join(root, "image.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

			const result = await readWorkspaceFile(root, "image.png");

			expect(result.isBinary).toBe(true);
			expect(result.content).toBeNull();
		} finally {
			cleanup();
		}
	});

	it("returns error for non-existent file", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-nofile-");
		try {
			const result = await readWorkspaceFile(root, "missing.txt");

			expect(result.content).toBeNull();
			expect(result.error).toBeDefined();
		} finally {
			cleanup();
		}
	});

	it("rejects path traversal attempts", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-traversal-");
		try {
			await expect(readWorkspaceFile(root, "../../../etc/passwd")).rejects.toThrow("Path traversal");
		} finally {
			cleanup();
		}
	});
});

describe.sequential("writeWorkspaceFile", () => {
	it("writes content to a file and returns ok", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-write-");
		try {
			writeFileSync(join(root, "file.txt"), "old", "utf8");

			const result = await writeWorkspaceFile(root, "file.txt", "new content");

			expect(result.ok).toBe(true);

			const readBack = await readWorkspaceFile(root, "file.txt");
			expect(readBack.content).toBe("new content");
		} finally {
			cleanup();
		}
	});

	it("rejects path traversal attempts", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-write-traversal-");
		try {
			await expect(writeWorkspaceFile(root, "../../evil.txt", "hack")).rejects.toThrow("Path traversal");
		} finally {
			cleanup();
		}
	});
});

describe.sequential("getFileGitLineStatus", () => {
	it("detects added lines in a new file", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-git-added-");
		try {
			initRepository(root);
			writeFileSync(join(root, "initial.txt"), "first\n", "utf8");
			commitAll(root, "initial commit");

			writeFileSync(join(root, "initial.txt"), "first\nsecond\nthird\n", "utf8");

			const result = await getFileGitLineStatus(root, "initial.txt");

			expect(result.path).toBe("initial.txt");
			expect(result.changes.length).toBeGreaterThan(0);
			expect(result.changes[0]?.type).toBe("added");
		} finally {
			cleanup();
		}
	});

	it("returns empty changes for unmodified files", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-git-clean-");
		try {
			initRepository(root);
			writeFileSync(join(root, "clean.txt"), "unchanged\n", "utf8");
			commitAll(root, "initial commit");

			const result = await getFileGitLineStatus(root, "clean.txt");

			expect(result.changes).toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("returns empty changes when git is not available", async () => {
		const { path: root, cleanup } = createTempDir("kanban-browse-git-nogit-");
		try {
			writeFileSync(join(root, "file.txt"), "no git\n", "utf8");

			const result = await getFileGitLineStatus(root, "file.txt");

			expect(result.changes).toEqual([]);
		} finally {
			cleanup();
		}
	});
});
