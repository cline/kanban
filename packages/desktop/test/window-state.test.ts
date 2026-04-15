import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type PersistedWindowState,
	type WindowState,
	loadAllWindowStates,
	loadWindowState,
	migrateWindowStateIfNeeded,
	resolveMultiWindowStatePath,
	resolveWindowStatePath,
	saveAllWindowStates,
	saveWindowState,
} from "../src/window-state.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

function freshTmpDir(): string {
	const dir = path.join(
		import.meta.dirname,
		".tmp-window-state-test",
		String(Date.now()) + "-" + String(Math.random()).slice(2, 8),
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

const SAMPLE_LEGACY_STATE: WindowState = {
	x: 100,
	y: 200,
	width: 1400,
	height: 900,
	isMaximized: false,
};

const SAMPLE_PERSISTED_STATES: PersistedWindowState[] = [
	{
		x: 100,
		y: 200,
		width: 1400,
		height: 900,
		isMaximized: false,
		projectId: null,
	},
	{
		x: 500,
		y: 300,
		width: 1200,
		height: 800,
		isMaximized: true,
		projectId: "project-abc",
	},
];

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
	tmpDir = freshTmpDir();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Legacy API (deprecated — backward compat)
// ---------------------------------------------------------------------------

describe("loadWindowState (legacy)", () => {
	it("returns undefined when no file exists", () => {
		expect(loadWindowState(tmpDir)).toBeUndefined();
	});

	it("round-trips through saveWindowState", () => {
		saveWindowState(tmpDir, SAMPLE_LEGACY_STATE);
		const loaded = loadWindowState(tmpDir);
		expect(loaded).toEqual(SAMPLE_LEGACY_STATE);
	});

	it("returns undefined for corrupt JSON", () => {
		writeFileSync(resolveWindowStatePath(tmpDir), "not json", "utf-8");
		expect(loadWindowState(tmpDir)).toBeUndefined();
	});

	it("returns undefined for JSON with missing required fields", () => {
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify({ x: 0, y: 0 }),
			"utf-8",
		);
		expect(loadWindowState(tmpDir)).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe("migrateWindowStateIfNeeded", () => {
	it("returns false when neither file exists", () => {
		expect(migrateWindowStateIfNeeded(tmpDir)).toBe(false);
	});

	it("returns false when new file already exists", () => {
		// Write both files — migration should be skipped.
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify(SAMPLE_LEGACY_STATE),
			"utf-8",
		);
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify([]),
			"utf-8",
		);
		expect(migrateWindowStateIfNeeded(tmpDir)).toBe(false);
	});

	it("migrates legacy file into a one-element array", () => {
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify(SAMPLE_LEGACY_STATE),
			"utf-8",
		);

		expect(migrateWindowStateIfNeeded(tmpDir)).toBe(true);

		// New file should exist now.
		const multiPath = resolveMultiWindowStatePath(tmpDir);
		expect(existsSync(multiPath)).toBe(true);

		const contents = JSON.parse(
			readFileSync(multiPath, "utf-8"),
		) as PersistedWindowState[];
		expect(contents).toHaveLength(1);
		expect(contents[0]).toEqual({
			...SAMPLE_LEGACY_STATE,
			projectId: null,
		});
	});

	it("returns false for a legacy file with invalid shape", () => {
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify({ broken: true }),
			"utf-8",
		);
		expect(migrateWindowStateIfNeeded(tmpDir)).toBe(false);
	});

	it("is idempotent — second call is a no-op", () => {
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify(SAMPLE_LEGACY_STATE),
			"utf-8",
		);

		expect(migrateWindowStateIfNeeded(tmpDir)).toBe(true);
		expect(migrateWindowStateIfNeeded(tmpDir)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Multi-window persistence
// ---------------------------------------------------------------------------

describe("saveAllWindowStates / loadAllWindowStates", () => {
	it("returns empty array when no file exists", () => {
		expect(loadAllWindowStates(tmpDir)).toEqual([]);
	});

	it("round-trips multiple window states", () => {
		saveAllWindowStates(tmpDir, SAMPLE_PERSISTED_STATES);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toEqual(SAMPLE_PERSISTED_STATES);
	});

	it("round-trips an empty array", () => {
		saveAllWindowStates(tmpDir, []);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toEqual([]);
	});

	it("preserves projectId: null for overview windows", () => {
		const states: PersistedWindowState[] = [
			{ x: 0, y: 0, width: 800, height: 600, isMaximized: false, projectId: null },
		];
		saveAllWindowStates(tmpDir, states);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded[0].projectId).toBeNull();
	});

	it("preserves projectId strings", () => {
		const states: PersistedWindowState[] = [
			{
				x: 0,
				y: 0,
				width: 800,
				height: 600,
				isMaximized: false,
				projectId: "my-project-id",
			},
		];
		saveAllWindowStates(tmpDir, states);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded[0].projectId).toBe("my-project-id");
	});

	it("returns empty array for corrupt JSON", () => {
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			"not valid json",
			"utf-8",
		);
		expect(loadAllWindowStates(tmpDir)).toEqual([]);
	});

	it("returns empty array when file contains a non-array JSON value", () => {
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify({ x: 0 }),
			"utf-8",
		);
		expect(loadAllWindowStates(tmpDir)).toEqual([]);
	});

	it("skips invalid entries in the array", () => {
		const raw = [
			SAMPLE_PERSISTED_STATES[0],
			"not an object",
			null,
			{ broken: true },
			SAMPLE_PERSISTED_STATES[1],
		];
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(2);
		expect(loaded[0]).toEqual(SAMPLE_PERSISTED_STATES[0]);
		expect(loaded[1]).toEqual(SAMPLE_PERSISTED_STATES[1]);
	});

	it("treats missing projectId as null", () => {
		const raw = [
			{ x: 10, y: 20, width: 800, height: 600, isMaximized: false },
		];
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].projectId).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// loadAllWindowStates migration integration
// ---------------------------------------------------------------------------

describe("loadAllWindowStates with automatic migration", () => {
	it("migrates legacy file on first load and returns states", () => {
		// Only the legacy file exists.
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify(SAMPLE_LEGACY_STATE),
			"utf-8",
		);

		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(1);
		expect(loaded[0]).toEqual({
			...SAMPLE_LEGACY_STATE,
			projectId: null,
		});

		// The new file should now exist on disk.
		expect(existsSync(resolveMultiWindowStatePath(tmpDir))).toBe(true);
	});

	it("does not re-migrate if multi file already exists", () => {
		// Write legacy state with one position.
		writeFileSync(
			resolveWindowStatePath(tmpDir),
			JSON.stringify(SAMPLE_LEGACY_STATE),
			"utf-8",
		);

		// Write multi file with different data — should be respected over legacy.
		saveAllWindowStates(tmpDir, SAMPLE_PERSISTED_STATES);

		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toEqual(SAMPLE_PERSISTED_STATES);
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	it("handles x/y as undefined when not present in persisted data", () => {
		const raw = [
			{ width: 800, height: 600, isMaximized: false, projectId: null },
		];
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].x).toBeUndefined();
		expect(loaded[0].y).toBeUndefined();
	});

	it("handles x/y as undefined when they are non-numeric", () => {
		const raw = [
			{
				x: "not a number",
				y: true,
				width: 800,
				height: 600,
				isMaximized: false,
				projectId: "proj-1",
			},
		];
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].x).toBeUndefined();
		expect(loaded[0].y).toBeUndefined();
	});

	it("treats numeric projectId as null (only strings are valid)", () => {
		const raw = [
			{ x: 0, y: 0, width: 800, height: 600, isMaximized: false, projectId: 42 },
		];
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].projectId).toBeNull();
	});

	it("preserves duplicate projectId entries (multiple windows per project)", () => {
		const raw = [
			{ x: 10, y: 20, width: 800, height: 600, isMaximized: false, projectId: "proj-a" },
			{ x: 30, y: 40, width: 900, height: 700, isMaximized: true, projectId: "proj-a" },
			{ x: 50, y: 60, width: 1000, height: 800, isMaximized: false, projectId: "proj-b" },
		];
		writeFileSync(resolveMultiWindowStatePath(tmpDir), JSON.stringify(raw), "utf-8");
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(3);
		expect(loaded[0].x).toBe(10);
		expect(loaded[1].x).toBe(30);
		expect(loaded[2].projectId).toBe("proj-b");
	});

	it("preserves multiple overview windows (projectId null)", () => {
		const raw = [
			{ x: 0, y: 0, width: 800, height: 600, isMaximized: false },
			{ x: 100, y: 100, width: 900, height: 700, isMaximized: true },
		];
		writeFileSync(resolveMultiWindowStatePath(tmpDir), JSON.stringify(raw), "utf-8");
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(2);
		expect(loaded[0].x).toBe(0);
		expect(loaded[1].x).toBe(100);
	});
});
