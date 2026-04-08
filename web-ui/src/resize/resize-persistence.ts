import { type LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

export function clampBetween(value: number, min: number, max: number, round = false): number {
	const normalizedValue = round ? Math.round(value) : value;
	return Math.max(min, Math.min(max, normalizedValue));
}

export function clampAtLeast(value: number, min: number, round = false): number {
	const normalizedValue = round ? Math.round(value) : value;
	return Math.max(min, normalizedValue);
}

export function clampWidthToContainer({
	width,
	minWidth,
	containerWidth,
	reservedWidth,
}: {
	width: number;
	minWidth: number;
	containerWidth: number;
	reservedWidth: number;
}): number {
	return clampBetween(width, minWidth, containerWidth - reservedWidth, true);
}

export function readPersistedResizeNumber({
	key,
	fallback,
	normalize,
}: {
	key: LocalStorageKey;
	fallback: number;
	normalize?: (value: number) => number;
}): number {
	const storedValue = readLocalStorageItem(key);
	if (!storedValue) {
		return fallback;
	}
	const parsedValue = Number(storedValue);
	if (!Number.isFinite(parsedValue)) {
		return fallback;
	}
	return normalize ? normalize(parsedValue) : parsedValue;
}

export function readOptionalPersistedResizeNumber({
	key,
	normalize,
}: {
	key: LocalStorageKey;
	normalize?: (value: number) => number;
}): number | undefined {
	const storedValue = readLocalStorageItem(key);
	if (!storedValue) {
		return undefined;
	}
	const parsedValue = Number(storedValue);
	if (!Number.isFinite(parsedValue)) {
		return undefined;
	}
	return normalize ? normalize(parsedValue) : parsedValue;
}

export function writePersistedResizeNumber({
	key,
	value,
	normalize,
}: {
	key: LocalStorageKey;
	value: number;
	normalize?: (value: number) => number;
}): number {
	const normalizedValue = normalize ? normalize(value) : value;
	writeLocalStorageItem(key, String(normalizedValue));
	return normalizedValue;
}
