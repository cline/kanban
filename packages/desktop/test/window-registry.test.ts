import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => {
	class MockBrowserWindow {
		static instances: MockBrowserWindow[] = [];
		static nextId = 1;

		static getFocusedWindow(): MockBrowserWindow | null {
			return null;
		}

		static resetMock(): void {
			MockBrowserWindow.instances = [];
			MockBrowserWindow.nextId = 1;
		}

		id: number;
		private readonly _listeners = new Map<string, Array<(...args: unknown[]) => void>>();
		private _destroyed = false;
		private _visible = true;
		// Driven directly by tests — represents what Electron would return
		// from `webContents.getURL()` in the real app. Starts empty because
		// a freshly-created BrowserWindow has not yet loaded a document.
		private _currentUrl = "";

		// Record listeners so simulate* helpers can invoke them later. A
		// plain `vi.fn()` would accept the registration but leave us no
		// way to trigger the callback in assertions.
		private readonly _webContentsListeners = new Map<
			string,
			Array<(...args: unknown[]) => void>
		>();

		webContents = {
			on: (event: string, handler: (...args: unknown[]) => void): void => {
				const handlers = this._webContentsListeners.get(event) ?? [];
				handlers.push(handler);
				this._webContentsListeners.set(event, handlers);
			},
			setWindowOpenHandler: vi.fn(),
			getURL: (): string => this._currentUrl,
		};

		constructor() {
			this.id = MockBrowserWindow.nextId++;
			MockBrowserWindow.instances.push(this);
		}

		/** Test helper — mirror what `loadURL()` would do in the real app. */
		_setCurrentUrl(url: string): void {
			this._currentUrl = url;
		}

		/**
		 * Fire the `will-navigate` handlers that production code registered
		 * via `window.webContents.on("will-navigate", …)`.
		 * Returns whether the synthetic event was prevented.
		 */
		simulateWillNavigate(url: string): boolean {
			const event = {
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				},
			};
			for (const handler of this._webContentsListeners.get("will-navigate") ?? []) {
				handler(event, url);
			}
			return event.defaultPrevented;
		}

		on(event: string, handler: (...args: unknown[]) => void): void {
			const handlers = this._listeners.get(event) ?? [];
			handlers.push(handler);
			this._listeners.set(event, handlers);
		}

		once(event: string, handler: (...args: unknown[]) => void): void {
			this.on(event, handler);
		}

		simulateClose(): boolean {
			const event = {
				defaultPrevented: false,
				preventDefault() {
					this.defaultPrevented = true;
				},
			};
			for (const handler of this._listeners.get("close") ?? []) {
				handler(event);
			}
			if (!event.defaultPrevented) {
				this._destroyed = true;
				this._visible = false;
				for (const handler of this._listeners.get("closed") ?? []) {
					handler();
				}
			}
			return event.defaultPrevented;
		}

		hide(): void {
			this._visible = false;
		}

		show(): void {
			this._visible = true;
		}

		isVisible(): boolean {
			return this._visible;
		}

		isDestroyed(): boolean {
			return this._destroyed;
		}

		maximize(): void {}
		isMaximized(): boolean {
			return false;
		}
		getTitle(): string {
			return "Kanban";
		}
		getBounds(): { x: number; y: number; width: number; height: number } {
			return { x: 0, y: 0, width: 1400, height: 900 };
		}
		getNormalBounds(): { x: number; y: number; width: number; height: number } {
			return this.getBounds();
		}
		isMinimized(): boolean {
			return false;
		}
		restore(): void {}
		focus(): void {}
		setTitle(): void {}
	}

	const screenMock = {
		_displays: [
			{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } },
		] as Array<{ workArea: { x: number; y: number; width: number; height: number } }>,
		getAllDisplays() {
			return screenMock._displays;
		},
		_setDisplays(
			displays: Array<{ workArea: { x: number; y: number; width: number; height: number } }>,
		): void {
			screenMock._displays = displays;
		},
	};

	return {
		BrowserWindow: MockBrowserWindow,
		shell: { openExternal: vi.fn() },
		screen: screenMock,
	};
});


import { BrowserWindow } from "electron";
import { WindowRegistry } from "../src/window-registry.js";

interface MockWindow {
	simulateClose(): boolean;
	hide(): void;
	show(): void;
	isVisible(): boolean;
	isDestroyed(): boolean;
	_setCurrentUrl(url: string): void;
	simulateWillNavigate(url: string): boolean;
}

const DEFAULT_OPTIONS = {
	preloadPath: "/tmp/preload.js",
	isPackaged: false,
};

