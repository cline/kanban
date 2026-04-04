/**
 * Integration tests for the ConnectionStore / ConnectionManager wiring
 * in the desktop app startup path (TODO 1 + TODO 2).
 *
 * These tests exercise the ConnectionManager in isolation using mock
 * implementations of BrowserWindow, RuntimeChildManager, and Electron APIs.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock Electron modules
// ---------------------------------------------------------------------------

vi.mock("electron", () => ({
	BrowserWindow: vi.fn(),
	Menu: {
		buildFromTemplate: vi.fn(),
		setApplicationMenu: vi.fn(),
		getApplicationMenu: vi.fn(() => null),
	},
	dialog: {
		showMessageBox: vi.fn(async () => ({ response: 0 })),
		showErrorBox: vi.fn(),
	},
	app: { name: "Kanban", isPackaged: false },
	ipcMain: { on: vi.fn(), removeListener: vi.fn() },
	safeStorage: {
		isEncryptionAvailable: vi.fn(() => false),
		encryptString: vi.fn((s: string) => Buffer.from(s)),
		decryptString: vi.fn((b: Buffer) => b.toString()),
	},
	powerMonitor: { on: vi.fn() },
	powerSaveBlocker: { start: vi.fn(() => 1), stop: vi.fn() },
	shell: { openExternal: vi.fn() },
}));

import { ConnectionStore } from "../src/connection-store.js";
import { ConnectionManager } from "../src/connection-manager.js";
import type { RuntimeChildManager } from "../src/runtime-child.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockWindow() {
	return {
		loadURL: vi.fn(async () => {}),
		webContents: {
			session: {
				webRequest: { onBeforeSendHeaders: vi.fn() },
				cookies: {
					set: vi.fn().mockResolvedValue(undefined),
					remove: vi.fn().mockResolvedValue(undefined),
				},
			},
		},
	};
}

function createMockChildManager(opts?: {
	startUrl?: string;
	startShouldFail?: boolean;
}): RuntimeChildManager {
	const url = opts?.startUrl ?? "http://127.0.0.1:54321";
	const fail = opts?.startShouldFail ?? false;
	return {
		start: vi.fn(async () => { if (fail) throw new Error("fail"); return url; }),
		shutdown: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		running: false,
		send: vi.fn(),
		on: vi.fn(),
		off: vi.fn(),
		removeAllListeners: vi.fn(),
	} as unknown as RuntimeChildManager;
}

type BW = import("electron").BrowserWindow;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ConnectionManager integration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-cm-test-"));
		vi.clearAllMocks();
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("starts local runtime when no saved remote exists (default path)", async () => {
		const store = new ConnectionStore(tmpDir);
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store });
		await mgr.initialize();
		expect(child.start).toHaveBeenCalledOnce();
		expect(win.loadURL).toHaveBeenCalledWith("http://127.0.0.1:54321");
		expect(store.getActiveConnectionId()).toBe("local");
	});

	it("uses active connection selection rather than always booting local", async () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({ label: "Remote", serverUrl: "https://r.example.com", authToken: "t" });
		store.setActiveConnection(conn.id);
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store });
		await mgr.initialize();
		expect(child.start).not.toHaveBeenCalled();
		expect(win.loadURL).toHaveBeenCalledWith("https://r.example.com");
	});

	it("switches to a saved remote and loads its URL", async () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({ label: "Remote", serverUrl: "https://kanban.io" });
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store });
		await mgr.initialize();
		await mgr.switchTo(conn.id);
		expect(win.loadURL).toHaveBeenCalledWith("https://kanban.io");
		expect(store.getActiveConnectionId()).toBe(conn.id);
	});

	it("shutdown delegates through the connection manager", async () => {
		const store = new ConnectionStore(tmpDir);
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store });
		await mgr.initialize();
		expect(mgr.isChildRunning()).toBe(true);
		await mgr.shutdown();
		expect(child.shutdown).toHaveBeenCalledOnce();
		expect(mgr.isChildRunning()).toBe(false);
	});

	it("honors a non-local active connection persisted in the store", async () => {
		const s1 = new ConnectionStore(tmpDir);
		const conn = s1.addConnection({ label: "Prod", serverUrl: "https://prod.io" });
		s1.setActiveConnection(conn.id);
		const s2 = new ConnectionStore(tmpDir);
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store: s2 });
		await mgr.initialize();
		expect(child.start).not.toHaveBeenCalled();
		expect(win.loadURL).toHaveBeenCalledWith("https://prod.io");
	});

	it("falls back safely when stale active ID is in the persisted store", async () => {
		const fp = path.join(tmpDir, "connections.json");
		fs.writeFileSync(fp, JSON.stringify({
			connections: [{ id: "local", label: "Local", serverUrl: "" }],
			activeConnectionId: "deleted-remote",
		}));
		const store = new ConnectionStore(tmpDir);
		expect(store.getActiveConnection().id).toBe("local");
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store });
		await mgr.initialize();
		expect(child.start).toHaveBeenCalledOnce();
		expect(win.loadURL).toHaveBeenCalledWith("http://127.0.0.1:54321");
	});

	it("falls back to local when remote fails during initialize", async () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({ label: "Broken", serverUrl: "https://broken.io" });
		store.setActiveConnection(conn.id);
		const win = createMockWindow();
		win.loadURL.mockImplementation(async (...args: unknown[]) => {
			if (args[0] === "https://broken.io") throw new Error("ERR_CONNECTION_REFUSED");
		});
		const child = createMockChildManager();
		const onChange = vi.fn();
		const mgr = new ConnectionManager({
			window: win as unknown as BW, childManager: child, store, onConnectionChanged: onChange,
		});
		await mgr.initialize();
		expect(store.getActiveConnectionId()).toBe("local");
		expect(child.start).toHaveBeenCalledOnce();
		expect(onChange).toHaveBeenCalled();
	});

	it("updates persisted active connection state on switch", async () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({ label: "R", serverUrl: "https://r.io" });
		const win = createMockWindow();
		const child = createMockChildManager();
		const mgr = new ConnectionManager({ window: win as unknown as BW, childManager: child, store });
		await mgr.initialize();
		expect(store.getActiveConnectionId()).toBe("local");
		await mgr.switchTo(conn.id);
		expect(store.getActiveConnectionId()).toBe(conn.id);
		const s2 = new ConnectionStore(tmpDir);
		expect(s2.getActiveConnectionId()).toBe(conn.id);
	});

	it("re-initializes after shutdown (resume/restart)", async () => {
		const store = new ConnectionStore(tmpDir);
		const win = createMockWindow();
		const child = createMockChildManager();
		const onReady = vi.fn();
		const mgr = new ConnectionManager({
			window: win as unknown as BW, childManager: child, store, onLocalRuntimeReady: onReady,
		});
		await mgr.initialize();
		expect(child.start).toHaveBeenCalledOnce();
		expect(onReady).toHaveBeenCalledOnce();
		await mgr.shutdown();
		await mgr.initialize();
		expect(child.start).toHaveBeenCalledTimes(2);
		expect(onReady).toHaveBeenCalledTimes(2);
	});

	it("fires onLocalRuntimeReady on local startup", async () => {
		const store = new ConnectionStore(tmpDir);
		const win = createMockWindow();
		const child = createMockChildManager({ startUrl: "http://127.0.0.1:9999" });
		const onReady = vi.fn();
		const mgr = new ConnectionManager({
			window: win as unknown as BW, childManager: child, store, onLocalRuntimeReady: onReady,
		});
		await mgr.initialize();
		expect(onReady).toHaveBeenCalledWith("http://127.0.0.1:9999", expect.any(String));
	});

	it("fires onLocalRuntimeStopped when switching from local to remote", async () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({ label: "R", serverUrl: "https://r.io" });
		const win = createMockWindow();
		const child = createMockChildManager();
		const onStopped = vi.fn();
		const mgr = new ConnectionManager({
			window: win as unknown as BW, childManager: child, store, onLocalRuntimeStopped: onStopped,
		});
		await mgr.initialize();
		expect(onStopped).not.toHaveBeenCalled();
		await mgr.switchTo(conn.id);
		expect(onStopped).toHaveBeenCalledOnce();
	});

	it("fires onLocalRuntimeStopped on shutdown", async () => {
		const store = new ConnectionStore(tmpDir);
		const win = createMockWindow();
		const child = createMockChildManager();
		const onStopped = vi.fn();
		const mgr = new ConnectionManager({
			window: win as unknown as BW, childManager: child, store, onLocalRuntimeStopped: onStopped,
		});
		await mgr.initialize();
		await mgr.shutdown();
		expect(onStopped).toHaveBeenCalledOnce();
	});

	it("invokes onConnectionChanged on switch", async () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({ label: "R", serverUrl: "https://r.io" });
		const win = createMockWindow();
		const child = createMockChildManager();
		const onChange = vi.fn();
		const mgr = new ConnectionManager({
			window: win as unknown as BW, childManager: child, store, onConnectionChanged: onChange,
		});
		await mgr.initialize();
		expect(onChange).not.toHaveBeenCalled();
		await mgr.switchTo(conn.id);
		expect(onChange).toHaveBeenCalledOnce();
		await mgr.switchTo("local");
		expect(onChange).toHaveBeenCalledTimes(2);
	});
});
