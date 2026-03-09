import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { createTempDir } from "./temp-dir.js";

describe("createTempDir", () => {
	it("creates and cleans up a temporary directory", () => {
		const { path, cleanup } = createTempDir("kanban-unit-");

		expect(existsSync(path)).toBe(true);
		cleanup();
		expect(existsSync(path)).toBe(false);
	});
});
