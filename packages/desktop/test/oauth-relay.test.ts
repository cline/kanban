import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock Electron
// ---------------------------------------------------------------------------

const { showMessageBoxMock } = vi.hoisted(() => ({
	showMessageBoxMock: vi.fn().mockResolvedValue({ response: 0 }),
}));

vi.mock("electron", () => ({
	dialog: { showMessageBox: showMessageBoxMock },
}));

import { type OAuthRelayDeps, relayOAuthCallback } from "../src/oauth-relay.js";
import type { BrowserWindow } from "electron";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeWindow(destroyed = false): BrowserWindow {
	return { isDestroyed: () => destroyed } as unknown as BrowserWindow;
}

function makeDeps(overrides?: Partial<OAuthRelayDeps>): OAuthRelayDeps {
	return {
		fetch: overrides?.fetch ?? vi.fn().mockResolvedValue({ ok: true }),
		getMainWindow: overrides?.getMainWindow ?? (() => fakeWindow()),
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("relayOAuthCallback", () => {
	beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
	afterEach(() => { vi.useRealTimers(); });

	it("succeeds on first attempt without retrying", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true });
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/cb");
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});


	it("retries on fetch failure and succeeds on second attempt", async () => {
		const fetchMock = vi.fn()
			.mockRejectedValueOnce(new Error("ECONNREFUSED"))
			.mockResolvedValueOnce({ ok: true });
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});

	it("retries on non-ok response and succeeds on second attempt", async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce({ ok: false, status: 503 })
			.mockResolvedValueOnce({ ok: true });
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});

	it("retries up to 2 times (3 total attempts) before exhausting", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it("shows dialog after exhausting all retries", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const window = fakeWindow();
		const deps = makeDeps({ fetch: fetchMock, getMainWindow: () => window });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
		expect(showMessageBoxMock).toHaveBeenCalledWith(window, {
			type: "warning",
			title: "OAuth Callback Failed",
			message: "The authentication callback could not be delivered. Please try again.",
			buttons: ["OK"],
		});
	});

	it("shows dialog when all responses are non-ok", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
	});

	it("does not show dialog when mainWindow is null", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const deps = makeDeps({ fetch: fetchMock, getMainWindow: () => null });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});

	it("does not show dialog when mainWindow is destroyed", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const deps = makeDeps({ fetch: fetchMock, getMainWindow: () => fakeWindow(true) });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(showMessageBoxMock).not.toHaveBeenCalled();
	});

	it("respects custom retry count", async () => {
		const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps, 0);
		await vi.runAllTimersAsync();
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(showMessageBoxMock).toHaveBeenCalledTimes(1);
	});

	it("delays 1 second between retry attempts", async () => {
		const fetchMock = vi.fn()
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValueOnce({ ok: true });
		const deps = makeDeps({ fetch: fetchMock });
		const p = relayOAuthCallback("http://localhost:3000/cb", deps);
		// After first failed attempt, second should not have been called yet
		await vi.advanceTimersByTimeAsync(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		// Advance past the 1s delay
		await vi.advanceTimersByTimeAsync(1_000);
		await p;
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
