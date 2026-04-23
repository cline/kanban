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
let cliShimPath: string;

beforeAll(() => {
	tempDir = path.join(tmpdir(), `kanban-preflight-test-${Date.now()}`);
	mkdirSync(tempDir, { recursive: true });

	preloadPath = path.join(tempDir, "preload.js");
	writeFileSync(preloadPath, "// preload stub", "utf-8");

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
			cliShimPath,
			isPackaged: false,
		});

		expect(result.ok).toBe(true);
		expect(result.failures).toHaveLength(0);
		expect(result.resources).toEqual({
			preloadExists: true,
			cliShimExists: true,
			nodePtyLoadable: null,
		});
	});

	it("reports PRELOAD_MISSING when preload does not exist", () => {
		const result = runDesktopPreflight({
			preloadPath: path.join(tempDir, "nonexistent-preload.js"),
			cliShimPath,
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].code).toBe("PRELOAD_MISSING");
		expect(result.failures[0].message).toContain("nonexistent-preload.js");
		expect(result.failures[0].details?.path).toContain("nonexistent-preload.js");
		expect(result.failures[0].details?.isPackaged).toBe(false);
		expect(result.resources.preloadExists).toBe(false);
		expect(result.resources.cliShimExists).toBe(true);
	});

	it("reports CLI_SHIM_MISSING when CLI shim does not exist", () => {
		const result = runDesktopPreflight({
			preloadPath,
			cliShimPath: path.join(tempDir, "nonexistent-kanban"),
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0].code).toBe("CLI_SHIM_MISSING");
		expect(result.failures[0].message).toContain("nonexistent-kanban");
		expect(result.failures[0].details?.path).toContain("nonexistent-kanban");
		expect(result.failures[0].details?.isPackaged).toBe(false);
		expect(result.resources.cliShimExists).toBe(false);
		expect(result.resources.preloadExists).toBe(true);
	});

	it("reports multiple failures when several resources are missing", () => {
		const result = runDesktopPreflight({
			preloadPath: path.join(tempDir, "nope-preload.js"),
			cliShimPath: path.join(tempDir, "nope-kanban"),
			isPackaged: false,
		});

		expect(result.ok).toBe(false);
		expect(result.failures).toHaveLength(2);

		const codes = result.failures.map((f) => f.code);
		expect(codes).toContain("PRELOAD_MISSING");
		expect(codes).toContain("CLI_SHIM_MISSING");

		expect(result.resources.preloadExists).toBe(false);
		expect(result.resources.cliShimExists).toBe(false);
	});

	it("sets nodePtyLoadable to null when checkNodePty is omitted", () => {
		const result = runDesktopPreflight({
			preloadPath,
			cliShimPath,
			isPackaged: false,
		});

		expect(result.resources.nodePtyLoadable).toBeNull();
	});

	it("sets nodePtyLoadable to null when checkNodePty is false", () => {
		const result = runDesktopPreflight({
			preloadPath,
			cliShimPath,
			isPackaged: false,
			checkNodePty: false,
		});

		expect(result.resources.nodePtyLoadable).toBeNull();
	});

	it("checks node-pty when checkNodePty is true", () => {
		const result = runDesktopPreflight({
			preloadPath,
			cliShimPath,
			isPackaged: false,
			checkNodePty: true,
		});

		// node-pty may or may not be loadable in test env,
		// but the field must be a boolean (not null).
		expect(typeof result.resources.nodePtyLoadable).toBe("boolean");
	});

	it("classifies missing node-pty as a warning, not a hard failure", () => {
		const result = runDesktopPreflight({
			preloadPath,
			cliShimPath,
			isPackaged: false,
			checkNodePty: true,
		});

		// Whichever way node-pty resolves in this test env, we never want
		// it to appear in `failures[]`: terminal support is optional and
		// should degrade gracefully rather than block boot. The
		// `failures` / `warnings` type split now encodes this invariant at
		// compile time (`NODE_PTY_UNAVAILABLE` is a warning-only code), so
		// a runtime `.some(...)` assertion against `failures` would be dead
		// code. We keep the downstream warnings[] assertion instead.

		if (result.resources.nodePtyLoadable === false) {
			// When node-pty is unavailable it belongs in warnings[] and
			// preflight should still report ok: true (no hard failures).
			expect(
				result.warnings.some((w) => w.code === "NODE_PTY_UNAVAILABLE"),
			).toBe(true);
			expect(result.ok).toBe(true);
		} else {
			expect(result.warnings).toHaveLength(0);
		}
	});

	it("includes details with checked paths in failure objects", () => {
		const missingPreload = path.join(tempDir, "gone-preload.js");
		const result = runDesktopPreflight({
			preloadPath: missingPreload,
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
