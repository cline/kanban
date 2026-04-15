import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type WindowState,
	loadWindowState,
	resolveWindowStatePath,
	saveWindowState,
} from "../src/window-state.js";

// ---------------------------------------------------------------------------
// resolveWindowStatePath
// ---------------------------------------------------------------------------

describe("resolveWindowStatePath", () => {
	it("joins userData path with window-state.json", () => {
		const result = resolveWindowStatePath("/home/user/.config/Kanban");
		expect(result).toBe(
			path.join("/home/user/.config/Kanban", "window-state.json"),
		);
	});

	it("works with trailing separator", () => {
		const result = resolveWindowStatePath(
			`/home/user/.config/Kanban${path.sep}`,
		);
		expect(result).toBe(
			path.join("/home/user/.config/Kanban", "window-state.json"),
		);
	});
});

// ---------------------------------------------------------------------------
// loadWindowState / saveWindowState
// ---------------------------------------------------------------------------

describe("Window state persistence", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(path.join(tmpdir(), "kanban-main-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	// -------------------------------------------------------------------
	// loadWindowState
	// -------------------------------------------------------------------

	describe("loadWindowState", () => {
		it("returns undefined when file does not exist", () => {
			const result = loadWindowState(tempDir);
			expect(result).toBeUndefined();
		});

		it("returns undefined when file contains invalid JSON", () => {
			const filePath = resolveWindowStatePath(tempDir);
			writeFileSync(filePath, "not json", "utf-8");
			expect(loadWindowState(tempDir)).toBeUndefined();
		});

		it("returns undefined when width is missing", () => {
			const filePath = resolveWindowStatePath(tempDir);
			writeFileSync(
				filePath,
				JSON.stringify({ height: 900, isMaximized: false }),
				"utf-8",
			);
			expect(loadWindowState(tempDir)).toBeUndefined();
		});

		it("returns undefined when height is missing", () => {
			const filePath = resolveWindowStatePath(tempDir);
			writeFileSync(
				filePath,
				JSON.stringify({ width: 1400, isMaximized: false }),
				"utf-8",
			);
			expect(loadWindowState(tempDir)).toBeUndefined();
		});

		it("returns undefined when isMaximized is missing", () => {
			const filePath = resolveWindowStatePath(tempDir);
			writeFileSync(
				filePath,
				JSON.stringify({ width: 1400, height: 900 }),
				"utf-8",
			);
			expect(loadWindowState(tempDir)).toBeUndefined();
		});

		it("returns undefined when width is not a number", () => {
			const filePath = resolveWindowStatePath(tempDir);
			writeFileSync(
				filePath,
				JSON.stringify({ width: "big", height: 900, isMaximized: false }),
				"utf-8",
			);
			expect(loadWindowState(tempDir)).toBeUndefined();
		});

		it("loads a valid state with x and y", () => {
			const filePath = resolveWindowStatePath(tempDir);
			const state: WindowState = {
				x: 100,
				y: 200,
				width: 1400,
				height: 900,
				isMaximized: false,
			};
			writeFileSync(filePath, JSON.stringify(state), "utf-8");
			expect(loadWindowState(tempDir)).toEqual(state);
		});

		it("loads a valid state without x and y", () => {
			const filePath = resolveWindowStatePath(tempDir);
			const stored = { width: 1200, height: 800, isMaximized: true };
			writeFileSync(filePath, JSON.stringify(stored), "utf-8");

			expect(loadWindowState(tempDir)).toEqual({
				x: undefined,
				y: undefined,
				width: 1200,
				height: 800,
				isMaximized: true,
			});
		});

		it("treats non-number x/y as undefined", () => {
			const filePath = resolveWindowStatePath(tempDir);
			const stored = {
				x: "left",
				y: null,
				width: 1000,
				height: 700,
				isMaximized: false,
			};
			writeFileSync(filePath, JSON.stringify(stored), "utf-8");

			expect(loadWindowState(tempDir)).toEqual({
				x: undefined,
				y: undefined,
				width: 1000,
				height: 700,
				isMaximized: false,
			});
		});
	});

	// -------------------------------------------------------------------
	// saveWindowState
	// -------------------------------------------------------------------

	describe("saveWindowState", () => {
		it("creates the file with the given state", () => {
			const state: WindowState = {
				x: 50,
				y: 75,
				width: 1400,
				height: 900,
				isMaximized: false,
			};

			saveWindowState(tempDir, state);

			const filePath = resolveWindowStatePath(tempDir);
			expect(existsSync(filePath)).toBe(true);

			const raw = readFileSync(filePath, "utf-8");
			const parsed = JSON.parse(raw);
			expect(parsed).toEqual(state);
		});

		it("overwrites an existing file", () => {
			const state1: WindowState = {
				x: 0,
				y: 0,
				width: 800,
				height: 600,
				isMaximized: false,
			};
			const state2: WindowState = {
				x: 100,
				y: 200,
				width: 1920,
				height: 1080,
				isMaximized: true,
			};

			saveWindowState(tempDir, state1);
			saveWindowState(tempDir, state2);

			expect(loadWindowState(tempDir)).toEqual(state2);
		});

		it("does not throw when directory does not exist", () => {
			const state: WindowState = {
				x: 0,
				y: 0,
				width: 1000,
				height: 700,
				isMaximized: false,
			};

			expect(() =>
				saveWindowState("/nonexistent/deeply/nested/path", state),
			).not.toThrow();
		});
	});

	// -------------------------------------------------------------------
	// round-trip
	// -------------------------------------------------------------------

	describe("round-trip", () => {
		it("save then load returns the same state", () => {
			const state: WindowState = {
				x: 42,
				y: 84,
				width: 1600,
				height: 1000,
				isMaximized: false,
			};

			saveWindowState(tempDir, state);
			expect(loadWindowState(tempDir)).toEqual(state);
		});

		it("round-trips maximized state with undefined x/y", () => {
			const state: WindowState = {
				x: undefined,
				y: undefined,
				width: 1920,
				height: 1080,
				isMaximized: true,
			};

			saveWindowState(tempDir, state);
			expect(loadWindowState(tempDir)).toEqual({
				x: undefined,
				y: undefined,
				width: 1920,
				height: 1080,
				isMaximized: true,
			});
		});
	});
});

// ---------------------------------------------------------------------------
// before-quit shutdown idempotency (structural source-code check)
// ---------------------------------------------------------------------------

describe("before-quit shutdown safety", () => {
	const src = readFileSync(
		new URL("../src/main.ts", import.meta.url),
		"utf-8",
	);

	/**
	 * Extract the before-quit handler body from the source. We look for the
	 * `app.on("before-quit"` block and grab everything between the first `{`
	 * on that line through the matching closing brace.
	 */
	function extractBeforeQuitHandler(): string {
		const lines = src.split("\n");
		const startIdx = lines.findIndex((l) =>
			l.includes('app.on("before-quit"'),
		);
		if (startIdx === -1) throw new Error("before-quit handler not found");

		// Walk forward collecting lines until braces balance.
		let depth = 0;
		let started = false;
		const collected: string[] = [];
		for (let i = startIdx; i < lines.length; i++) {
			for (const ch of lines[i]) {
				if (ch === "{") {
					depth++;
					started = true;
				}
				if (ch === "}") depth--;
			}
			collected.push(lines[i]);
			if (started && depth === 0) break;
		}
		return collected.join("\n");
	}

	it("wraps stopAppNapPrevention and app.quit in a finally block after event.preventDefault", () => {
		const handler = extractBeforeQuitHandler();

		// After event.preventDefault(), the shutdown must be wrapped in
		// try { … } catch { … } finally { stopAppNapPrevention(); app.quit(); }
		// so the app can never hang.
		expect(handler).toContain("event.preventDefault()");
		expect(handler).toContain("finally");

		// Verify that stopAppNapPrevention and app.quit appear *after* the
		// finally keyword within the preventDefault branch.
		const preventIdx = handler.indexOf("event.preventDefault()");
		const finallyIdx = handler.indexOf("finally", preventIdx);
		const stopIdx = handler.indexOf("stopAppNapPrevention()", finallyIdx);
		const quitIdx = handler.indexOf("app.quit()", finallyIdx);

		expect(finallyIdx).toBeGreaterThan(preventIdx);
		expect(stopIdx).toBeGreaterThan(finallyIdx);
		expect(quitIdx).toBeGreaterThan(finallyIdx);
	});

	it("catches and logs connectionManager.shutdown errors", () => {
		const handler = extractBeforeQuitHandler();

		// The catch block should log with the desktop prefix.
		expect(handler).toContain("catch");
		expect(handler).toContain("[desktop] Connection shutdown error:");
	});
});
