import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	MAX_RESTORED_WINDOWS,
	type PersistedWindowState,
	clampBoundsToDisplays,
	extractPersistablePath,
	isPersistableRuntimePath,
	loadAllWindowStates,
	resolveMultiWindowStatePath,
	saveAllWindowStates,
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

// ---------------------------------------------------------------------------
// lastViewedPath validation — guards against the "Not Found" footgun where
// a file:// URL's pathname gets replayed on the runtime origin.
// ---------------------------------------------------------------------------

describe("isPersistableRuntimePath", () => {
	it.each([
		["/my-project", true],
		["/my-project/tasks/abc-123", true],
		["/workspace%2Fabc", true],
		["/a/b/c/d", true],
	])("accepts legitimate runtime path %s", (input, expected) => {
		expect(isPersistableRuntimePath(input)).toBe(expected);
	});

	it.each([
		// file:// URLs from disconnected.html fallback — the original bug.
		"/Users/someone/main/kanban-desktop/packages/desktop/out/mac-arm64/Kanban.app/Contents/Resources/app.asar/dist/disconnected.html",
		"/Users/johnchoi1/Library/whatever.html",
		"/private/var/folders/x/y/z/Kanban.app/Contents/disconnected.html",
		"/tmp/disconnected.html",
		"/home/user/kanban/disconnected.html",
		"/var/folders/abc/disconnected.html",
		"/opt/kanban/disconnected.html",
		"/Applications/Kanban.app/Contents/Resources/disconnected.html",
		// Any .html pathname — the runtime SPA never exposes those.
		"/index.html",
		"/some/deep/page.html",
		// Degenerate inputs.
		"/",
		"",
		"relative/path",
	])("rejects %s", (input) => {
		expect(isPersistableRuntimePath(input)).toBe(false);
	});
});

describe("loadAllWindowStates heals stale file:// lastViewedPath", () => {
	it("drops a disconnected.html lastViewedPath from existing on-disk state", () => {
		// This mirrors the exact shape written by an older build when the
		// window had been flipped to the local disconnected.html fallback
		// and then the app was quit. On the next launch, without this
		// validation, the window would navigate to
		// http://127.0.0.1:3484/Users/.../disconnected.html → 404.
		const raw = [
			{
				x: 100,
				y: 200,
				width: 1400,
				height: 900,
				isMaximized: false,
				projectId: null,
				lastViewedPath:
					"/Users/alice/main/kanban-desktop/packages/desktop/out/mac-arm64/Kanban.app/Contents/Resources/app.asar/dist/disconnected.html",
			},
		];
		writeFileSync(resolveMultiWindowStatePath(tmpDir), JSON.stringify(raw), "utf-8");

		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded).toHaveLength(1);
		expect(loaded[0].lastViewedPath).toBeUndefined();
	});

	it("preserves a legitimate lastViewedPath like /<projectId>", () => {
		const raw = [
			{
				x: 0,
				y: 0,
				width: 800,
				height: 600,
				isMaximized: false,
				projectId: "proj-a",
				lastViewedPath: "/proj-a/tasks/task-1",
			},
		];
		writeFileSync(resolveMultiWindowStatePath(tmpDir), JSON.stringify(raw), "utf-8");
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded[0].lastViewedPath).toBe("/proj-a/tasks/task-1");
	});
});

// ---------------------------------------------------------------------------
// extractPersistablePath — URL-to-pathname helper shared by window-registry's
// state-save path and app-menu's File → New Window handler.
//
// The key defensive case: when a window shows the local `disconnected.html`
// fallback, its URL is a `file://` URL whose pathname looks like
// `/Users/.../disconnected.html`. Replaying that pathname against the
// runtime origin would strand the window on a 404.
// ---------------------------------------------------------------------------

