export interface AppliedRestore {
	generation: number;
	cols: number;
	rows: number;
}

export interface IncomingRestore {
	restoreGeneration?: number;
	cols: number | null | undefined;
	rows: number | null | undefined;
}

export function shouldSkipWarmRestore(lastRestore: AppliedRestore | null, incoming: IncomingRestore): boolean {
	if (incoming.restoreGeneration === undefined || lastRestore === null) {
		return false;
	}

	return (
		lastRestore.generation === incoming.restoreGeneration &&
		lastRestore.cols === incoming.cols &&
		lastRestore.rows === incoming.rows
	);
}
