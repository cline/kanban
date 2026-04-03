import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { isInsecureRemoteUrl } from "../src/connection-utils.js";

// ---------------------------------------------------------------------------
// Mock Electron
// ---------------------------------------------------------------------------

const { loadURLMock, showDesktopFailureDialogMock } = vi.hoisted(() => ({
	loadURLMock: vi.fn().mockResolvedValue(undefined),
	showDesktopFailureDialogMock: vi.fn(),
}));

vi.mock("electron", () => ({
	BrowserWindow: vi.fn(),
	dialog: { showMessageBox: vi.fn(), showErrorBox: vi.fn() },
}));
vi.mock("../src/desktop-boot-state.js", () => ({
	recordBootFailure: vi.fn(), advanceBootPhase: vi.fn(),
	resetBootState: vi.fn(), getBootState: vi.fn(),
}));
vi.mock("../src/desktop-failure.js", () => ({
	showDesktopFailureDialog: showDesktopFailureDialogMock,
}));

import { ConnectionManager } from "../src/connection-manager.js";
import type { RuntimeChildManager } from "../src/runtime-child.js";
import type { ConnectionStore, SavedConnection } from "../src/connection-store.js";
import type { BrowserWindow } from "electron";
import type { WslLauncher } from "../src/wsl-launch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeWindow(): BrowserWindow {
	return {
		loadURL: loadURLMock,
		webContents: { session: {
			webRequest: { onBeforeSendHeaders: vi.fn() },
			cookies: { set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
		}},
		isDestroyed: () => false,
	} as unknown as BrowserWindow;
}
function fakeCM(startFn?: ReturnType<typeof vi.fn>): RuntimeChildManager {
	return {
		start: startFn ?? vi.fn().mockResolvedValue("http://127.0.0.1:12345"),
		shutdown: vi.fn().mockResolvedValue(undefined),
		dispose: vi.fn().mockResolvedValue(undefined),
		running: false, send: vi.fn(), on: vi.fn(), off: vi.fn(),
	} as unknown as RuntimeChildManager;
}
function fakeStore(activeId = "local", extra: SavedConnection[] = []): ConnectionStore {
	const all: SavedConnection[] = [{ id: "local", label: "Local", serverUrl: "" }, ...extra];
	return {
		getActiveConnection: () => all.find((c) => c.id === activeId) ?? all[0],
		getActiveConnectionId: () => activeId,
		getConnections: () => all, setActiveConnection: vi.fn(),
	} as unknown as ConnectionStore;
}
function fakeWsl(err: Error): WslLauncher {
	return {
		start: vi.fn().mockRejectedValue(err),
		stop: vi.fn(), running: false, on: vi.fn(), off: vi.fn(),
	} as unknown as WslLauncher;
}

// ---------------------------------------------------------------------------

describe("ConnectionManager", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	describe("isInsecureRemoteUrl", () => {
		it("returns true for http:// with non-localhost host", () => {
			expect(isInsecureRemoteUrl("http://example.com")).toBe(true);
			expect(isInsecureRemoteUrl("http://192.168.1.1:3000")).toBe(true);
			expect(isInsecureRemoteUrl("http://kanban.myserver.io/path")).toBe(true);
		});

		it("returns false for http://localhost", () => {
			expect(isInsecureRemoteUrl("http://localhost")).toBe(false);
			expect(isInsecureRemoteUrl("http://localhost:3000")).toBe(false);
		});

		it("returns false for http://127.0.0.1", () => {
			expect(isInsecureRemoteUrl("http://127.0.0.1")).toBe(false);
			expect(isInsecureRemoteUrl("http://127.0.0.1:8080")).toBe(false);
		});

		it("returns false for http://[::1]", () => {
			expect(isInsecureRemoteUrl("http://[::1]")).toBe(false);
			expect(isInsecureRemoteUrl("http://[::1]:9000")).toBe(false);
		});

		it("returns false for https:// URLs", () => {
			expect(isInsecureRemoteUrl("https://example.com")).toBe(false);
			expect(isInsecureRemoteUrl("https://kanban.myserver.io")).toBe(false);
		});

		it("returns false for invalid URLs", () => {
			expect(isInsecureRemoteUrl("not-a-url")).toBe(false);
			expect(isInsecureRemoteUrl("")).toBe(false);
		});
	});

	// -- no about:blank paths ------------------------------------------------

	describe("no about:blank paths", () => {
		it("local startup failure does NOT load about:blank", async () => {
			const cm = fakeCM(vi.fn().mockRejectedValue(new Error("child start failed")));
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			await expect(manager.initialize()).rejects.toThrow("child start failed");
			for (const call of loadURLMock.mock.calls) {
				expect(call[0]).not.toBe("about:blank");
			}
		});

		it("WSL startup failure does NOT set URL to about:blank", async () => {
			const wsl: SavedConnection = { id: "wsl", label: "WSL", serverUrl: "" };
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore("wsl", [wsl]),
				createWslLauncher: () => fakeWsl(new Error("WSL failed")),
			});
			await manager.initialize();
			for (const call of loadURLMock.mock.calls) {
				expect(call[0]).not.toBe("about:blank");
			}
		});

		it("WSL failure dialog receives canRetry and canFallbackToLocal", async () => {
			const wsl: SavedConnection = { id: "wsl", label: "WSL", serverUrl: "" };
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore("wsl", [wsl]),
				createWslLauncher: () => fakeWsl(new Error("timeout")),
			});
			await manager.initialize();
			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			const failure = showDesktopFailureDialogMock.mock.calls[0][1];
			expect(failure.code).toBe("WSL_RUNTIME_START_FAILED");
			expect(failure.canRetry).toBe(true);
			expect(failure.canFallbackToLocal).toBe(true);
		});

		it("WSL fallback-local switches to local runtime", async () => {
			const wsl: SavedConnection = { id: "wsl", label: "WSL", serverUrl: "" };
			showDesktopFailureDialogMock.mockResolvedValueOnce("fallback-local");
			const cm = fakeCM();
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm,
				store: fakeStore("wsl", [wsl]),
				createWslLauncher: () => fakeWsl(new Error("WSL err")),
			});
			await manager.initialize();
			expect(cm.start).toHaveBeenCalled();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("source code has no non-comment about:blank usage", () => {
			const src = readFileSync(
				new URL("../src/connection-manager.ts", import.meta.url), "utf-8",
			);
			const nonComment = src.split("\n").filter((l) => {
				const t = l.trim();
				if (t.startsWith("//") || t.startsWith("*")) return false;
				return t.includes("about:blank");
			});
			expect(nonComment).toHaveLength(0);
		});
	});
});
