/**
 * Window state persistence for the Electron main process.
 *
 * Stores and retrieves the BrowserWindow position, size, and maximized state
 * to/from userData so the window(s) reopen in the same position across app
 * restarts.
 *
 * ## Multi-window persistence
 *
 * The new format uses `window-states.json` — an array of
 * `PersistedWindowState` entries, each tagged with an optional `projectId`.
 * A one-time migration converts the legacy single-window `window-state.json`
 * into the new format on first read.
 *
 * The legacy `loadWindowState` / `saveWindowState` helpers are kept for
 * backward compatibility during the transition but are **deprecated**.
 *
 * This module is intentionally free of Electron imports so the pure functions
 * can be tested without an Electron runtime.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowState {
	x: number | undefined;
	y: number | undefined;
	width: number;
	height: number;
	isMaximized: boolean;
}

/**
 * Extended window state that also tracks which project (if any) the window
 * was locked to. `projectId: null` means the overview / unscoped window.
 */
export interface PersistedWindowState extends WindowState {
	projectId: string | null;
	/**
	 * The URL pathname the window was viewing when the app quit.
	 * Used to restore non-locked (overview) windows to the project they
	 * were browsing. Locked windows ignore this and use `projectId` instead.
	 */
	lastViewedPath?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Legacy single-window state file (kept for migration). */
const LEGACY_STATE_FILE = "window-state.json";

/** New multi-window state file. */
const MULTI_STATE_FILE = "window-states.json";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Resolve the full path to the legacy window state file in userData. */
export function resolveWindowStatePath(userDataPath: string): string {
	return path.join(userDataPath, LEGACY_STATE_FILE);
}

/** Resolve the full path to the multi-window state file in userData. */
export function resolveMultiWindowStatePath(userDataPath: string): string {
	return path.join(userDataPath, MULTI_STATE_FILE);
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validate and parse a raw JSON object into a `WindowState`.
 * Returns `undefined` if the shape is invalid.
 */
function parseWindowState(parsed: Record<string, unknown>): WindowState | undefined {
	if (
		typeof parsed.width !== "number" ||
		typeof parsed.height !== "number" ||
		typeof parsed.isMaximized !== "boolean"
	) {
		return undefined;
	}

	return {
		x: typeof parsed.x === "number" ? parsed.x : undefined,
		y: typeof parsed.y === "number" ? parsed.y : undefined,
		width: parsed.width,
		height: parsed.height,
		isMaximized: parsed.isMaximized,
	};
}

/**
 * Validate and parse a raw JSON object into a `PersistedWindowState`.
 * Returns `undefined` if the base shape is invalid.
 */
function parsePersistedWindowState(
	raw: Record<string, unknown>,
): PersistedWindowState | undefined {
	const base = parseWindowState(raw);
	if (!base) return undefined;

	const state: PersistedWindowState = {
		...base,
		projectId:
			typeof raw.projectId === "string" ? raw.projectId : null,
	};
	if (typeof raw.lastViewedPath === "string" && raw.lastViewedPath) {
		state.lastViewedPath = raw.lastViewedPath;
	}
	return state;
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

/**
 * One-time migration: if the legacy `window-state.json` exists but the new
 * `window-states.json` does not, convert the old single-state format into
 * a one-element array in the new file.
 *
 * Returns `true` if migration was performed, `false` otherwise.
 */
export function migrateWindowStateIfNeeded(userDataPath: string): boolean {
	const legacyPath = resolveWindowStatePath(userDataPath);
	const multiPath = resolveMultiWindowStatePath(userDataPath);

	// Nothing to migrate if the new file already exists.
	if (existsSync(multiPath)) return false;

	// Nothing to migrate if the legacy file doesn't exist.
	if (!existsSync(legacyPath)) return false;

	try {
		const raw = readFileSync(legacyPath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const state = parseWindowState(parsed);
		if (!state) return false;

		const persisted: PersistedWindowState = { ...state, projectId: null };
		writeFileSync(multiPath, JSON.stringify([persisted], null, "\t"), "utf-8");
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Multi-window persistence (new API)
// ---------------------------------------------------------------------------

/**
 * Load all persisted window states from `window-states.json`.
 *
 * Automatically performs one-time migration from the legacy format if needed.
 * Returns an empty array if no persisted state exists or the file is corrupt.
 */
export function loadAllWindowStates(
	userDataPath: string,
): PersistedWindowState[] {
	// Run migration first (no-op if already done).
	migrateWindowStateIfNeeded(userDataPath);

	const filePath = resolveMultiWindowStatePath(userDataPath);
	if (!existsSync(filePath)) return [];

	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;

		if (!Array.isArray(parsed)) return [];

		const results: PersistedWindowState[] = [];
		for (const entry of parsed) {
			if (typeof entry !== "object" || entry === null) continue;
			const state = parsePersistedWindowState(
				entry as Record<string, unknown>,
			);
			if (!state) continue;
			results.push(state);
		}

		return results;
	} catch {
		return [];
	}
}

/**
 * Save all window states to `window-states.json`.
 *
 * Writes synchronously to ensure the data is flushed before the process
 * exits (called from `before-quit`).
 */
export function saveAllWindowStates(
	userDataPath: string,
	states: PersistedWindowState[],
): void {
	try {
		const filePath = resolveMultiWindowStatePath(userDataPath);
		writeFileSync(filePath, JSON.stringify(states, null, "\t"), "utf-8");
	} catch {
		// Best-effort — don't crash if userData is read-only.
	}
}

// ---------------------------------------------------------------------------
// Legacy single-window API (deprecated — kept for transition)
// ---------------------------------------------------------------------------

/**
 * Load persisted window state from disk.
 * Returns undefined if the file doesn't exist or is corrupt.
 *
 * @deprecated Use {@link loadAllWindowStates} instead.
 */
export function loadWindowState(userDataPath: string): WindowState | undefined {
	try {
		const filePath = resolveWindowStatePath(userDataPath);
		if (!existsSync(filePath)) return undefined;
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		return parseWindowState(parsed);
	} catch {
		return undefined;
	}
}

/**
 * Save window state to disk. Writes synchronously to ensure the data
 * is flushed before the process exits.
 *
 * @deprecated Use {@link saveAllWindowStates} instead.
 */
export function saveWindowState(
	userDataPath: string,
	state: WindowState,
): void {
	try {
		const filePath = resolveWindowStatePath(userDataPath);
		writeFileSync(filePath, JSON.stringify(state, null, "\t"), "utf-8");
	} catch {
		// Best-effort — don't crash if userData is read-only.
	}
}
