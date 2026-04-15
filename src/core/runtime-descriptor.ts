/**
 * Runtime descriptor — a per-user file that each runtime (CLI or desktop)
 * writes when it becomes the active authority.  Other processes read this as
 * the **primary** connection target, preventing split-brain when multiple
 * runtimes are running on different ports.
 *
 * File location: ~/.cline/kanban/runtime.json
 *
 * Resolution priority (see resolveRuntimeConnection in runtime-endpoint.ts):
 *   1. Explicit env vars: KANBAN_RUNTIME_HOST / KANBAN_RUNTIME_PORT
 *   2. Healthy runtime descriptor (this file) — the shared authority pointer
 *   3. Default localhost:3484 — fallback when no descriptor exists
 *
 * Staleness: the descriptor records the PID of the owning process.
 * Consumers check PID liveness to avoid connecting to a stale descriptor
 * from a crashed process.  This is a best-effort heuristic — PID reuse is
 * theoretically possible but extremely unlikely on short timescales.
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

const DESCRIPTOR_FILENAME = "runtime.json";

export function getRuntimeDescriptorDir(): string {
	return process.env.KANBAN_DESKTOP_RUNTIME_DESCRIPTOR_DIR || join(homedir(), ".cline", "kanban");
}

export function getRuntimeDescriptorPath(): string {
	return join(getRuntimeDescriptorDir(), DESCRIPTOR_FILENAME);
}

// ---------------------------------------------------------------------------
// Write — called by any runtime (CLI or desktop) to claim authority
// ---------------------------------------------------------------------------

export async function writeRuntimeDescriptor(descriptor: RuntimeDescriptor): Promise<void> {
	await mkdir(getRuntimeDescriptorDir(), { recursive: true });
	const content = JSON.stringify(descriptor, null, "\t");
	await writeFile(getRuntimeDescriptorPath(), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Read — called by any process to discover the current runtime authority
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
	| "cli-owned"
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
 * - **cli-owned** — source is "cli" → trusted (never interfere with CLI runtimes).
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
		return { trusted: true, reason: "cli-owned", descriptor };
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
