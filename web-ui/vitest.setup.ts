import { beforeEach } from "vitest";

function isUsableStorage(storage: unknown): storage is Storage {
	return (
		typeof storage === "object" &&
		storage !== null &&
		typeof storage.clear === "function" &&
		typeof storage.getItem === "function" &&
		typeof storage.key === "function" &&
		typeof storage.removeItem === "function" &&
		typeof storage.setItem === "function"
	);
}

function createMemoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear() {
			entries.clear();
		},
		getItem(key: string) {
			return entries.get(String(key)) ?? null;
		},
		key(index: number) {
			return [...entries.keys()][index] ?? null;
		},
		removeItem(key: string) {
			entries.delete(String(key));
		},
		setItem(key: string, value: string) {
			entries.set(String(key), String(value));
		},
	};
}

function ensureStorage(kind: "localStorage" | "sessionStorage"): void {
	if (typeof window === "undefined") {
		return;
	}
	let storage: unknown;
	try {
		storage = window[kind];
	} catch {
		storage = null;
	}
	if (isUsableStorage(storage)) {
		return;
	}
	const nextStorage = createMemoryStorage();
	Object.defineProperty(window, kind, {
		configurable: true,
		value: nextStorage,
	});
	Object.defineProperty(globalThis, kind, {
		configurable: true,
		value: nextStorage,
	});
}

beforeEach(() => {
	ensureStorage("localStorage");
	ensureStorage("sessionStorage");
	window.localStorage.clear();
	window.sessionStorage.clear();
});