describe("extractPersistablePath", () => {
	// ── Happy path ────────────────────────────────────────────────────

	it("returns the pathname for a normal http runtime URL", () => {
		expect(extractPersistablePath("http://127.0.0.1:3484/my-project")).toBe(
			"/my-project",
		);
	});

	it("returns the pathname for a normal https runtime URL", () => {
		expect(extractPersistablePath("https://example.com/project/task-42")).toBe(
			"/project/task-42",
		);
	});

	it("preserves multi-segment pathnames", () => {
		expect(
			extractPersistablePath("http://localhost:3484/team/alpha/task/123"),
		).toBe("/team/alpha/task/123");
	});

	// ── Guards against the disconnected.html footgun ──────────────────

	it("returns null for a file:// URL pointing at a disconnected.html fallback", () => {
		const url =
			"file:///Users/dev/Library/Application%20Support/Kanban/disconnected.html";
		expect(extractPersistablePath(url)).toBeNull();
	});

	it("returns null for a file:// URL pointing at a /home/ path (Linux)", () => {
		const url = "file:///home/dev/.config/Kanban/disconnected.html";
		expect(extractPersistablePath(url)).toBeNull();
	});

	it("returns null for any file:// URL regardless of path", () => {
		expect(extractPersistablePath("file:///tmp/something")).toBeNull();
	});

	// ── Other defensive cases ─────────────────────────────────────────

	it("returns null for the root pathname (no useful route to inherit)", () => {
		expect(extractPersistablePath("http://127.0.0.1:3484/")).toBeNull();
	});

	it("returns null for about:blank", () => {
		expect(extractPersistablePath("about:blank")).toBeNull();
	});

	it("returns null for a pathname ending in .html", () => {
		expect(
			extractPersistablePath("http://127.0.0.1:3484/foo.html"),
		).toBeNull();
	});

	it("returns null for a malformed URL", () => {
		expect(extractPersistablePath("not a url")).toBeNull();
	});

	it("returns null for undefined input", () => {
		expect(extractPersistablePath(undefined)).toBeNull();
	});

	it("returns null for null input", () => {
		expect(extractPersistablePath(null)).toBeNull();
	});

	it("returns null for empty string input", () => {
		expect(extractPersistablePath("")).toBeNull();
	});

	// ── Query strings and fragments are ignored (not part of pathname) ──

	it("strips query strings (not part of the pathname)", () => {
		expect(
			extractPersistablePath("http://127.0.0.1:3484/project?foo=bar"),
		).toBe("/project");
	});

	it("strips fragments (not part of the pathname)", () => {
		expect(extractPersistablePath("http://127.0.0.1:3484/project#top")).toBe(
			"/project",
		);
	});
});

// ---------------------------------------------------------------------------
// clampBoundsToDisplays — protects against off-screen window placement after
// a saved-on-secondary-monitor disconnects.
// ---------------------------------------------------------------------------

