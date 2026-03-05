const TASK_ID_LENGTH = 5;

export function createShortTaskId(randomUuid: () => string): string {
	return randomUuid().replaceAll("-", "").slice(0, TASK_ID_LENGTH);
}

export function createUniqueTaskId(existingIds: Set<string>, randomUuid: () => string): string {
	for (let attempt = 0; attempt < 16; attempt += 1) {
		const candidate = createShortTaskId(randomUuid);
		if (!existingIds.has(candidate)) {
			return candidate;
		}
	}
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.slice(0, TASK_ID_LENGTH);
}
