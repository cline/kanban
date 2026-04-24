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
