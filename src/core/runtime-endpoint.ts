export const KANBAN_RUNTIME_HOST = "127.0.0.1";
const DEFAULT_KANBAN_RUNTIME_PORT = 8484;

function parseRuntimePort(rawPort: string | undefined): number {
	if (!rawPort) {
		return DEFAULT_KANBAN_RUNTIME_PORT;
	}
	const parsed = Number.parseInt(rawPort, 10);
	if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
		throw new Error(`Invalid KANBAN_RUNTIME_PORT value "${rawPort}". Expected an integer from 1-65535.`);
	}
	return parsed;
}

export const KANBAN_RUNTIME_PORT = parseRuntimePort(process.env.KANBAN_RUNTIME_PORT?.trim());
export const KANBAN_RUNTIME_ORIGIN = `http://${KANBAN_RUNTIME_HOST}:${KANBAN_RUNTIME_PORT}`;
export const KANBAN_RUNTIME_WS_ORIGIN = `ws://${KANBAN_RUNTIME_HOST}:${KANBAN_RUNTIME_PORT}`;

export function buildKanbanRuntimeUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${KANBAN_RUNTIME_ORIGIN}${normalizedPath}`;
}

export function buildKanbanRuntimeWsUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${KANBAN_RUNTIME_WS_ORIGIN}${normalizedPath}`;
}
