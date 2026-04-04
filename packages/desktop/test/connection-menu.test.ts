import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Mock the electron module before importing modules that depend on it.
vi.mock("electron", () => ({
	Menu: {
		buildFromTemplate: vi.fn(),
		setApplicationMenu: vi.fn(),
		getApplicationMenu: vi.fn(() => null),
	},
	BrowserWindow: vi.fn(),
	dialog: {
		showMessageBox: vi.fn(),
	},
	ipcMain: {
		on: vi.fn(),
		removeListener: vi.fn(),
	},
	safeStorage: {
		isEncryptionAvailable: vi.fn(() => false),
		encryptString: vi.fn((s: string) => Buffer.from(s)),
		decryptString: vi.fn((b: Buffer) => b.toString()),
	},
}));

import { ConnectionStore } from "../src/connection-store.js";
import { buildConnectionMenuTemplate } from "../src/connection-menu.js";
import type { ConnectionManager } from "../src/connection-manager.js";

/** Minimal mock for ConnectionManager. */
function mockManager(): ConnectionManager {
	return {
		switchTo: vi.fn(async () => {}),
		initialize: async () => {},
		shutdown: async () => {},
		isChildRunning: () => false,
		getLocalUrl: () => "",
	} as unknown as ConnectionManager;
}

/** Minimal mock for BrowserWindow. */
function mockWindow(): any {
	return {};
}

describe("buildConnectionMenuTemplate", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-menu-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("returns a menu with label 'Connection'", () => {
		const store = new ConnectionStore(tmpDir);
		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});
		expect(menu.label).toBe("Connection");
	});

	it("includes the local connection as a radio item", () => {
		const store = new ConnectionStore(tmpDir);
		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const localItem = submenu.find((item: any) => item.label === "Local");
		expect(localItem).toBeDefined();
		expect(localItem!.type).toBe("radio");
		expect(localItem!.checked).toBe(true);
	});

	it("includes remote connections as radio items", () => {
		const store = new ConnectionStore(tmpDir);
		store.addConnection({ label: "Remote 1", serverUrl: "https://r1.com" });
		store.addConnection({ label: "Remote 2", serverUrl: "https://r2.com" });

		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const labels = submenu.map((item: any) => item.label).filter(Boolean);
		expect(labels).toContain("Remote 1");
		expect(labels).toContain("Remote 2");
	});

	it("checks the active connection", () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({
			label: "Active Remote",
			serverUrl: "https://active.com",
		});
		store.setActiveConnection(conn.id);

		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const localItem = submenu.find((item: any) => item.label === "Local");
		const remoteItem = submenu.find(
			(item: any) => item.label === "Active Remote",
		);
		expect(localItem!.checked).toBe(false);
		expect(remoteItem!.checked).toBe(true);
	});

	it("includes 'Add Remote Connection…' item", () => {
		const store = new ConnectionStore(tmpDir);
		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const addItem = submenu.find(
			(item: any) => item.label === "Add Remote Connection\u2026",
		);
		expect(addItem).toBeDefined();
		expect(addItem!.click).toBeTypeOf("function");
	});

	it("includes 'Remove' item when a remote connection is active", () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({
			label: "My Remote",
			serverUrl: "https://my.com",
		});
		store.setActiveConnection(conn.id);

		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const removeItem = submenu.find(
			(item: any) => item.label === 'Remove "My Remote"',
		);
		expect(removeItem).toBeDefined();
	});

	it("does not include 'Remove' when local is active", () => {
		const store = new ConnectionStore(tmpDir);
		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const removeItems = submenu.filter(
			(item: any) => item.label && item.label.startsWith("Remove"),
		);
		expect(removeItems).toHaveLength(0);
	});

	it("does not include 'Remove' when WSL is active", () => {
		const store = new ConnectionStore(tmpDir);
		store.enableWslConnection();
		store.setActiveConnection("wsl");

		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const removeItems = submenu.filter(
			(item: any) => item.label && item.label.startsWith("Remove"),
		);
		expect(removeItems).toHaveLength(0);
	});

	it("includes WSL connection as a radio item when enabled", () => {
		const store = new ConnectionStore(tmpDir);
		store.enableWslConnection();

		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const wslItem = submenu.find((item: any) => item.label === "WSL");
		expect(wslItem).toBeDefined();
		expect(wslItem!.type).toBe("radio");
	});

	it("has a separator between connections and action items", () => {
		const store = new ConnectionStore(tmpDir);
		const menu = buildConnectionMenuTemplate({
			store,
			manager: mockManager(),
			window: mockWindow(),
		});

		const submenu = menu.submenu as any[];
		const separators = submenu.filter((item: any) => item.type === "separator");
		expect(separators.length).toBeGreaterThanOrEqual(1);
	});
});