beforeEach(() => {
	const Mock = BrowserWindow as unknown as { resetMock(): void };
	Mock.resetMock();
});

function withDarwin<T>(fn: () => T): T {
	const original = process.platform;
	Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
	try {
		return fn();
	} finally {
		Object.defineProperty(process, "platform", { value: original, configurable: true });
	}
}

describe("WindowRegistry.buildWindowUrl", () => {
	it("returns base URL unchanged when projectId is null", () => {
		expect(WindowRegistry.buildWindowUrl("http://localhost:52341", null)).toBe(
			"http://localhost:52341",
		);
	});

	it("encodes projectId as the URL pathname", () => {
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341", "project-abc");
		expect(url).toBe("http://localhost:52341/project-abc");
	});

	it("overwrites any existing path in the base URL", () => {
		// The path is the project; any pre-existing path on the base URL
		// is irrelevant and gets replaced.
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341/some/path", "proj-1");
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/proj-1");
	});

	it("preserves existing query parameters", () => {
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341/?token=abc", "proj-2");
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/proj-2");
		expect(parsed.searchParams.get("token")).toBe("abc");
	});

	it("URL-encodes projectIds containing slashes or whitespace", () => {
		// Matches the web-ui's buildProjectPathname encoding so that
		// parseProjectIdFromPathname round-trips the value back via
		// decodeURIComponent on the first path segment.
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341", "/Users/john/my project");
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/%2FUsers%2Fjohn%2Fmy%20project");
		expect(decodeURIComponent(parsed.pathname.slice(1))).toBe("/Users/john/my project");
	});

	it("returns base URL unchanged when projectId is empty string", () => {
		expect(WindowRegistry.buildWindowUrl("http://localhost:52341", "")).toBe(
			"http://localhost:52341",
		);
	});
});

describe("WindowRegistry.loadPersistedWindows", () => {
	it("returns empty array for non-existent directory", () => {
		const states = WindowRegistry.loadPersistedWindows("/tmp/non-existent-dir-" + Date.now());
		expect(states).toEqual([]);
	});
});

describe("WindowRegistry macOS close behavior", () => {
	const macOptions = { ...DEFAULT_OPTIONS, hideOnCloseForMac: true, isQuitting: () => false };

	it("hides the last visible window on macOS close", () => {
		withDarwin(() => {
			const registry = new WindowRegistry();
			const window = registry.createWindow({ ...macOptions, projectId: null });
			const prevented = (window as unknown as MockWindow).simulateClose();
			expect(prevented).toBe(true);
			expect(registry.size).toBe(1);
		});
	});

	it("destroys a non-last window on macOS close", () => {
		withDarwin(() => {
			const registry = new WindowRegistry();
			registry.createWindow({ ...macOptions, projectId: null });
			const win2 = registry.createWindow({ ...macOptions, projectId: "project-abc" });
			expect(registry.size).toBe(2);
			const prevented = (win2 as unknown as MockWindow).simulateClose();
			expect(prevented).toBe(false);
			expect(registry.size).toBe(1);
			expect((win2 as unknown as MockWindow).isDestroyed()).toBe(true);
		});
	});

	it("hides the last window even if it is a project window", () => {
		withDarwin(() => {
			const registry = new WindowRegistry();
			const window = registry.createWindow({ ...macOptions, projectId: "project-abc" });
			const prevented = (window as unknown as MockWindow).simulateClose();
			expect(prevented).toBe(true);
			expect(registry.size).toBe(1);
		});
	});

	it("always closes when quitting", () => {
		withDarwin(() => {
			const registry = new WindowRegistry();
			const window = registry.createWindow({
				...macOptions,
				projectId: null,
				isQuitting: () => true,
			});
			const prevented = (window as unknown as MockWindow).simulateClose();
			expect(prevented).toBe(false);
			expect(registry.size).toBe(0);
		});
	});
});

describe("WindowRegistry visibility helpers", () => {
	it("getVisible() excludes hidden windows", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: null });
		registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-a" });
		(win1 as unknown as MockWindow).hide();
		const visible = registry.getVisible();
		expect(visible.length).toBe(1);
		expect(visible[0].projectId).toBe("project-a");
	});

	it("countVisibleWindows() returns correct count", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: null });
		registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-a" });
		registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-b" });
		expect(registry.countVisibleWindows()).toBe(3);
		(win1 as unknown as MockWindow).hide();
		expect(registry.countVisibleWindows()).toBe(2);
	});
});

