export const KANBANANA_RUNTIME_HOST = "127.0.0.1";
const DEFAULT_KANBANANA_RUNTIME_PORT = 8484;

function parseRuntimePort(rawPort: string | undefined): number {
	if (!rawPort) {
		return DEFAULT_KANBANANA_RUNTIME_PORT;
	}
	const parsed = Number.parseInt(rawPort, 10);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid KANBANANA_RUNTIME_PORT value "${rawPort}". Expected an integer from 1-65535.`);
	}
	return parsed;
}

export const KANBANANA_RUNTIME_PORT = parseRuntimePort(process.env.KANBANANA_RUNTIME_PORT?.trim());
export const KANBANANA_RUNTIME_ORIGIN = `http://${KANBANANA_RUNTIME_HOST}:${KANBANANA_RUNTIME_PORT}`;
export const KANBANANA_RUNTIME_WS_ORIGIN = `ws://${KANBANANA_RUNTIME_HOST}:${KANBANANA_RUNTIME_PORT}`;

export function buildKanbananaRuntimeUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${KANBANANA_RUNTIME_ORIGIN}${normalizedPath}`;
}

export function buildKanbananaRuntimeWsUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${KANBANANA_RUNTIME_WS_ORIGIN}${normalizedPath}`;
}
