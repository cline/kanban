import { rootCertificates } from "node:tls";
import { Agent } from "undici";
import { getInternalToken } from "../security/passcode-manager";
import { isDescriptorStale, readRuntimeDescriptor } from "./runtime-descriptor";

export const DEFAULT_KANBAN_RUNTIME_HOST = "127.0.0.1";
export const DEFAULT_KANBAN_RUNTIME_PORT = 3484;
const KANBAN_RUNTIME_HTTPS_ENV = "KANBAN_RUNTIME_HTTPS";
const KANBAN_RUNTIME_TLS_CA_ENV = "KANBAN_RUNTIME_TLS_CA";

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

export interface RuntimeTlsConfig {
	cert: string;
	key: string;
	ca?: string;
}

let runtimeTls: RuntimeTlsConfig | null = null;
let runtimeTlsCa: string | null = process.env[KANBAN_RUNTIME_TLS_CA_ENV]?.trim() || null;

/**
 * Whether the runtime is served over HTTPS. Initialised from the
 * `KANBAN_RUNTIME_HTTPS` env var so that CLI sub-commands (which run
 * in a separate process from the server) know the correct scheme.
 */
let runtimeHttps: boolean = process.env[KANBAN_RUNTIME_HTTPS_ENV] === "1";

function clearRuntimeFetchCache(): void {
	_runtimeFetchPromise = undefined;
}

export function getKanbanRuntimeTls(): RuntimeTlsConfig | null {
	return runtimeTls;
}

export function setKanbanRuntimeTls(tls: RuntimeTlsConfig): void {
	runtimeTls = tls;
	runtimeHttps = true;
	runtimeTlsCa = tls.ca?.trim() || null;
	process.env[KANBAN_RUNTIME_HTTPS_ENV] = "1";
	if (runtimeTlsCa) {
		process.env[KANBAN_RUNTIME_TLS_CA_ENV] = runtimeTlsCa;
	} else {
		delete process.env[KANBAN_RUNTIME_TLS_CA_ENV];
	}
	clearRuntimeFetchCache();
}

export function clearKanbanRuntimeTls(): void {
	runtimeTls = null;
	runtimeTlsCa = null;
	runtimeHttps = false;
	delete process.env[KANBAN_RUNTIME_HTTPS_ENV];
	delete process.env[KANBAN_RUNTIME_TLS_CA_ENV];
	clearRuntimeFetchCache();
}

export function isKanbanRuntimeHttps(): boolean {
	return runtimeHttps;
}

const LOCALHOST_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

/**
 * Returns true when Kanban is bound to a non-localhost host, meaning it is
 * accessible to other machines on the network and passcode auth is required.
 */
export function isKanbanRemoteHost(): boolean {
	return !LOCALHOST_HOSTS.has(runtimeHost);
}

export function getKanbanRuntimeOrigin(): string {
	const scheme = isKanbanRuntimeHttps() ? "https" : "http";
	return `${scheme}://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`;
}

export function getKanbanRuntimeWsOrigin(): string {
	const scheme = isKanbanRuntimeHttps() ? "wss" : "ws";
	return `${scheme}://${getKanbanRuntimeHost()}:${getKanbanRuntimePort()}`;
}

export function buildKanbanRuntimeUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${getKanbanRuntimeOrigin()}${normalizedPath}`;
}

export function buildKanbanRuntimeWsUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${getKanbanRuntimeWsOrigin()}${normalizedPath}`;
}

/**
 * A fetch function that trusts the configured Kanban runtime certificate
 * bundle when connecting to the runtime over HTTPS, and automatically
 * attaches the internal CLI auth token (when present) so that CLI
 * sub-processes can authenticate against the runtime server without the
 * browser passcode flow.
 *
 * When HTTPS is not enabled and no internal token exists, this simply
 * returns the global fetch.
 */
let _runtimeFetchPromise: Promise<typeof globalThis.fetch> | undefined;

export function getRuntimeFetch(): Promise<typeof globalThis.fetch> {
	_runtimeFetchPromise ??= (async () => {
		let baseFetch: typeof globalThis.fetch = globalThis.fetch;

		if (isKanbanRuntimeHttps() && runtimeTlsCa) {
			const dispatcher = new Agent({
				connect: {
					ca: [...rootCertificates, runtimeTlsCa].join("\n"),
				},
			});
			baseFetch = ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
				globalThis.fetch(url, { ...init, dispatcher } as RequestInit)) as typeof globalThis.fetch;
		}

		// Wrap the base fetch to inject the internal CLI auth bearer token
		// when one is available (propagated via env var from the server process).
		const internalToken = getInternalToken();
		if (!internalToken) {
			return baseFetch;
		}

		const wrappedFetch = baseFetch;
		return ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
			const headers = new Headers(init?.headers);
			if (!headers.has("Authorization")) {
				headers.set("Authorization", `Bearer ${internalToken}`);
			}
			return wrappedFetch(url, { ...init, headers });
		}) as typeof globalThis.fetch;
	})();
	return _runtimeFetchPromise;
}

// ---------------------------------------------------------------------------
// Resolved runtime connection — async, descriptor-first
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
 * Extract just the origin (scheme + host + port) from a descriptor URL.
 *
 * Descriptor URLs may include a workspace path (e.g.
 * "http://127.0.0.1:62929/cline") that is useful for browser navigation
 * but must NOT be included in the API base URL — otherwise TRPC calls
 * get routed to the wrong path.
 */
export function descriptorOriginFromUrl(descriptorUrl: string): string {
	return new URL(descriptorUrl).origin;
}

/**
 * Quick connectivity check — try to reach the runtime with a short timeout.
 * Returns true if the server responds to a simple HTTP request.
 *
 * Uses /api/health as the probe endpoint.  Any HTTP response (including
 * 401/404) means the server process is alive.  If the runtime renames or
 * relocates that path in the future, update this probe to match.
 */
async function isRuntimeReachable(origin: string, timeoutMs = 1500): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(`${origin}/api/health`, {
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
 * Resolve the runtime connection — descriptor-first policy.
 *
 * The runtime descriptor (~/.cline/kanban/runtime.json) is the single
 * shared authority pointer. All non-explicit clients should connect to
 * whatever runtime the descriptor points at, preventing split-brain
 * when multiple runtimes are running on different ports.
 *
 * Resolution priority:
 *   1. Explicit env vars (KANBAN_RUNTIME_HOST / PORT) → use configured endpoint, no fallback.
 *   2. Healthy runtime descriptor → the authority runtime, wherever it lives.
 *   3. Default localhost:3484 → fallback when no descriptor exists.
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

	// Priority 2: runtime descriptor — the shared authority pointer.
	// Both CLI and desktop publish descriptors when they start a runtime.
	// Clients should connect to the descriptor authority first; the default
	// port is only a fallback when no authority has been established.
	const descriptor = await readRuntimeDescriptor();
	if (descriptor && !isDescriptorStale(descriptor)) {
		const descriptorOrigin = descriptorOriginFromUrl(descriptor.url);
		if (await isRuntimeReachable(descriptorOrigin)) {
			return {
				origin: descriptorOrigin,
				authToken: descriptor.authToken,
				source: "descriptor",
			};
		}
		// Descriptor exists but runtime is unreachable — fall through to default.
	}

	// Priority 3: default endpoint — fallback when no authority descriptor exists.
	const defaultOrigin = getKanbanRuntimeOrigin();
	if (await isRuntimeReachable(defaultOrigin)) {
		return {
			origin: defaultOrigin,
			authToken: null,
			source: "default",
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
