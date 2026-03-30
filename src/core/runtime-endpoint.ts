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
}

let runtimeTls: RuntimeTlsConfig | null = null;

/**
 * Whether the runtime is served over HTTPS. Initialised from the
 * `KANBAN_RUNTIME_HTTPS` env var so that CLI sub-commands (which run
 * in a separate process from the server) know the correct scheme.
 */
let runtimeHttps: boolean = process.env.KANBAN_RUNTIME_HTTPS === "1";

export function getKanbanRuntimeTls(): RuntimeTlsConfig | null {
	return runtimeTls;
}

export function setKanbanRuntimeTls(tls: RuntimeTlsConfig): void {
	runtimeTls = tls;
	runtimeHttps = true;
	process.env.KANBAN_RUNTIME_HTTPS = "1";
}

export function isKanbanRuntimeHttps(): boolean {
	return runtimeHttps;
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
 * A fetch function that accepts self-signed TLS certificates when
 * connecting to the kanban runtime over HTTPS. This is needed because the
 * `--https` flag can auto-generate a self-signed cert that Node's default
 * fetch would reject.
 *
 * When HTTPS is not enabled this simply returns the global fetch.
 */
let _runtimeFetchPromise: Promise<typeof globalThis.fetch> | undefined;

export function getRuntimeFetch(): Promise<typeof globalThis.fetch> {
	_runtimeFetchPromise ??= (async () => {
		if (!isKanbanRuntimeHttps()) {
			return globalThis.fetch;
		}
		try {
			// Node 22 bundles undici — use its Agent for per-request TLS config.
			const { Agent } = await import("undici");
			const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
			return ((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
				globalThis.fetch(url, { ...init, dispatcher } as RequestInit)) as typeof globalThis.fetch;
		} catch {
			// Fallback: the cert may be mkcert-signed and already trusted.
			return globalThis.fetch;
		}
	})();
	return _runtimeFetchPromise;
}
