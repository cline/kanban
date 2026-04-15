/**
 * Runtime takeover — coordinates failover when the runtime authority dies.
 *
 * Algorithm (exact flow on disconnect):
 *   1. Grace window: retry health checks for GRACE_MS. If runtime recovers → reconnect, done.
 *   2. Re-read descriptor: if it now points to a healthy runtime (someone else took over) → attach, done.
 *   3. Acquire lock: atomically create runtime.takeover.lock. If lock fails → wait for winner.
 *   4. Winner starts runtime + writes descriptor → releases lock.
 *   5. All other clients poll descriptor → detect new authority → reattach.
 *
 * Why this works:
 *   - Grace window prevents unnecessary failover on short blips.
 *   - Lock prevents both apps starting runtimes simultaneously.
 *   - Re-read-before-takeover avoids stale assumptions.
 */

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { join } from "node:path";
import {
	getRuntimeDescriptorDir,
	isDescriptorStale,
	type RuntimeDescriptor,
	readRuntimeDescriptor,
} from "./runtime-descriptor";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to retry health checks before attempting takeover (ms). */
const GRACE_MS = 4_000;

/** Interval between health check retries during grace window (ms). */
const HEALTH_RETRY_INTERVAL_MS = 800;

/** Health check timeout per attempt (ms). */
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

/**
 * How long the lock file is considered valid (ms). Prevents permanent lock
 * from crashed processes.  This is a time-based heuristic — under unusual
 * crash/timing scenarios a lock could theoretically be removed before its
 * holder finishes.  Acceptable because the double-check-under-lock (step 4)
 * prevents duplicate runtime starts even if the lock is contested.
 */
const LOCK_TTL_MS = 30_000;

/** How long to wait for another process to finish takeover before retrying (ms). */
const WAIT_FOR_WINNER_MS = 10_000;

/** Interval to poll descriptor while waiting for winner (ms). */
const WINNER_POLL_INTERVAL_MS = 1_000;

const LOCK_FILENAME = "runtime.takeover.lock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TakeoverCallbacks {
	/** Start a local runtime process. Returns url + authToken when ready. */
	startRuntime: () => Promise<{ url: string; authToken: string }>;

	/** Called when a healthy runtime is found (existing or new). Connect the UI to it. */
	onAttach: (descriptor: RuntimeDescriptor) => Promise<void>;

	/** Called when takeover is starting (for UX state updates). */
	onTakeoverStarting?: () => void;

	/** Called when reconnected during grace window (for UX state updates). */
	onReconnected?: () => void;

	/** Optional logger. */
	warn?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

function checkHealth(url: string, authToken: string, timeoutMs: number): Promise<boolean> {
	return new Promise((resolve) => {
		try {
			const healthUrl = new URL("/api/health", url);
			const transport = healthUrl.protocol === "https:" ? https : http;
			const headers: Record<string, string> = {};
			if (authToken) {
				headers.Authorization = `Bearer ${authToken}`;
			}

			const timer = setTimeout(() => {
				req.destroy();
				resolve(false);
			}, timeoutMs);

			const req = transport.get(healthUrl, { headers }, (res) => {
				clearTimeout(timer);
				res.resume();
				resolve(res.statusCode === 200);
			});
			req.on("error", () => {
				clearTimeout(timer);
				resolve(false);
			});
		} catch {
			resolve(false);
		}
	});
}

async function isDescriptorHealthy(descriptor: RuntimeDescriptor | null): Promise<boolean> {
	if (!descriptor) return false;
	if (isDescriptorStale(descriptor)) return false;
	return checkHealth(descriptor.url, descriptor.authToken, HEALTH_CHECK_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Lock file
// ---------------------------------------------------------------------------

function getLockPath(): string {
	return join(getRuntimeDescriptorDir(), LOCK_FILENAME);
}

async function acquireLock(): Promise<boolean> {
	try {
		await mkdir(getRuntimeDescriptorDir(), { recursive: true });

		// Check if a stale lock exists (from a crashed process).
		// We use both TTL expiry AND PID liveness — if the lock holder's
		// PID is dead, the lock is definitely stale regardless of TTL.
		try {
			const lockStat = await stat(getLockPath());
			const ttlExpired = Date.now() - lockStat.mtimeMs > LOCK_TTL_MS;
			const ownerDead = await isLockOwnerDead();
			if (ttlExpired || ownerDead) {
				await rm(getLockPath(), { force: true });
			}
		} catch {
			// Lock doesn't exist — good.
		}

		// Atomic create — fails if file already exists (O_EXCL via wx flag).
		await writeFile(getLockPath(), JSON.stringify({ pid: process.pid, at: Date.now() }), {
			flag: "wx",
		});
		return true;
	} catch {
		return false;
	}
}

/** Try to read the lock file and check if the owner PID is still alive. */
async function isLockOwnerDead(): Promise<boolean> {
	try {
		const raw = await readFile(getLockPath(), "utf-8");
		const parsed = JSON.parse(raw) as { pid?: number };
		if (typeof parsed.pid !== "number") return false;
		// process.kill(pid, 0) throws if PID doesn't exist.
		process.kill(parsed.pid, 0);
		return false; // PID is alive.
	} catch {
		return true; // Can't read lock or PID is dead.
	}
}

async function releaseLock(): Promise<void> {
	try {
		await rm(getLockPath(), { force: true });
	} catch {
		// Best effort.
	}
}

// ---------------------------------------------------------------------------
// Grace window — retry health checks before giving up
// ---------------------------------------------------------------------------

async function retryHealthFor(url: string, authToken: string, graceMs: number): Promise<boolean> {
	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		const healthy = await checkHealth(url, authToken, HEALTH_CHECK_TIMEOUT_MS);
		if (healthy) return true;
		await delay(HEALTH_RETRY_INTERVAL_MS);
	}
	return false;
}

// ---------------------------------------------------------------------------
// Wait for another process to complete takeover
// ---------------------------------------------------------------------------

async function waitForHealthyDescriptor(timeoutMs: number): Promise<RuntimeDescriptor | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const d = await readRuntimeDescriptor();
		if (d && !isDescriptorStale(d)) {
			const healthy = await checkHealth(d.url, d.authToken, HEALTH_CHECK_TIMEOUT_MS);
			if (healthy) return d;
		}
		await delay(WINNER_POLL_INTERVAL_MS);
	}
	return null;
}

