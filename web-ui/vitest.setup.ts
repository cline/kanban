// Node.js v22+ adds a built-in localStorage to globalThis that lacks
// Web Storage API methods when --localstorage-file is not provided.
// This conflicts with jsdom's proper implementation because vitest's
// populateGlobal() skips keys that already exist on globalThis.
// Replace the broken stub with a spec-compliant in-memory Storage mock.
if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.clear !== "function") {
	const store = new Map<string, string>();
	const storage: Storage = {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, String(value));
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
		get length() {
			return store.size;
		},
		key: (index: number) => [...store.keys()][index] ?? null,
	};
	Object.defineProperty(globalThis, "localStorage", {
		value: storage,
		writable: true,
		configurable: true,
	});
}

class MockIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null = null;
	readonly rootMargin = "";
	readonly thresholds = [0];

	disconnect(): void {}

	observe(_target: Element): void {}

	takeRecords(): IntersectionObserverEntry[] {
		return [];
	}

	unobserve(_target: Element): void {}
}

Object.defineProperty(globalThis, "IntersectionObserver", {
	writable: true,
	configurable: true,
	value: MockIntersectionObserver,
});
