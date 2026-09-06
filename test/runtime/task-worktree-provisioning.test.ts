import { describe, expect, it } from "vitest";

import {
	DEFAULT_WORKTREE_SHARED_DIRECTORIES,
	formatSharedDirectoryCredentialWarning,
	formatUnprovisionedIgnoredPathWarning,
	isCredentialRelativePath,
	listContainsCredentialBasename,
	parseWorktreeAllowlistFile,
	selectIgnoredPathsToProvision,
	shouldProvisionIgnoredPath,
	WORKTREE_ALLOWLIST_FILENAME,
	WORKTREE_ALLOWLIST_MAX_BYTES,
} from "../../src/workspace/task-worktree-provisioning";

describe("task-worktree provisioning allowlist", () => {
	it("uses node_modules as the default shared directory", () => {
		expect(DEFAULT_WORKTREE_SHARED_DIRECTORIES).toEqual(["node_modules"]);
	});

	it("treats .env and common credential filenames as credentials", () => {
		expect(isCredentialRelativePath(".env")).toBe(true);
		expect(isCredentialRelativePath(".env.local")).toBe(true);
		expect(isCredentialRelativePath(".envrc")).toBe(true);
		expect(isCredentialRelativePath(".npmrc")).toBe(true);
		expect(isCredentialRelativePath("id_rsa")).toBe(true);
		expect(isCredentialRelativePath("node_modules")).toBe(false);
		expect(isCredentialRelativePath(".next")).toBe(false);
	});

	it("parses literal allowlist paths and rejects glob patterns", () => {
		const parsed = parseWorktreeAllowlistFile(
			["cache", ".env", "dist/*", "build?", "[secret]", "", "# comment"].join("\n"),
		);
		expect(parsed.paths).toEqual(["cache", ".env"]);
		expect(parsed.rejected).toEqual(["dist/*", "build?", "[secret]"]);
	});

	it("rejects an oversize allowlist file", () => {
		const parsed = parseWorktreeAllowlistFile("cache\n", WORKTREE_ALLOWLIST_MAX_BYTES + 1);
		expect(parsed.paths).toEqual([]);
		expect(parsed.rejected.length).toBeGreaterThan(0);
	});

	it("does not provision .env by default", () => {
		expect(
			shouldProvisionIgnoredPath(".env", {
				allowlistedPaths: [],
				sharedDirectories: [...DEFAULT_WORKTREE_SHARED_DIRECTORIES],
			}),
		).toBe(false);
	});

	it("does not provision a credential filename through shared directories", () => {
		expect(
			shouldProvisionIgnoredPath(".env", {
				allowlistedPaths: [],
				sharedDirectories: [".env", "node_modules"],
			}),
		).toBe(false);
	});

	it("detects credential basenames in a directory listing", () => {
		expect(listContainsCredentialBasename(["README.md", ".env", "app.js"])).toEqual([".env"]);
		expect(listContainsCredentialBasename(["package.json", ".bin"])).toEqual([]);
	});

	it("warns when a shared directory contains a credential basename", () => {
		const warning = formatSharedDirectoryCredentialWarning("config", [".env"]);
		expect(warning).toContain("config");
		expect(warning).toContain(".env");
		expect(warning).toContain("Do not share a directory that holds secrets");
	});

	it("provisions an allowlisted credential path only as an exact literal", () => {
		expect(
			shouldProvisionIgnoredPath(".env", {
				allowlistedPaths: [".env"],
				sharedDirectories: [...DEFAULT_WORKTREE_SHARED_DIRECTORIES],
			}),
		).toBe(true);
		expect(
			shouldProvisionIgnoredPath(".env.local", {
				allowlistedPaths: [".env*"],
				sharedDirectories: [],
			}),
		).toBe(false);
	});

	it("provisions node_modules and nested node_modules from the default shared directory", () => {
		expect(
			shouldProvisionIgnoredPath("node_modules", {
				allowlistedPaths: [],
				sharedDirectories: [...DEFAULT_WORKTREE_SHARED_DIRECTORIES],
			}),
		).toBe(true);
		expect(
			shouldProvisionIgnoredPath("apps/web/node_modules", {
				allowlistedPaths: [],
				sharedDirectories: [...DEFAULT_WORKTREE_SHARED_DIRECTORIES],
			}),
		).toBe(true);
	});

	it("selects only allowlisted and shared-directory paths", () => {
		expect(
			selectIgnoredPathsToProvision([".env", "node_modules", "cache", "scratch"], {
				allowlistedPaths: ["cache"],
				sharedDirectories: [...DEFAULT_WORKTREE_SHARED_DIRECTORIES],
			}),
		).toEqual(["node_modules", "cache"]);
	});

	it("names the missing path and the allowlist file in the warning", () => {
		const warning = formatUnprovisionedIgnoredPathWarning([".next"]);
		expect(warning).toContain(".next");
		expect(warning).toContain(WORKTREE_ALLOWLIST_FILENAME);
	});
});
