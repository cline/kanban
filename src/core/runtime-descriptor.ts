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
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

const DESCRIPTOR_DIR = join(homedir(), ".cline", "kanban");
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
		(obj.source === "desktop" || obj.source === "cli")
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
