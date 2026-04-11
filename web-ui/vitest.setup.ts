// Node.js v22+ adds a built-in localStorage to globalThis that lacks
// Web Storage API methods when --localstorage-file is not provided.
// This conflicts with jsdom's proper implementation because vitest's
// populateGlobal() skips keys that already exist on globalThis.
// Replace the broken stub with a spec-compliant in-memory Storage mock.
const hasWorkingLocalStorage = (): boolean => {
	try {
		const storage = globalThis.localStorage as Partial<Storage> | undefined;
		return Boolean(
			storage &&
				typeof storage.getItem === "function" &&
				typeof storage.setItem === "function" &&
				typeof storage.removeItem === "function" &&
				typeof storage.clear === "function" &&
				typeof storage.key === "function",
		);
	} catch {
		return false;
	}
};

if (!hasWorkingLocalStorage()) {
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

// jsdom does not implement window.matchMedia. Provide a minimal stub so that
// hooks like useIsMobile and react-use's useMedia work during tests.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
	Object.defineProperty(window, "matchMedia", {
		writable: true,
		configurable: true,
		value: (query: string): MediaQueryList => ({
			matches: false,
			media: query,
			onchange: null,
			addListener: () => {},
			removeListener: () => {},
			addEventListener: () => {},
			removeEventListener: () => {},
			dispatchEvent: () => false,
		}),
	});
}
