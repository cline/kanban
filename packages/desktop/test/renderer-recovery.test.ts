import { describe, expect, it, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock Electron
// ---------------------------------------------------------------------------

const showMessageBoxSyncMock = vi.fn().mockReturnValue(1); // default: "Dismiss"

vi.mock("electron", () => ({
	BrowserWindow: vi.fn(),
	dialog: {
		showMessageBoxSync: (...args: unknown[]) => showMessageBoxSyncMock(...args),
	},
}));

import { attachRendererRecoveryHandlers } from "../src/renderer-recovery.js";
import type { ConnectionManager } from "../src/connection-manager.js";
import type { BrowserWindow } from "electron";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

interface MockWebContents {
	handlers: Record<string, EventHandler>;
	on: ReturnType<typeof vi.fn>;
}

function fakeWindow(): BrowserWindow & { webContents: MockWebContents } {
	const handlers: Record<string, EventHandler> = {};
	const webContents: MockWebContents = {
		handlers,
		on: vi.fn((event: string, handler: EventHandler) => {
			handlers[event] = handler;
		}),
	};
	return {
		webContents,
		isDestroyed: () => false,
	} as unknown as BrowserWindow & { webContents: MockWebContents };
}

function fakeConnectionManager(): ConnectionManager {
	return {
		reconnectActiveConnection: vi.fn().mockResolvedValue(undefined),
	} as unknown as ConnectionManager;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("attachRendererRecoveryHandlers", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	describe("did-fail-load", () => {
		it("shows dialog for main-frame failures", () => {
			const window = fakeWindow();
			const cm = fakeConnectionManager();
			attachRendererRecoveryHandlers(window, () => cm);
			const handler = window.webContents.handlers["did-fail-load"];
			expect(handler).toBeDefined();
			handler({}, -105, "ERR_NAME_NOT_RESOLVED", "http://localhost:3000", true, 0, 0);
			expect(showMessageBoxSyncMock).toHaveBeenCalledOnce();
			const opts = showMessageBoxSyncMock.mock.calls[0][1];
			expect(opts.title).toBe("Page Load Failed");
			expect(opts.message).toContain("ERR_NAME_NOT_RESOLVED");
			expect(opts.buttons).toEqual(["Retry", "Dismiss"]);
		});

		it("ignores ERR_ABORTED (code -3)", () => {
			const window = fakeWindow();
			attachRendererRecoveryHandlers(window, () => null);
			window.webContents.handlers["did-fail-load"]({}, -3, "ERR_ABORTED", "http://localhost:3000", true, 0, 0);
			expect(showMessageBoxSyncMock).not.toHaveBeenCalled();
		});

		it("ignores subresource failures (isMainFrame = false)", () => {
			const window = fakeWindow();
			attachRendererRecoveryHandlers(window, () => null);
			window.webContents.handlers["did-fail-load"]({}, -105, "ERR_NAME_NOT_RESOLVED", "http://cdn.example.com/img.png", false, 0, 0);
			expect(showMessageBoxSyncMock).not.toHaveBeenCalled();
		});

		it("calls reconnectActiveConnection when user clicks Retry", () => {
			showMessageBoxSyncMock.mockReturnValueOnce(0);
			const window = fakeWindow();
			const cm = fakeConnectionManager();
			attachRendererRecoveryHandlers(window, () => cm);
			window.webContents.handlers["did-fail-load"]({}, -105, "ERR_CONNECTION_REFUSED", "http://localhost:3000", true, 0, 0);
			expect(cm.reconnectActiveConnection).toHaveBeenCalledOnce();
		});

		it("does not reconnect when user clicks Dismiss", () => {
			showMessageBoxSyncMock.mockReturnValueOnce(1);
			const window = fakeWindow();
			const cm = fakeConnectionManager();
			attachRendererRecoveryHandlers(window, () => cm);
			window.webContents.handlers["did-fail-load"]({}, -105, "ERR_CONNECTION_REFUSED", "http://localhost:3000", true, 0, 0);
			expect(cm.reconnectActiveConnection).not.toHaveBeenCalled();
		});

		it("handles null connectionManager gracefully", () => {
			showMessageBoxSyncMock.mockReturnValueOnce(0);
			const window = fakeWindow();
			attachRendererRecoveryHandlers(window, () => null);
			expect(() => {
				window.webContents.handlers["did-fail-load"]({}, -105, "ERR_CONNECTION_REFUSED", "http://localhost:3000", true, 0, 0);
			}).not.toThrow();
		});
	});

	describe("render-process-gone", () => {
		it("shows dialog with reason", () => {
			const window = fakeWindow();
			const cm = fakeConnectionManager();
			attachRendererRecoveryHandlers(window, () => cm);
			window.webContents.handlers["render-process-gone"]({}, { reason: "crashed", exitCode: 1 });
			expect(showMessageBoxSyncMock).toHaveBeenCalledOnce();
			const opts = showMessageBoxSyncMock.mock.calls[0][1];
			expect(opts.title).toBe("Renderer Crashed");
			expect(opts.message).toContain("crashed");
			expect(opts.buttons).toEqual(["Reload", "Dismiss"]);
		});

		it("calls reconnectActiveConnection when user clicks Reload", () => {
			showMessageBoxSyncMock.mockReturnValueOnce(0);
			const window = fakeWindow();
			const cm = fakeConnectionManager();
			attachRendererRecoveryHandlers(window, () => cm);
			window.webContents.handlers["render-process-gone"]({}, { reason: "oom", exitCode: -9 });
			expect(cm.reconnectActiveConnection).toHaveBeenCalledOnce();
		});

		it("does not reconnect when user clicks Dismiss", () => {
			showMessageBoxSyncMock.mockReturnValueOnce(1);
			const window = fakeWindow();
			const cm = fakeConnectionManager();
			attachRendererRecoveryHandlers(window, () => cm);
			window.webContents.handlers["render-process-gone"]({}, { reason: "killed", exitCode: 0 });
			expect(cm.reconnectActiveConnection).not.toHaveBeenCalled();
		});

		it("handles null connectionManager gracefully", () => {
			showMessageBoxSyncMock.mockReturnValueOnce(0);
			const window = fakeWindow();
			attachRendererRecoveryHandlers(window, () => null);
			expect(() => {
				window.webContents.handlers["render-process-gone"]({}, { reason: "crashed", exitCode: 1 });
			}).not.toThrow();
		});
	});

	describe("handler registration", () => {
		it("registers both did-fail-load and render-process-gone handlers", () => {
			const window = fakeWindow();
			attachRendererRecoveryHandlers(window, () => null);
			expect(window.webContents.on).toHaveBeenCalledWith("did-fail-load", expect.any(Function));
			expect(window.webContents.on).toHaveBeenCalledWith("render-process-gone", expect.any(Function));
		});
	});
});
