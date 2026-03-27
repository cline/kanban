import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { listTurbopackNodeModulesSymlinkSkipPaths } from "../../src/workspace/task-worktree-turbopack.js";
import { createTempDir } from "../utilities/temp-dir.js";

describe("listTurbopackNodeModulesSymlinkSkipPaths", () => {
	it("skips root node_modules for root Turbopack scripts", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-root-script-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			mkdirSync(repoPath, { recursive: true });
			writeFileSync(
				join(repoPath, "package.json"),
				'{\n  "scripts": {\n    "dev": "next dev --turbopack"\n  }\n}\n',
				"utf8",
			);

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual(["node_modules"]);
		} finally {
			cleanup();
		}
	});

	it("skips root node_modules for root Next apps without explicit Turbopack hints", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-root-next-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			mkdirSync(repoPath, { recursive: true });
			writeFileSync(
				join(repoPath, "package.json"),
				'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev"\n  }\n}\n',
				"utf8",
			);

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual(["node_modules"]);
		} finally {
			cleanup();
		}
	});

	it("skips nested app node_modules for nested Next apps without explicit Turbopack hints", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-nested-next-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const appPath = join(repoPath, "apps", "web");
			mkdirSync(appPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "private": true\n}\n', "utf8");
			writeFileSync(
				join(appPath, "package.json"),
				'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev"\n  }\n}\n',
				"utf8",
			);

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual(["apps/web/node_modules"]);
		} finally {
			cleanup();
		}
	});

	it("does not treat a next script alone as a Next app", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-next-script-only-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			mkdirSync(repoPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "scripts": {\n    "dev": "next dev"\n  }\n}\n', "utf8");

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("skips root node_modules for root Turbopack config", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-root-config-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			mkdirSync(repoPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "scripts": {\n    "dev": "next dev"\n  }\n}\n', "utf8");
			writeFileSync(join(repoPath, "next.config.js"), "export default { turbopack: {} };\n", "utf8");

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual(["node_modules"]);
		} finally {
			cleanup();
		}
	});

	it("skips only the nested app node_modules when only the nested app uses Turbopack", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-nested-app-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const appPath = join(repoPath, "apps", "web");
			mkdirSync(appPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "private": true\n}\n', "utf8");
			writeFileSync(
				join(appPath, "package.json"),
				'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev --turbopack"\n  }\n}\n',
				"utf8",
			);

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual(["apps/web/node_modules"]);
		} finally {
			cleanup();
		}
	});

	it("skips nested app node_modules for nested Turbopack config", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-nested-config-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const appPath = join(repoPath, "apps", "web");
			mkdirSync(appPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "private": true\n}\n', "utf8");
			writeFileSync(
				join(appPath, "package.json"),
				'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev"\n  }\n}\n',
				"utf8",
			);
			writeFileSync(join(appPath, "next.config.ts"), "export default { turbopack: {} };\n", "utf8");

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual(["apps/web/node_modules"]);
		} finally {
			cleanup();
		}
	});

	it("does not scan package directories deeper than the heuristic limit", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-too-deep-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			const deepAppPath = join(repoPath, "packages", "clients", "web", "app");
			mkdirSync(deepAppPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "private": true\n}\n', "utf8");
			writeFileSync(
				join(deepAppPath, "package.json"),
				'{\n  "dependencies": {\n    "next": "15.0.0"\n  },\n  "scripts": {\n    "dev": "next dev --turbopack"\n  }\n}\n',
				"utf8",
			);

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual([]);
		} finally {
			cleanup();
		}
	});

	it("returns no skipped paths when no Turbopack hints are present", async () => {
		const { path: sandboxRoot, cleanup } = createTempDir("kanban-turbopack-detect-none-");
		try {
			const repoPath = join(sandboxRoot, "repo");
			mkdirSync(repoPath, { recursive: true });
			writeFileSync(join(repoPath, "package.json"), '{\n  "scripts": {\n    "dev": "vite dev"\n  }\n}\n', "utf8");

			await expect(listTurbopackNodeModulesSymlinkSkipPaths(repoPath)).resolves.toEqual([]);
		} finally {
			cleanup();
		}
	});
});
