export function isShallowEqual<T extends object>(first: T, second: unknown): boolean {
	if (!second || typeof second !== "object") {
		return false;
	}

	const secondRecord = second as Record<string, unknown>;
	const firstRecord = first as Record<string, unknown>;

	const firstKeys = Object.keys(firstRecord);
	const secondKeys = Object.keys(secondRecord);

	if (firstKeys.length !== secondKeys.length) {
		return false;
	}

	for (const key of firstKeys) {
		if (firstRecord[key] !== secondRecord[key]) {
			return false;
		}
	}

	return true;
}
