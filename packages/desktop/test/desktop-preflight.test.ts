import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDesktopPreflight } from "../src/desktop-preflight.js";

// ---------------------------------------------------------------------------
// Test fixture: a temp directory with real files for existence checks
// ---------------------------------------------------------------------------

let tempDir: string;
let preloadPath: string;
let childScriptRawPath: string;
let cliShimPath: string;

beforeAll(() => {
	tempDir = path.join(tmpdir(), `kanban-preflight-test-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });

	preloadPath = path.join(tempDir, "preload.js");
	writeFileSync(preloadPath, "// preload stub", "utf-8");

	// resolveChildScriptPath leaves paths without app.asar unchanged.
	childScriptRawPath = path.join(tempDir, "runtime-child-entry.js");
	writeFileSync(childScriptRawPath, "// child stub", "utf-8");

	cliShimPath = path.join(tempDir, "kanban");
	writeFileSync(cliShimPath, "#!/bin/sh\nexit 0", { mode: 0o755 });
});

afterAll(() => {
	if (tempDir && existsSync(tempDir)) {
		rmSync(tempDir, { recursive: true, force: true });
	}
});


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runDesktopPreflight", () => {
	it("reports ok when all resources exist", () => {
		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: childScriptRawPath,
			cliShimPath,
			isPackaged: false,
		});

		expect(result.ok).toBe(true);
		expect(result.failures).toHaveLength(0);
		expect(result.resources).toEqual({
			preloadExists: true,
			runtimeChildEntryExists: true,
			cliShimExists: true,
			nodePtyLoadable: null,
		});
	});

	it("reports PRELOAD_MISSING when preload does not exist", () => {
		const result = runDesktopPreflight({
			preloadPath: path.join(tempDir, "nonexistent-preload.js"),
			childScriptPath: childScriptRawPath,
			cliShimPath,
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].code).toBe("PRELOAD_MISSING");
		expect(result.failures[0].message).toContain("nonexistent-preload.js");
		expect(result.resources.preloadExists).toBe(false);
		expect(result.resources.runtimeChildEntryExists).toBe(true);
		expect(result.resources.cliShimExists).toBe(true);
	});

	it("reports RUNTIME_CHILD_ENTRY_MISSING when child entry does not exist", () => {
		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: path.join(tempDir, "nonexistent-child.js"),
			cliShimPath,
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].code).toBe("RUNTIME_CHILD_ENTRY_MISSING");
		expect(result.failures[0].message).toContain("nonexistent-child.js");
		expect(result.resources.runtimeChildEntryExists).toBe(false);
	});

	it("reports RUNTIME_CHILD_ENTRY_MISSING for asar path that resolves to nonexistent unpacked location", () => {
		// Simulate the asar scenario: raw path has "app.asar" segment but
		// the corresponding "app.asar.unpacked" path does not exist.
		const asarDir = path.join(tempDir, "app.asar");
		mkdirSync(asarDir, { recursive: true });
		const rawChildPath = path.join(asarDir, "runtime-child-entry.js");
		writeFileSync(rawChildPath, "// child stub", "utf-8");

		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: rawChildPath,
			cliShimPath,
			isPackaged: true,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].code).toBe("RUNTIME_CHILD_ENTRY_MISSING");
		expect(result.failures[0].message).toContain("app.asar.unpacked");
		expect(result.failures[0].details?.rawPath).toBe(rawChildPath);
		expect(result.failures[0].details?.resolvedPath).toContain("app.asar.unpacked");
		expect(result.resources.runtimeChildEntryExists).toBe(false);

		rmSync(asarDir, { recursive: true, force: true });
	});

	it("reports CLI_SHIM_MISSING when CLI shim does not exist", () => {
		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: childScriptRawPath,
			cliShimPath: path.join(tempDir, "nonexistent-kanban"),
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].code).toBe("CLI_SHIM_MISSING");
		expect(result.failures[0].message).toContain("nonexistent-kanban");
		expect(result.resources.cliShimExists).toBe(false);
	});

	it("reports multiple failures when several resources are missing", () => {
		const result = runDesktopPreflight({
			preloadPath: path.join(tempDir, "nope-preload.js"),
			childScriptPath: path.join(tempDir, "nope-child.js"),
			cliShimPath: path.join(tempDir, "nope-kanban"),
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(3);

		const codes = result.failures.map((f) => f.code);
		expect(codes).toContain("PRELOAD_MISSING");
		expect(codes).toContain("RUNTIME_CHILD_ENTRY_MISSING");
		expect(codes).toContain("CLI_SHIM_MISSING");

		expect(result.resources.preloadExists).toBe(false);
		expect(result.resources.runtimeChildEntryExists).toBe(false);
		expect(result.resources.cliShimExists).toBe(false);
	});

	it("sets nodePtyLoadable to null when checkNodePty is omitted", () => {
		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: childScriptRawPath,
			cliShimPath,
			isPackaged: false,
		});

		expect(result.resources.nodePtyLoadable).toBeNull();
	});

	it("sets nodePtyLoadable to null when checkNodePty is false", () => {
		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: childScriptRawPath,
			cliShimPath,
			isPackaged: false,
			checkNodePty: false,
		});

		expect(result.resources.nodePtyLoadable).toBeNull();
	});

	it("checks node-pty when checkNodePty is true", () => {
		const result = runDesktopPreflight({
			preloadPath,
			childScriptPath: childScriptRawPath,
			cliShimPath,
			isPackaged: false,
			checkNodePty: true,
		});

		// node-pty may or may not be resolvable in test env,
		// but the field must be a boolean (not null).
		expect(typeof result.resources.nodePtyLoadable).toBe("boolean");
	});

	it("includes details with checked paths in failure objects", () => {
		const missingPreload = path.join(tempDir, "gone-preload.js");
		const result = runDesktopPreflight({
			preloadPath: missingPreload,
			childScriptPath: childScriptRawPath,
			cliShimPath,
			isPackaged: true,
		});

		expect(result.failures).toHaveLength(1);
		const failure = result.failures[0];
		expect(failure.details).toBeDefined();
		expect(failure.details?.path).toBe(missingPreload);
		expect(failure.details?.isPackaged).toBe(true);
	});
});

