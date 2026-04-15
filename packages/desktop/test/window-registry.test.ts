import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Electron — vi.mock factory is hoisted, so the class must be defined
// inline within the factory. We retrieve the class after import for test use.
// ---------------------------------------------------------------------------

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

		webContents = {
			on: vi.fn(),
			setWindowOpenHandler: vi.fn(),
			session: {
				storagePath: "default",
				webRequest: { onBeforeSendHeaders: vi.fn() },
				cookies: {
					set: vi.fn().mockResolvedValue(undefined),
					remove: vi.fn().mockResolvedValue(undefined),
				},
			},
		};

		constructor() {
			this.id = MockBrowserWindow.nextId++;
			MockBrowserWindow.instances.push(this);
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

	return {
		BrowserWindow: MockBrowserWindow,
		shell: { openExternal: vi.fn() },
	};
});

import { BrowserWindow } from "electron";
import { WindowRegistry } from "../src/window-registry.js";

// Type helper to access simulateClose on the mock
interface MockWindow {
	simulateClose(): boolean;
	hide(): void;
	show(): void;
	isVisible(): boolean;
	isDestroyed(): boolean;
}

beforeEach(() => {
	// Reset mock state between tests
	const Mock = BrowserWindow as unknown as { resetMock(): void };
	Mock.resetMock();
});

// ---------------------------------------------------------------------------
// WindowRegistry.buildWindowUrl — pure function, no Electron needed
// ---------------------------------------------------------------------------

describe("WindowRegistry.buildWindowUrl", () => {
	it("returns base URL unchanged when projectId is null", () => {
		expect(WindowRegistry.buildWindowUrl("http://localhost:52341", null)).toBe(
			"http://localhost:52341",
		);
	});

	it("appends projectId as a query parameter", () => {
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341", "project-abc");
		expect(url).toBe("http://localhost:52341/?projectId=project-abc");
	});

	it("preserves existing path in the base URL", () => {
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341/some/path", "proj-1");
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/some/path");
		expect(parsed.searchParams.get("projectId")).toBe("proj-1");
	});

	it("preserves existing query parameters", () => {
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341/?token=abc", "proj-2");
		const parsed = new URL(url);
		expect(parsed.searchParams.get("token")).toBe("abc");
		expect(parsed.searchParams.get("projectId")).toBe("proj-2");
	});

	it("handles projectId with special characters", () => {
		const url = WindowRegistry.buildWindowUrl("http://localhost:52341", "/Users/john/my project");
		const parsed = new URL(url);
		expect(parsed.searchParams.get("projectId")).toBe("/Users/john/my project");
	});

	it("returns base URL unchanged when projectId is empty string (falsy)", () => {
		expect(WindowRegistry.buildWindowUrl("http://localhost:52341", "")).toBe(
			"http://localhost:52341",
		);
	});
});

// ---------------------------------------------------------------------------
// WindowRegistry.loadPersistedWindows
// ---------------------------------------------------------------------------