describe("WindowRegistry will-navigate origin guard", () => {
	// The will-navigate handler is the last-line security defence against
	// a compromised renderer escaping the runtime origin. The guard derives
	// the trusted origin from `webContents.getURL()` at event time (not
	// from a value captured at window creation) so that startup windows —
	// which have no URL until after loadURL() resolves — still enforce the
	// correct origin once loading completes.

	const RUNTIME_ORIGIN = "http://localhost:52341";

	function makeLoadedWindow(currentUrl: string) {
		const registry = new WindowRegistry();
		const window = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: null });
		(window as unknown as MockWindow)._setCurrentUrl(currentUrl);
		return window as unknown as MockWindow;
	}

	it("allows same-origin navigation", () => {
		const window = makeLoadedWindow(`${RUNTIME_ORIGIN}/project-a`);
		const prevented = window.simulateWillNavigate(`${RUNTIME_ORIGIN}/project-b/task-1`);
		expect(prevented).toBe(false);
	});

	it("allows same-origin navigation when only the path/query differs", () => {
		const window = makeLoadedWindow(`${RUNTIME_ORIGIN}/project-a`);
		const prevented = window.simulateWillNavigate(
			`${RUNTIME_ORIGIN}/project-a?foo=bar#section`,
		);
		expect(prevented).toBe(false);
	});

	it("blocks cross-origin HTTP navigation", () => {
		const window = makeLoadedWindow(`${RUNTIME_ORIGIN}/project-a`);
		const prevented = window.simulateWillNavigate("http://evil.example.com/pwn");
		expect(prevented).toBe(true);
	});

	it("blocks cross-origin navigation even to the same host on a different port", () => {
		// Origin is scheme + host + port, so 52341 vs 3000 must be treated
		// as different origins — a port-scan pivot from a compromised
		// renderer would otherwise be allowed.
		const window = makeLoadedWindow(`${RUNTIME_ORIGIN}/project-a`);
		const prevented = window.simulateWillNavigate("http://localhost:3000/");
		expect(prevented).toBe(true);
	});

	it("blocks navigation to non-http schemes", () => {
		const window = makeLoadedWindow(`${RUNTIME_ORIGIN}/project-a`);
		for (const url of [
			"file:///etc/passwd",
			"javascript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
		]) {
			expect(window.simulateWillNavigate(url)).toBe(true);
		}
	});

	it("blocks navigation when the target URL is malformed", () => {
		const window = makeLoadedWindow(`${RUNTIME_ORIGIN}/project-a`);
		const prevented = window.simulateWillNavigate("not a url :::");
		expect(prevented).toBe(true);
	});

	it("is a no-op while the window has not yet loaded a URL", () => {
		// Startup windows construct before the runtime URL is known; the
		// disconnected screen is loaded via loadFile in that case. Guarding
		// before the first load would either stall the initial navigation
		// or force us to bake in an assumed trusted origin, both of which
		// are worse than trusting Electron's internal flow for the first
		// load. Production code relies on this behaviour — lock it in.
		const registry = new WindowRegistry();
		const window = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: null });
		const prevented = (window as unknown as MockWindow).simulateWillNavigate(
			"http://evil.example.com/",
		);
		expect(prevented).toBe(false);
	});

	it("picks up the new trusted origin after the URL changes (e.g. restart)", () => {
		// Restarting the runtime can move it to a different ephemeral port;
		// the guard must reflect the window's _current_ URL, not the origin
		// it had at creation time.
		const window = makeLoadedWindow("http://localhost:52341/project-a");
		expect(window.simulateWillNavigate("http://localhost:52341/other")).toBe(false);
		window._setCurrentUrl("http://localhost:40000/project-a");
		expect(window.simulateWillNavigate("http://localhost:40000/other")).toBe(false);
		expect(window.simulateWillNavigate("http://localhost:52341/other")).toBe(true);
	});
});

describe("WindowRegistry multi-window creation", () => {
	it("allows duplicate project windows (same projectId)", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-a" });
		const win2 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-a" });
		expect(win1.id).not.toBe(win2.id);
		expect(registry.size).toBe(2);
	});

	it("allows multiple overview windows (projectId null)", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: null });
		const win2 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: null });
		expect(win1.id).not.toBe(win2.id);
		expect(registry.size).toBe(2);
	});

	it("allows different project windows", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-a" });
		const win2 = registry.createWindow({ ...DEFAULT_OPTIONS, projectId: "project-b" });
		expect(win1.id).not.toBe(win2.id);
		expect(registry.size).toBe(2);
	});
});