describe("clampBoundsToDisplays", () => {
	const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
	const SECONDARY_RIGHT = {
		workArea: { x: 1920, y: 0, width: 2560, height: 1440 },
	};
	// macOS-style negative-x display layout — common when a laptop docks
	// to the left of an external display.
	const SECONDARY_LEFT = {
		workArea: { x: -1920, y: 0, width: 1920, height: 1080 },
	};

	const baseState: PersistedWindowState = {
		x: undefined,
		y: undefined,
		width: 1400,
		height: 900,
		isMaximized: false,
		projectId: null,
	};

	it("returns state unchanged when x/y are undefined", () => {
		const out = clampBoundsToDisplays(baseState, [PRIMARY]);
		expect(out).toBe(baseState);
	});

	it("returns state unchanged when bounds fall on the primary display", () => {
		const state = { ...baseState, x: 100, y: 200 };
		const out = clampBoundsToDisplays(state, [PRIMARY]);
		expect(out).toEqual(state);
	});

	it("returns state unchanged when bounds fall on a secondary display", () => {
		const state = { ...baseState, x: 2200, y: 100 };
		const out = clampBoundsToDisplays(state, [PRIMARY, SECONDARY_RIGHT]);
		expect(out).toEqual(state);
	});

	it("clears x/y when bounds fall on a now-disconnected display", () => {
		// Saved on a secondary display that has since been unplugged.
		const state = { ...baseState, x: 2200, y: 100 };
		const out = clampBoundsToDisplays(state, [PRIMARY]);
		expect(out.x).toBeUndefined();
		expect(out.y).toBeUndefined();
		// Width/height/other fields preserved — we only drop the position.
		expect(out.width).toBe(1400);
		expect(out.height).toBe(900);
	});

	it("clears x/y for negative-coordinate off-screen positions", () => {
		// Saved on a left-of-primary display that's no longer attached.
		const state = { ...baseState, x: -500, y: 100 };
		const out = clampBoundsToDisplays(state, [PRIMARY]);
		expect(out.x).toBeUndefined();
		expect(out.y).toBeUndefined();
	});

	it("preserves negative coordinates when the matching display IS attached", () => {
		const state = { ...baseState, x: -500, y: 100 };
		const out = clampBoundsToDisplays(state, [PRIMARY, SECONDARY_LEFT]);
		expect(out.x).toBe(-500);
		expect(out.y).toBe(100);
	});

	it("returns state unchanged when displays array is empty (no info to clamp against)", () => {
		// Defensive — Electron's screen API should never return an empty
		// list, but if it ever does we'd rather honour the saved bounds
		// than blow them away on every launch.
		const state = { ...baseState, x: 100, y: 200 };
		const out = clampBoundsToDisplays(state, []);
		expect(out).toEqual(state);
	});

	it("treats the workArea right/bottom edges as exclusive (1920 is not on a 0..1920 display)", () => {
		// Standard half-open rect semantics — the bottom-right corner of
		// a 1920×1080 primary belongs to the next display, not this one.
		const state = { ...baseState, x: 1920, y: 0 };
		const out = clampBoundsToDisplays(state, [PRIMARY]);
		expect(out.x).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Atomic save — writeFileSync directly to the canonical path is vulnerable
// to crash-mid-write corruption. Verify that saveAllWindowStates writes via
// a sibling tmp file then renames into place.
// ---------------------------------------------------------------------------

describe("saveAllWindowStates atomic write", () => {
	it("does not leave a .tmp file behind after a successful save", () => {
		saveAllWindowStates(tmpDir, SAMPLE_PERSISTED_STATES);
		const finalPath = resolveMultiWindowStatePath(tmpDir);
		expect(existsSync(finalPath)).toBe(true);
		expect(existsSync(`${finalPath}.tmp`)).toBe(false);
	});

	it("preserves the previous state file if a sibling .tmp existed from a prior failed write", () => {
		// Pre-seed the canonical file, then drop a stale .tmp alongside it
		// (simulating a previous run that crashed between writeFileSync and
		// renameSync). The next save must still produce a valid canonical
		// file.
		saveAllWindowStates(tmpDir, SAMPLE_PERSISTED_STATES);
		const finalPath = resolveMultiWindowStatePath(tmpDir);
		writeFileSync(`${finalPath}.tmp`, "STALE GARBAGE", "utf-8");

		const newStates: PersistedWindowState[] = [
			{ x: 1, y: 2, width: 100, height: 200, isMaximized: false, projectId: "p" },
		];
		saveAllWindowStates(tmpDir, newStates);

		// Canonical file reflects the latest write — not the stale tmp.
		expect(loadAllWindowStates(tmpDir)).toEqual(newStates);
		// .tmp is consumed by the rename, so it must no longer exist.
		expect(existsSync(`${finalPath}.tmp`)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Restored window count cap — bounds the blast radius of a hand-edited or
// corrupted state file with absurd entry counts.
// ---------------------------------------------------------------------------

describe("loadAllWindowStates respects MAX_RESTORED_WINDOWS", () => {
	it("caps the number of restored entries", () => {
		const overSize = MAX_RESTORED_WINDOWS + 25;
		const raw = Array.from({ length: overSize }, (_, i) => ({
			x: i,
			y: i,
			width: 800,
			height: 600,
			isMaximized: false,
			projectId: `proj-${i}`,
		}));
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		const loaded = loadAllWindowStates(tmpDir);
		expect(loaded.length).toBe(MAX_RESTORED_WINDOWS);
		// First entries kept, later entries dropped — implementation
		// detail, but locking it in keeps the cap behaviour predictable.
		expect(loaded[0].projectId).toBe("proj-0");
		expect(loaded[loaded.length - 1].projectId).toBe(
			`proj-${MAX_RESTORED_WINDOWS - 1}`,
		);
	});

	it("returns all entries when count is below the cap", () => {
		const raw = Array.from({ length: 5 }, (_, i) => ({
			x: i,
			y: i,
			width: 800,
			height: 600,
			isMaximized: false,
			projectId: `proj-${i}`,
		}));
		writeFileSync(
			resolveMultiWindowStatePath(tmpDir),
			JSON.stringify(raw),
			"utf-8",
		);
		expect(loadAllWindowStates(tmpDir).length).toBe(5);
	});
});
