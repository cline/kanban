import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface WindowState {
	x: number | undefined;
	y: number | undefined;
	width: number;
	height: number;
	isMaximized: boolean;
}

export interface PersistedWindowState extends WindowState {
	projectId: string | null;
	lastViewedPath?: string | null;
}

/**
 * Hard cap on restored window count. A hand-edited or corrupted state file
 * with thousands of entries would otherwise cause the startup code to spawn
 * thousands of `BrowserWindow` instances, exhausting system resources before
 * the user could intervene.
 */
export const MAX_RESTORED_WINDOWS = 50;

export function resolveMultiWindowStatePath(userDataPath: string): string {
	return path.join(userDataPath, "window-states.json");
}

/**
 * Clear `x`/`y` if the saved position falls outside every attached display.
 *
 * Electron does not auto-constrain a `BrowserWindow` to a visible display, so
 * a window whose state was saved on a now-disconnected secondary monitor
 * would be placed off-screen on next launch with no recovery path. Dropping
 * the coordinates lets Electron fall back to its default placement.
 */
export interface DisplayWorkArea {
	workArea: { x: number; y: number; width: number; height: number };
}

export function clampBoundsToDisplays<T extends WindowState>(
	state: T,
	displays: ReadonlyArray<DisplayWorkArea>,
): T {
	if (state.x === undefined || state.y === undefined) return state;
	if (displays.length === 0) return state;
	const x = state.x;
	const y = state.y;
	const onScreen = displays.some(
		(d) =>
			x >= d.workArea.x &&
			y >= d.workArea.y &&
			x < d.workArea.x + d.workArea.width &&
			y < d.workArea.y + d.workArea.height,
	);
	if (onScreen) return state;
	return { ...state, x: undefined, y: undefined };
}


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
 * A crashed runtime leaves windows on `file:///…/disconnected.html`, whose
 * `.pathname` looks replayable but 404s against `http://host:port`. Reject
 * filesystem-looking paths and `.html` routes at both save- and load-time
 * so older bad state auto-heals.
 */
export function isPersistableRuntimePath(pathname: string): boolean {
	if (typeof pathname !== "string" || !pathname.startsWith("/")) return false;
	if (pathname === "/") return false;
	if (pathname.toLowerCase().endsWith(".html")) return false;
	// Heuristic guard against filesystem-looking paths leaking in via
	// hand-edited or corrupted state files. Not exhaustive; the `.html`
	// check above catches the realistic crash-page case.
	const absFsPrefixes = ["/Users/", "/home/", "/private/", "/tmp/", "/var/", "/opt/", "/Applications/"];
	for (const prefix of absFsPrefixes) {
		if (pathname.startsWith(prefix)) return false;
	}
	return true;
}

export function extractPersistablePath(
	currentUrl: string | undefined | null,
): string | null {
	if (!currentUrl) return null;
	try {
		const url = new URL(currentUrl);
		const isHttp = url.protocol === "http:" || url.protocol === "https:";
		if (isHttp && isPersistableRuntimePath(url.pathname)) {
			return url.pathname;
		}
	} catch {
		/* malformed URL */
	}
	return null;
}

function parsePersistedWindowState(raw: Record<string, unknown>): PersistedWindowState | undefined {
	const base = parseWindowState(raw);
	if (!base) return undefined;
	const state: PersistedWindowState = {
		...base,
		projectId: typeof raw.projectId === "string" ? raw.projectId : null,
	};
	if (typeof raw.lastViewedPath === "string" && isPersistableRuntimePath(raw.lastViewedPath)) {
		state.lastViewedPath = raw.lastViewedPath;
	}
	return state;
}

export function loadAllWindowStates(userDataPath: string): PersistedWindowState[] {
	const filePath = resolveMultiWindowStatePath(userDataPath);
	if (!existsSync(filePath)) return [];
	try {
		const raw = readFileSync(filePath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		const results: PersistedWindowState[] = [];
		for (const entry of parsed) {
			if (typeof entry !== "object" || entry === null) continue;
			const state = parsePersistedWindowState(entry as Record<string, unknown>);
			if (state) results.push(state);
			if (results.length >= MAX_RESTORED_WINDOWS) {
				console.warn(
					`[desktop] Window state file contains ${parsed.length} entries — capping at ${MAX_RESTORED_WINDOWS} to prevent resource exhaustion.`,
				);
				break;
			}
		}
		return results;

	} catch (err) {
		// A corrupt state file would otherwise silently lose every saved
		// window — log so support can spot it.
		console.warn(
			"[desktop] Failed to read window states from",
			filePath,
			"—",
			err instanceof Error ? err.message : err,
		);
		return [];
	}
}

export function saveAllWindowStates(userDataPath: string, states: PersistedWindowState[]): void {
	try {
		const filePath = resolveMultiWindowStatePath(userDataPath);
		// Write to a sibling tmp file then rename onto the target. `rename`
		// is atomic on POSIX and Windows (ReplaceFile semantics in Node),
		// so a crash mid-`writeFileSync` can no longer leave the canonical
		// state file truncated and unparseable — which would otherwise
		// silently drop every saved window position on the next launch.
		const tmpPath = `${filePath}.tmp`;
		writeFileSync(tmpPath, JSON.stringify(states, null, "\t"), "utf-8");
		renameSync(tmpPath, filePath);
	} catch (err) {
		console.warn(
			"[desktop] Failed to save window states:",
			err instanceof Error ? err.message : err,
		);
	}
}
