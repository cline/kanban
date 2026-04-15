/**
 * Watches workspace state directories for external modifications and triggers
 * live broadcasts so that changes made by a different runtime instance
 * (e.g. CLI runtime vs desktop Electron runtime) appear in all connected
 * web clients without requiring a manual browser refresh.
 *
 * Monitors **meta.json** rather than board.json because meta.json is always
 * written with a fresh revision + updatedAt on every save.  board.json uses
 * atomic-write content comparison and skips the write (leaving mtime
 * unchanged) when only sessions changed — which caused the other runtime
 * to miss the update entirely.
 *
 * Uses **mtime polling** rather than `fs.watch()` because macOS's FSEvents /
 * kqueue does not reliably deliver cross-process directory events for
 * atomic-rename writes — the second process to start often misses events.
 * Polling every 2 s with mtime comparison is simple, deterministic, and
 * works regardless of startup order.
 *
 * Uses self-write tracking to avoid broadcasting our own mutations back.
 */

import { mkdirSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

const META_FILENAME = "meta.json";

/** How often to poll for external changes (ms). */
const POLL_INTERVAL_MS = 2_000;

/**
 * Ignore mtime changes within this window after a self-write (ms).
 * Must exceed POLL_INTERVAL_MS so the next poll cycle is suppressed.
 *
 * This is a timing-based heuristic: under unusual slow IO, clock skew, or
 * overlapping writes the cooldown could miss or delay rebroadcasts.
 * In practice the 3 s window is generous enough for the 2 s poll cycle.
 */
const SELF_WRITE_COOLDOWN_MS = 3_000;

export interface WorkspaceStateWatcherDependencies {
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void> | void;
	warn?: (message: string) => void;
}

interface WatchedWorkspace {
	workspaceId: string;
	workspacePath: string;
	statePath: string;
	pollTimer: NodeJS.Timeout;
	lastSelfWriteAt: number;
	/** Last known mtime of meta.json (ms since epoch). */
	lastMetaMtimeMs: number;
}

export interface WorkspaceStateWatcher {
	/**
	 * Start watching a workspace's state directory for meta.json changes.
	 * Safe to call multiple times for the same workspace — duplicates are ignored.
	 * Creates the state directory if it doesn't exist yet.
	 */
	watch: (workspaceId: string, workspacePath: string, statePath: string) => void;

	/**
	 * Mark that the current process just wrote to this workspace's state files.
	 * This suppresses the next poll cycle to avoid echoing our own writes.
	 */
	markSelfWrite: (workspaceId: string) => void;

	/**
	 * Stop watching a specific workspace.
	 */
	unwatch: (workspaceId: string) => void;

	/**
	 * Stop all watchers and clean up.
	 */
	close: () => void;
}

export function createWorkspaceStateWatcher(deps: WorkspaceStateWatcherDependencies): WorkspaceStateWatcher {
	const watched = new Map<string, WatchedWorkspace>();

	const log = deps.warn ?? (() => {});

	async function pollMetaChange(entry: WatchedWorkspace): Promise<void> {
		// If we recently wrote to this workspace, skip — it's our own mutation.
		if (Date.now() - entry.lastSelfWriteAt < SELF_WRITE_COOLDOWN_MS) {
			return;
		}

		let metaStat: Awaited<ReturnType<typeof stat>>;
		try {
			metaStat = await stat(join(entry.statePath, META_FILENAME));
		} catch {
			// File doesn't exist (yet or was deleted) — nothing to broadcast.
			return;
		}

		const currentMtimeMs = metaStat.mtimeMs;
		if (currentMtimeMs === entry.lastMetaMtimeMs) {
			return;
		}
		entry.lastMetaMtimeMs = currentMtimeMs;

		log(`[workspace-state-watcher] External meta.json change detected for workspace ${entry.workspaceId}`);

		try {
			await deps.broadcastRuntimeWorkspaceStateUpdated(entry.workspaceId, entry.workspacePath);
		} catch (err) {
			log(`[workspace-state-watcher] Broadcast failed for workspace ${entry.workspaceId}: ${err}`);
		}
	}

	return {
		watch: (workspaceId, workspacePath, statePath) => {
			if (watched.has(workspaceId)) {
				return;
			}

			// Ensure the state directory exists.
			try {
				mkdirSync(statePath, { recursive: true });
			} catch {
				return;
			}

			// Snapshot the current mtime so we don't broadcast stale state.
			let initialMtimeMs = 0;
			try {
				initialMtimeMs = statSync(join(statePath, META_FILENAME)).mtimeMs;
			} catch {
				// meta.json doesn't exist yet — mtime stays 0.
			}

			const entry: WatchedWorkspace = {
				workspaceId,
				workspacePath,
				statePath,
				pollTimer: null as unknown as NodeJS.Timeout,
				lastSelfWriteAt: 0,
				lastMetaMtimeMs: initialMtimeMs,
			};

			entry.pollTimer = setInterval(() => {
				void pollMetaChange(entry);
			}, POLL_INTERVAL_MS);

			// Don't prevent process exit.
			entry.pollTimer.unref();

			watched.set(workspaceId, entry);
		},

		markSelfWrite: (workspaceId) => {
			const entry = watched.get(workspaceId);
			if (entry) {
				entry.lastSelfWriteAt = Date.now();
			}
		},

		unwatch: (workspaceId) => {
			const entry = watched.get(workspaceId);
			if (!entry) {
				return;
			}
			clearInterval(entry.pollTimer);
			watched.delete(workspaceId);
		},

		close: () => {
			for (const entry of watched.values()) {
				clearInterval(entry.pollTimer);
			}
			watched.clear();
		},
	};
}
