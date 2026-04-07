import { rootCertificates } from "node:tls";
import { Agent } from "undici";
import { getInternalToken } from "../security/passcode-manager";

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
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid KANBAN_RUNTIME_PORT value "${rawPort}". Expected an integer from 1-65535.`);
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
