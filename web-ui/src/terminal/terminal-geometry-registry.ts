export interface TerminalGeometry {
	cols: number;
	rows: number;
}

const geometryByTaskId = new Map<string, TerminalGeometry>();
const geometryVersionByTaskId = new Map<string, number>();

function nextGeometryVersion(taskId: string): number {
	const current = geometryVersionByTaskId.get(taskId) ?? 0;
	const next = current + 1;
	geometryVersionByTaskId.set(taskId, next);
	return next;
}

export function reportTerminalGeometry(taskId: string, geometry: TerminalGeometry): void {
	const previous = geometryByTaskId.get(taskId);
	if (previous && previous.cols === geometry.cols && previous.rows === geometry.rows) {
		return;
	}
	geometryByTaskId.set(taskId, geometry);
	nextGeometryVersion(taskId);
}

export function clearTerminalGeometry(taskId: string): void {
	if (!geometryByTaskId.has(taskId)) {
		return;
	}
	geometryByTaskId.delete(taskId);
	nextGeometryVersion(taskId);
}

export function getTerminalGeometry(taskId: string): TerminalGeometry | null {
	return geometryByTaskId.get(taskId) ?? null;
}

export function prepareWaitForTerminalGeometry(taskId: string, timeoutMs = 300): () => Promise<void> {
	const previousVersion = geometryVersionByTaskId.get(taskId) ?? 0;
	return async () => {
		if (typeof window === "undefined") {
			return;
		}
		await new Promise<void>((resolve) => {
			const startedAt = Date.now();
			const poll = () => {
				const currentVersion = geometryVersionByTaskId.get(taskId) ?? 0;
				if (currentVersion > previousVersion) {
					resolve();
					return;
				}
				if (Date.now() - startedAt >= timeoutMs) {
					resolve();
					return;
				}
				window.setTimeout(poll, 16);
			};
			poll();
		});
	};
}
