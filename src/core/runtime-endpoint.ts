import { isDescriptorStale, readRuntimeDescriptor } from "./runtime-descriptor";

export const DEFAULT_KANBAN_RUNTIME_HOST = "127.0.0.1";
export const DEFAULT_KANBAN_RUNTIME_PORT = 3484;

let runtimeHost: string = process.env.KANBAN_RUNTIME_HOST?.trim() || DEFAULT_KANBAN_RUNTIME_HOST;

export function getKanbanRuntimeHost(): string {
	return runtimeHost;
}

export function setKanbanRuntimeHost(host: string): void {
	runtimeHost = host;
	process.env.KANBAN_RUNTIME_HOST = host;
}

export function parseRuntimePort(rawPort: string | undefined): number {
	if (!rawPort) {
		return DEFAULT_KANBAN_RUNTIME_PORT;
	}
	const parsed = Number.parseInt(rawPort, 10);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 65535) {
		throw new Error(`Invalid KANBAN_RUNTIME_PORT value "${rawPort}". Expected an integer from 0-65535.`);
	}
	return parsed;
}

let runtimePort = parseRuntimePort(process.env.KANBAN_RUNTIME_PORT?.trim());

export function getKanbanRuntimePort(): number {
	return runtimePort;
}

export function setKanbanRuntimePort(port: number): void {
	const normalized = parseRuntimePort(String(port));
	runtimePort = normalized;
	process.env.KANBAN_RUNTIME_PORT = String(normalized);
}

export function getKanbanRuntimeOrigin(): string {
	return `http://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`;
}

export function getKanbanRuntimeWsOrigin(): string {
	return `ws://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`;
}

export function buildKanbanRuntimeUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${getKanbanRuntimeOrigin()}${normalizedPath}`;
}

export function buildKanbanRuntimeWsUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${getKanbanRuntimeWsOrigin()}${normalizedPath}`;
}

// ---------------------------------------------------------------------------
// Resolved runtime connection — async, with descriptor fallback
// ---------------------------------------------------------------------------

export interface ResolvedRuntimeConnection {
	/** Base URL of the runtime (e.g. "http://127.0.0.1:3484" or "http://127.0.0.1:52341"). */
	origin: string;
	/** Auth token to attach as Authorization header, or null if none required. */
	authToken: string | null;
	/** Where the connection was resolved from. */
	source: "env" | "default" | "descriptor";
}

/** Whether env vars explicitly configure the runtime endpoint. */
function hasExplicitEnvConfig(): boolean {
	return !!(process.env.KANBAN_RUNTIME_HOST?.trim() || process.env.KANBAN_RUNTIME_PORT?.trim());
}

/** Read KANBAN_AUTH_TOKEN from environment (set by the runtime for PTY children). */
function getEnvAuthToken(): string | null {
	return process.env.KANBAN_AUTH_TOKEN?.trim() || null;
}

/**
 * Quick connectivity check — try to reach the runtime with a short timeout.
 * Returns true if the server responds to a simple HTTP request.
 */
async function isRuntimeReachable(origin: string, timeoutMs = 1500): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		// Use /api/trpc as a lightweight probe — any 2xx/4xx means the server is alive.
		const response = await fetch(`${origin}/api/trpc/runtime.getInfo?batch=1&input={}`, {
			method: "GET",
			signal: controller.signal,
		});
		clearTimeout(timer);
		// Any HTTP response (even 401/404) means the server is up.
		return response.status > 0;
	} catch {
		return false;
	}
}

/**
 * Resolve the runtime connection with fallback to the desktop runtime descriptor.
 *
 * Resolution priority:
 *   1. Explicit env vars → use configured host/port, no fallback
 *   2. Default localhost:3484 → check if reachable
 *   3. Desktop runtime descriptor → if default is unreachable, read ~/.cline/kanban/runtime.json
 *
 * Existing behavior is 100% preserved:
 *   - If env vars are set, they win unconditionally (same as before).
 *   - If no env vars and default port is reachable, use it (same as before).
 *   - The descriptor is ONLY consulted when the default is unreachable.
 */
export async function resolveRuntimeConnection(): Promise<ResolvedRuntimeConnection> {
	// Priority 1: explicit env config — use it, no fallback.
	// KANBAN_AUTH_TOKEN is read alongside host/port so that PTY child
	// processes spawned by the desktop app can authenticate against
	// the same runtime without needing the descriptor file.
	if (hasExplicitEnvConfig()) {
		return {
			origin: getKanbanRuntimeOrigin(),
			authToken: getEnvAuthToken(),
			source: "env",
		};
	}

	// Priority 2: default endpoint — check if reachable.
	const defaultOrigin = getKanbanRuntimeOrigin();
	if (await isRuntimeReachable(defaultOrigin)) {
		return {
			origin: defaultOrigin,
			authToken: null,
			source: "default",
		};
	}

	// Priority 3: desktop runtime descriptor.
	const descriptor = await readRuntimeDescriptor();
	if (descriptor && !isDescriptorStale(descriptor)) {
		return {
			origin: descriptor.url,
			authToken: descriptor.authToken,
			source: "descriptor",
		};
	}

	// Nothing reachable — return default anyway so callers get a clear error
	// from the actual HTTP call rather than an opaque "no runtime found" message.
	return {
		origin: defaultOrigin,
		authToken: null,
		source: "default",
	};
}