// ---------------------------------------------------------------------------
// Main takeover entry point
// ---------------------------------------------------------------------------

/**
 * Handle runtime disconnect. Implements the full takeover algorithm:
 * grace → re-read → lock → start → publish → reattach.
 *
 * @param failedUrl The URL of the runtime that went down
 * @param failedAuthToken The auth token of the failed runtime
 * @param callbacks Hooks for starting runtime, attaching, and UX updates
 */
export async function handleRuntimeDisconnect(
	failedUrl: string,
	failedAuthToken: string,
	callbacks: TakeoverCallbacks,
): Promise<void> {
	const log = callbacks.warn ?? (() => {});

	// ── Step 1: Grace window ──────────────────────────────────────────
	log("[takeover] Runtime disconnected — entering grace window...");
	const recovered = await retryHealthFor(failedUrl, failedAuthToken, GRACE_MS);
	if (recovered) {
		log("[takeover] Runtime recovered during grace window.");
		callbacks.onReconnected?.();
		return;
	}

	// ── Step 2: Re-read descriptor ────────────────────────────────────
	log("[takeover] Grace window expired — checking descriptor...");
	const currentDescriptor = await readRuntimeDescriptor();
	if (currentDescriptor && (await isDescriptorHealthy(currentDescriptor))) {
		log("[takeover] Another process already took over — attaching.");
		await callbacks.onAttach(currentDescriptor);
		return;
	}

	// ── Step 3: Acquire lock ──────────────────────────────────────────
	callbacks.onTakeoverStarting?.();
	log("[takeover] Attempting to acquire takeover lock...");

	if (!(await acquireLock())) {
		log("[takeover] Lock held by another process — waiting for winner...");
		const winnerDescriptor = await waitForHealthyDescriptor(WAIT_FOR_WINNER_MS);
		if (winnerDescriptor) {
			log("[takeover] Winner published descriptor — attaching.");
			await callbacks.onAttach(winnerDescriptor);
			return;
		}
		// Winner didn't publish in time — try to acquire lock ourselves.
		if (!(await acquireLock())) {
			log("[takeover] Still can't acquire lock — giving up.");
			return;
		}
	}

	// ── Step 4: Double-check descriptor (under lock) ──────────────────
	try {
		const d2 = await readRuntimeDescriptor();
		if (d2 && (await isDescriptorHealthy(d2))) {
			log("[takeover] Healthy runtime appeared while acquiring lock — attaching.");
			await callbacks.onAttach(d2);
			return;
		}

		// ── Step 5: Start runtime + publish descriptor ────────────────
		log("[takeover] Starting local runtime...");
		const { url } = await callbacks.startRuntime();
		log(`[takeover] Runtime started at ${url} — reading new descriptor.`);

		// Re-read the descriptor that startRuntime() should have written.
		// We intentionally ignore the { url, authToken } return value and
		// re-read from disk — the descriptor is the single source of truth
		// for runtime authority.  If the descriptor write lags or fails,
		// this re-read will return null and the caller won't attach.
		const newDescriptor = await readRuntimeDescriptor();
		if (newDescriptor) {
			log("[takeover] Descriptor published — attaching to new runtime.");
			await callbacks.onAttach(newDescriptor);
		} else {
			log("[takeover] WARNING: startRuntime() succeeded but descriptor is missing — cannot attach.");
		}
	} finally {
		await releaseLock();
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