describe("WindowRegistry.loadPersistedWindows", () => {
	it("returns empty array for non-existent directory", () => {
		const states = WindowRegistry.loadPersistedWindows("/tmp/non-existent-dir-" + Date.now());
		expect(states).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// macOS close behavior — zombie window prevention
// ---------------------------------------------------------------------------

describe("WindowRegistry macOS close behavior", () => {
	const defaultOptions = {
		preloadPath: "/tmp/preload.js",
		isPackaged: false,
		hideOnCloseForMac: true,
		isQuitting: () => false,
	};

	it("hides the last visible window on macOS close (keeps app alive)", () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

		try {
			const registry = new WindowRegistry();
			const window = registry.createWindow({ ...defaultOptions, projectId: null });

			const prevented = (window as unknown as MockWindow).simulateClose();

			expect(prevented).toBe(true);
			expect(registry.size).toBe(1);
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		}
	});

	it("destroys a window on macOS close when other visible windows exist", () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

		try {
			const registry = new WindowRegistry();
			registry.createWindow({ ...defaultOptions, projectId: null });
			const win2 = registry.createWindow({ ...defaultOptions, projectId: "project-abc" });

			expect(registry.size).toBe(2);

			// Close win2 — not the last window, so it should be destroyed
			const prevented = (win2 as unknown as MockWindow).simulateClose();

			expect(prevented).toBe(false);
			expect(registry.size).toBe(1); // removed from registry
			expect((win2 as unknown as MockWindow).isDestroyed()).toBe(true);
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		}
	});

	it("hides the last window even if it is a project window", () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

		try {
			const registry = new WindowRegistry();
			const window = registry.createWindow({ ...defaultOptions, projectId: "project-abc" });

			const prevented = (window as unknown as MockWindow).simulateClose();

			expect(prevented).toBe(true);
			expect(registry.size).toBe(1);
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		}
	});

	it("always closes when quitting", () => {
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

		try {
			const registry = new WindowRegistry();
			const window = registry.createWindow({
				...defaultOptions,
				projectId: null,
				isQuitting: () => true,
			});

			const prevented = (window as unknown as MockWindow).simulateClose();

			expect(prevented).toBe(false);
			expect(registry.size).toBe(0);
		} finally {
			Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
		}
	});
});

// ---------------------------------------------------------------------------
// getVisible() and countVisibleWindows()
// ---------------------------------------------------------------------------

describe("WindowRegistry visibility helpers", () => {
	const defaultOptions = {
		preloadPath: "/tmp/preload.js",
		isPackaged: false,
	};

	it("getVisible() excludes hidden windows", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...defaultOptions, projectId: null });
		registry.createWindow({ ...defaultOptions, projectId: "project-a" });

		(win1 as unknown as MockWindow).hide();

		const visible = registry.getVisible();
		expect(visible.length).toBe(1);
		expect(visible[0].projectId).toBe("project-a");
	});

	it("countVisibleWindows() returns correct count", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...defaultOptions, projectId: null });
		registry.createWindow({ ...defaultOptions, projectId: "project-a" });
		registry.createWindow({ ...defaultOptions, projectId: "project-b" });

		expect(registry.countVisibleWindows()).toBe(3);

		(win1 as unknown as MockWindow).hide();
		expect(registry.countVisibleWindows()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Duplicate prevention — project windows dedup, overview windows do NOT
// ---------------------------------------------------------------------------

describe("WindowRegistry duplicate prevention", () => {
	const defaultOptions = {
		preloadPath: "/tmp/preload.js",
		isPackaged: false,
	};

	it("allows duplicate project windows (same projectId)", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...defaultOptions, projectId: "project-a" });
		const win2 = registry.createWindow({ ...defaultOptions, projectId: "project-a" });

		expect(win1.id).not.toBe(win2.id);
		expect(registry.size).toBe(2);
		const Mock = BrowserWindow as unknown as { instances: unknown[] };
		expect(Mock.instances.length).toBe(2);
	});

	it("allows multiple overview windows (projectId null) for New Window", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...defaultOptions, projectId: null });
		const win2 = registry.createWindow({ ...defaultOptions, projectId: null });

		expect(win1.id).not.toBe(win2.id);
		expect(registry.size).toBe(2);
		// Verify two real BrowserWindows were constructed.
		const Mock = BrowserWindow as unknown as { instances: unknown[] };
		expect(Mock.instances.length).toBe(2);
	});

	it("allows different project windows", () => {
		const registry = new WindowRegistry();
		const win1 = registry.createWindow({ ...defaultOptions, projectId: "project-a" });
		const win2 = registry.createWindow({ ...defaultOptions, projectId: "project-b" });

		expect(win1.id).not.toBe(win2.id);
		expect(registry.size).toBe(2);
		// Verify two real BrowserWindows were constructed.
		const Mock = BrowserWindow as unknown as { instances: unknown[] };
		expect(Mock.instances.length).toBe(2);
	});

});
