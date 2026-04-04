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
import { getBootState, recordBootFailure } from "../src/desktop-boot-state.js";
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
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const cm = fakeCM(vi.fn().mockRejectedValue(new Error("child start failed")));
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			await manager.initialize();
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

	// -- local failure dialog -------------------------------------------------

	describe("local failure dialog", () => {
		it("shows failure dialog when child start throws", async () => {
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const cm = fakeCM(vi.fn().mockRejectedValue(new Error("spawn ENOENT")));
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			await manager.initialize();

			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			const failure = showDesktopFailureDialogMock.mock.calls[0][1];
			expect(failure.code).toBe("RUNTIME_CHILD_START_FAILED");
			expect(failure.canFallbackToLocal).toBe(false);
			expect(failure.canRetry).toBe(true);
			expect(recordBootFailure).toHaveBeenCalledWith("RUNTIME_CHILD_START_FAILED", "spawn ENOENT");
			expect(loadURLMock).not.toHaveBeenCalled();
		});

		it("retries on retry action", async () => {
			const startMock = vi.fn()
				.mockRejectedValueOnce(new Error("first fail"))
				.mockResolvedValueOnce("http://127.0.0.1:9999");
			showDesktopFailureDialogMock.mockResolvedValueOnce("retry");
			const cm = fakeCM(startMock);
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			await manager.initialize();

			expect(startMock).toHaveBeenCalledTimes(2);
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:9999");
		});

		it("does not call recordBootFailure on retry", async () => {
			const startMock = vi.fn()
				.mockRejectedValueOnce(new Error("transient"))
				.mockResolvedValueOnce("http://127.0.0.1:9999");
			showDesktopFailureDialogMock.mockResolvedValueOnce("retry");
			const cm = fakeCM(startMock);
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			await manager.initialize();

			expect(recordBootFailure).not.toHaveBeenCalled();
		});
	});

	// -- updateWindow ---------------------------------------------------------

	describe("updateWindow", () => {
		it("replaces window without calling methods on old window", () => {
			const oldWindow = fakeWindow();
			const newWindow = fakeWindow();
			const manager = new ConnectionManager({
				window: oldWindow, childManager: fakeCM(), store: fakeStore("local"),
			});
			// No calls on old window's session after updateWindow
			manager.updateWindow(newWindow);
			// Verify the new window is used for subsequent operations
			// (we verify indirectly — next loadURL should go to newWindow)
			expect((newWindow as any).loadURL).not.toHaveBeenCalled();
			expect((oldWindow.webContents.session.webRequest as any).onBeforeSendHeaders).not.toHaveBeenCalled();
		});

		it("nulls disposeAuthInterceptor so old interceptor is not disposed", async () => {
			const oldWindow = fakeWindow();
			const manager = new ConnectionManager({
				window: oldWindow, childManager: fakeCM(), store: fakeStore("local"),
			});
			// Initialize to install an auth interceptor
			await manager.initialize();
			const newWindow = fakeWindow();
			// updateWindow should null the dispose — no crash when shutdown later
			manager.updateWindow(newWindow);
			// shutdown should not throw even though old window's session is gone
			await expect(manager.shutdown()).resolves.toBeUndefined();
		});
	});

	// -- reconnectActiveConnection -------------------------------------------

	describe("reconnectActiveConnection", () => {
		it("with running local child reinstalls auth and loads URL", async () => {
			const window = fakeWindow();
			const cm = fakeCM();
			const manager = new ConnectionManager({
				window, childManager: cm, store: fakeStore("local"),
			});
			// Initialize to start the child (sets childRunning = true)
			await manager.initialize();
			loadURLMock.mockClear();

			// reconnect should re-install auth and load URL on the same window
			await manager.reconnectActiveConnection();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("restarts child when loadURL fails", async () => {
			const startMock = vi.fn().mockResolvedValue("http://127.0.0.1:12345");
			const cm = fakeCM(startMock);
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			// Initialize to start the child
			await manager.initialize();
			startMock.mockClear();
			loadURLMock.mockClear();

			// Make loadURL fail on reconnect — should restart child via switchToLocal
			loadURLMock.mockRejectedValueOnce(new Error("load failed"));
			startMock.mockResolvedValueOnce("http://127.0.0.1:54321");
			await manager.reconnectActiveConnection();

			// switchToLocal should have been called (start called again)
			expect(startMock).toHaveBeenCalled();
		});

		it("starts fresh child when child is not running", async () => {
			const startMock = vi.fn().mockResolvedValue("http://127.0.0.1:12345");
			const cm = fakeCM(startMock);
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			// Don't initialize — child is not running

			await manager.reconnectActiveConnection();
			// switchToLocal should start the child
			expect(startMock).toHaveBeenCalled();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("uses getActiveConnection() not getActiveConnectionId() — handles stale IDs", async () => {
			// Store with stale activeConnectionId pointing to a deleted entry
			// getActiveConnection() falls back to local (first entry)
			const store = {
				getActiveConnection: () => ({ id: "local", label: "Local", serverUrl: "" }),
				getActiveConnectionId: () => "deleted-remote-123",
				getConnections: () => [{ id: "local", label: "Local", serverUrl: "" }],
				setActiveConnection: vi.fn(),
			} as unknown as ConnectionStore;

			const startMock = vi.fn().mockResolvedValue("http://127.0.0.1:12345");
			const cm = fakeCM(startMock);
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store,
			});

			await manager.reconnectActiveConnection();
			// Should have gone through local path (switchToLocal), not remote
			expect(startMock).toHaveBeenCalled();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("reconnects to remote when active connection is remote", async () => {
			const remoteConn: SavedConnection = {
				id: "remote-1", label: "Prod", serverUrl: "https://prod.example.com", authToken: "tok",
			};
			const store = fakeStore(remoteConn.id, [remoteConn]);
			const manager = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(), store,
			});

			await manager.reconnectActiveConnection();
			expect(loadURLMock).toHaveBeenCalledWith("https://prod.example.com");
		});
	});

	// -- remote failure dialog ------------------------------------------------

	describe("remote failure dialog", () => {
		const remoteConn: SavedConnection = {
			id: "remote-1", label: "Prod Server",
			serverUrl: "https://prod.example.com", authToken: "tok",
		};

		function mockBootPhase(phase: string, failureCode: string | null = null) {
			vi.mocked(getBootState).mockReturnValue({
				currentPhase: phase,
				lastSuccessfulPhase: "create-window",
				failureCode: failureCode,
				failureMessage: failureCode ? "prev" : null,
				startedAt: new Date().toISOString(),
				phaseHistory: [],
			} as any);
		}

		it("shows failure dialog when loadURL throws", async () => {
			mockBootPhase("initialize-connections");
			loadURLMock.mockRejectedValueOnce(new Error("ERR_CONNECTION_REFUSED"));
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			const failure = showDesktopFailureDialogMock.mock.calls[0][1];
			expect(failure.code).toBe("REMOTE_CONNECTION_UNREACHABLE");
			expect(failure.canRetry).toBe(true);
			expect(failure.canFallbackToLocal).toBe(true);
			expect(failure.message).toContain("Prod Server");
		});

		it("retries on retry action and succeeds", async () => {
			mockBootPhase("initialize-connections");
			loadURLMock
				.mockRejectedValueOnce(new Error("timeout"))
				.mockResolvedValueOnce(undefined);
			showDesktopFailureDialogMock.mockResolvedValueOnce("retry");
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			expect(loadURLMock).toHaveBeenCalledTimes(2);
			expect(loadURLMock).toHaveBeenCalledWith("https://prod.example.com");
		});

		it("falls back to local on fallback-local action", async () => {
			mockBootPhase("initialize-connections");
			loadURLMock.mockRejectedValueOnce(new Error("unreachable"));
			showDesktopFailureDialogMock.mockResolvedValueOnce("fallback-local");
			const cm = fakeCM();
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: cm,
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			expect(cm.start).toHaveBeenCalled();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("records boot failure during startup when dismissed", async () => {
			mockBootPhase("initialize-connections");
			loadURLMock.mockRejectedValueOnce(new Error("DNS_PROBE_FAILED"));
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			expect(recordBootFailure).toHaveBeenCalledWith(
				"REMOTE_CONNECTION_UNREACHABLE",
				"DNS_PROBE_FAILED",
			);
		});

		it("does not record boot failure when already ready (post-startup)", async () => {
			mockBootPhase("ready");
			loadURLMock.mockRejectedValueOnce(new Error("refused"));
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			expect(recordBootFailure).not.toHaveBeenCalled();
		});

		it("does not record boot failure when failureCode already set", async () => {
			mockBootPhase("failed", "RUNTIME_CHILD_START_FAILED");
			loadURLMock.mockRejectedValueOnce(new Error("net error"));
			showDesktopFailureDialogMock.mockResolvedValueOnce("dismiss");
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: fakeCM(),
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			expect(showDesktopFailureDialogMock).toHaveBeenCalledOnce();
			expect(recordBootFailure).not.toHaveBeenCalled();
		});
	});

	// -- initialize fallback behavior (Task 9) --------------------------------
	// Lock in existing behavior: how initialize() routes based on store state.

	describe("initialize fallback behavior", () => {
		it("initialize() with empty store starts local", async () => {
			const cm = fakeCM();
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store: fakeStore("local"),
			});
			await mgr.initialize();

			expect(cm.start).toHaveBeenCalledOnce();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("initialize() with persisted remote attempts remote (no local start)", async () => {
			const remoteConn: SavedConnection = {
				id: "remote-x", label: "Staging",
				serverUrl: "https://staging.example.com", authToken: "tok",
			};
			const cm = fakeCM();
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: cm,
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			// Should NOT start local child.
			expect(cm.start).not.toHaveBeenCalled();
			// Should load the remote URL.
			expect(loadURLMock).toHaveBeenCalledWith("https://staging.example.com");
		});

		it("initialize() uses getActiveConnection() fallback when active ID is stale", async () => {
			// Store with stale active ID — getActiveConnection() returns local.
			const store = fakeStore("deleted-id");
			const cm = fakeCM();
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: cm, store,
			});
			await mgr.initialize();

			// Should start local (the fallback from getActiveConnection()).
			expect(cm.start).toHaveBeenCalledOnce();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});

		it("initialize() with failed remote falls back to local gracefully", async () => {
			const remoteConn: SavedConnection = {
				id: "remote-broken", label: "Broken",
				serverUrl: "https://broken.io", authToken: "t",
			};
			vi.mocked(getBootState).mockReturnValue({
				currentPhase: "initialize-connections",
				lastSuccessfulPhase: "create-window",
				failureCode: null,
				failureMessage: null,
				startedAt: new Date().toISOString(),
				phaseHistory: [],
			} as any);
			loadURLMock.mockRejectedValueOnce(new Error("connection refused"));
			showDesktopFailureDialogMock.mockResolvedValueOnce("fallback-local");
			const cm = fakeCM();
			const mgr = new ConnectionManager({
				window: fakeWindow(), childManager: cm,
				store: fakeStore(remoteConn.id, [remoteConn]),
			});
			await mgr.initialize();

			// After fallback, local child should start.
			expect(cm.start).toHaveBeenCalledOnce();
			expect(loadURLMock).toHaveBeenCalledWith("http://127.0.0.1:12345");
		});
	});
});
