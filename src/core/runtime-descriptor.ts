/**
 * Runtime descriptor — a per-user file that the desktop app writes when its
 * runtime child becomes ready.  CLI helper commands (task, hooks, etc.) read
 * this as a **fallback** when the default localhost:3484 is unreachable.
 *
 * File location: ~/.cline/kanban/runtime.json
 *
 * Resolution priority (unchanged for existing users):
 *   1. Explicit env vars: KANBAN_RUNTIME_HOST / KANBAN_RUNTIME_PORT
 *   2. Default localhost:3484
 *   3. Desktop runtime descriptor (this file)
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface RuntimeDescriptor {
	/** Full URL the runtime is listening on, e.g. "http://127.0.0.1:52341". */
	url: string;
	/** Ephemeral auth token required for all API requests. */
	authToken: string;
	/** PID of the process that owns the runtime (Electron main or child). */
	pid: number;
	/** ISO-8601 timestamp when the descriptor was written. */
	updatedAt: string;
	/** Where the runtime was launched from: "desktop" or "cli". */
	source: "desktop" | "cli";
	/** Unique ID per desktop app launch — used to detect stale descriptors from prior sessions. */
	desktopSessionId?: string;
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

const DESCRIPTOR_DIR = process.env.KANBAN_DESKTOP_RUNTIME_DESCRIPTOR_DIR || join(homedir(), ".cline", "kanban");
const DESCRIPTOR_FILENAME = "runtime.json";

export function getRuntimeDescriptorPath(): string {
	return join(DESCRIPTOR_DIR, DESCRIPTOR_FILENAME);
}

// ---------------------------------------------------------------------------
// Write — called by the desktop app when the runtime child reports ready
// ---------------------------------------------------------------------------

export async function writeRuntimeDescriptor(descriptor: RuntimeDescriptor): Promise<void> {
	await mkdir(DESCRIPTOR_DIR, { recursive: true });
	const content = JSON.stringify(descriptor, null, "\t");
	await writeFile(getRuntimeDescriptorPath(), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Read — called by CLI helpers as a fallback
// ---------------------------------------------------------------------------

export async function readRuntimeDescriptor(): Promise<RuntimeDescriptor | null> {
	try {
		const raw = await readFile(getRuntimeDescriptorPath(), "utf-8");
		const parsed: unknown = JSON.parse(raw);
		if (!isValidDescriptor(parsed)) {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Clear — called by the desktop app on shutdown
// ---------------------------------------------------------------------------

export async function clearRuntimeDescriptor(): Promise<void> {
	try {
		await rm(getRuntimeDescriptorPath(), { force: true });
	} catch {
		// Best effort — if the file doesn't exist or can't be removed, move on.
	}
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isValidDescriptor(value: unknown): value is RuntimeDescriptor {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;
	return (
		typeof obj.url === "string" &&
		typeof obj.authToken === "string" &&
		typeof obj.pid === "number" &&
		typeof obj.updatedAt === "string" &&
		(obj.source === "desktop" || obj.source === "cli") &&
		(obj.desktopSessionId === undefined || typeof obj.desktopSessionId === "string")
	);
}

// ---------------------------------------------------------------------------
// Staleness check — if the owning PID is no longer running, the descriptor
// is stale and should be ignored.
// ---------------------------------------------------------------------------

export function isDescriptorStale(descriptor: RuntimeDescriptor): boolean {
	try {
		// process.kill(pid, 0) checks if the process exists without sending a signal.
		// It throws if the process does not exist.
		process.kill(descriptor.pid, 0);
		return false;
	} catch {
		return true;
	}
}

// ---------------------------------------------------------------------------
// Desktop session matching — checks whether a desktop-owned descriptor
// belongs to the currently running desktop session.
// ---------------------------------------------------------------------------

export function isDesktopDescriptorFromCurrentSession(
	descriptor: RuntimeDescriptor,
	currentSessionId: string,
): boolean {
	return descriptor.source === "desktop" && descriptor.desktopSessionId === currentSessionId;
}

// ---------------------------------------------------------------------------
// Descriptor trust evaluation — structured decision about whether a
// persisted descriptor should be trusted by the current desktop session.
// ---------------------------------------------------------------------------

export type DescriptorTrustReason =
	| "current-session"
	| "terminal-owned"
	| "pid-dead"
	| "prior-desktop-session"
	| "no-descriptor";

export interface DescriptorTrustResult {
	trusted: boolean;
	reason: DescriptorTrustReason;
	descriptor: RuntimeDescriptor | null;
}

/**
 * Read the runtime descriptor and decide whether the current desktop session
 * should trust it.
 *
 * - **no-descriptor** — file absent or invalid → not trusted (nothing to trust).
 * - **terminal-owned** — source is "cli" → trusted (never interfere with CLI runtimes).
 * - **current-session** — desktop descriptor with matching session ID → trusted.
 * - **pid-dead** — desktop descriptor from a prior session whose PID is dead →
 *   cleaned up and not trusted.
 * - **prior-desktop-session** — desktop descriptor from a different session whose
 *   PID is still alive → not trusted (orphan policy deferred to Task 6).
 */
export async function evaluateDescriptorTrust(currentSessionId: string): Promise<DescriptorTrustResult> {
	const descriptor = await readRuntimeDescriptor();

	if (!descriptor) {
		return { trusted: false, reason: "no-descriptor", descriptor: null };
	}

	// CLI-owned descriptors are always trusted — desktop never interferes.
	if (descriptor.source === "cli") {
		return { trusted: true, reason: "terminal-owned", descriptor };
	}

	// Desktop descriptor from the current session — trust it.
	if (isDesktopDescriptorFromCurrentSession(descriptor, currentSessionId)) {
		return { trusted: true, reason: "current-session", descriptor };
	}

	// Desktop descriptor from a prior session — check PID liveness.
	if (isDescriptorStale(descriptor)) {
		// Dead PID: clean up the stale descriptor.
		await clearRuntimeDescriptor();
		return { trusted: false, reason: "pid-dead", descriptor };
	}

	// PID is still alive but belongs to a different desktop session — orphan.
	return { trusted: false, reason: "prior-desktop-session", descriptor };
}
