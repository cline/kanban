export const KANBAN_RUNTIME_HOST = "127.0.0.1";
export const DEFAULT_KANBAN_RUNTIME_PORT = 3484;

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

export function getKanbanRuntimeOrigin(): string {
	return `http://${KANBAN_RUNTIME_HOST}:${getKanbanRuntimePort()}`;
}

export function getKanbanRuntimeWsOrigin(): string {
	return `ws://${KANBAN_RUNTIME_HOST}:${getKanbanRuntimePort()}`;
}

export function buildKanbanRuntimeUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${getKanbanRuntimeOrigin()}${normalizedPath}`;
}

export function buildKanbanRuntimeWsUrl(pathname: string): string {
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${getKanbanRuntimeWsOrigin()}${normalizedPath}`;
}
