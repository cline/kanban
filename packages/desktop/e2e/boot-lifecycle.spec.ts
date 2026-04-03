/**
 * Boot Lifecycle E2E specs — Runtime Child Management.
 *
 * Proves the desktop app starts the runtime child automatically and tears it
 * down on exit.
 *
 * These tests exercise the real Electron app via Playwright's Electron
 * support, so they require a working build (`npm run build:ts`) and the
 * kanban runtime dependency installed.
 */

import { test, expect } from "@playwright/test";
import { launchDesktopApp, type LaunchedDesktopApp } from "./fixtures";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum time (ms) to wait for the runtime to become unreachable after app close. */
const SHUTDOWN_TIMEOUT_MS = 30_000;

/** Polling interval (ms) when checking if the runtime has shut down. */
const SHUTDOWN_POLL_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll `url` with Node-side HTTP requests until it stops responding (i.e.
 * the fetch rejects or returns a non-ok status).
 *
 * Uses the global `fetch` available in Node 18+, which is the same runtime
 * Electron's main process uses.  We intentionally avoid `page.evaluate`
 * because the page/window is already closed at this point.
 */
async function waitUntilUnreachable(url: string): Promise<void> {
	const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;

	while (Date.now() < deadline) {
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 3_000);

			const response = await fetch(url, {
				signal: controller.signal,
			});
			clearTimeout(timeout);

			if (!response.ok) {
				// Non-ok response (e.g. 502, 503) — runtime is shutting down
				// or already gone.  Treat as unreachable.
				return;
			}
		} catch {
			// Network error / connection refused / abort — runtime is gone.
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, SHUTDOWN_POLL_MS));
	}

	throw new Error(
		`[boot-lifecycle] Timed out after ${SHUTDOWN_TIMEOUT_MS}ms waiting for ` +
		`the runtime at ${url} to become unreachable after app close.`,
	);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("boot lifecycle — runtime child management", () => {
	// Each test manages its own launch/cleanup to avoid coupling test
	// ordering.  The generous per-test timeout accounts for Electron startup
	// and runtime child process initialization.
	test.setTimeout(120_000);

	test("desktop app starts runtime child automatically", async () => {
		let harness: LaunchedDesktopApp | undefined;

		try {
			harness = await launchDesktopApp();

			const { page, runtimeUrl } = harness;

			// The fixture already waited for /api/health to respond 200, so
			// the runtime child is running.  Verify the renderer has navigated
			// to the runtime URL (not stuck on about:blank).
			const pageUrl = page.url();
			expect(pageUrl).not.toBe("about:blank");
			expect(pageUrl.startsWith("http")).toBe(true);

			// Verify the page is NOT showing the disconnected fallback.
			// The RuntimeDisconnectedFallback renders text containing either
			// "Kanban Runtime Disconnected" (desktop) or "Disconnected from
			// Cline" (browser).  Its absence proves the runtime child started
			// successfully and the renderer connected to it.
			const disconnectedText = page.getByText("Kanban Runtime Disconnected");
			await expect(disconnectedText).not.toBeVisible({ timeout: 5_000 });

			// Additionally confirm the runtime URL was discovered.
			expect(runtimeUrl).toBeTruthy();
			expect(runtimeUrl.startsWith("http")).toBe(true);

			// Double-check the runtime is healthy from the Node side.
			const healthResponse = await fetch(`${runtimeUrl}/api/health`);
			expect(healthResponse.ok).toBe(true);
		} finally {
			if (harness) {
				await harness.cleanup();
			}
		}
	});

	test("closing the desktop app makes the runtime unreachable", async () => {
		let runtimeUrl: string | undefined;

		// Launch the app and capture the runtime URL.
		const harness = await launchDesktopApp();
		runtimeUrl = harness.runtimeUrl;

		// Sanity check: the runtime is reachable right now.
		const healthUrl = `${runtimeUrl}/api/health`;
		const preCloseResponse = await fetch(healthUrl);
		expect(preCloseResponse.ok).toBe(true);

		// Close the app.  This triggers the before-quit / will-quit lifecycle
		// which shuts down the runtime child process.
		await harness.cleanup();

		// Poll the runtime URL with direct Node-side HTTP requests until it
		// stops responding.  The generous timeout accommodates the graceful
		// shutdown sequence (child SIGTERM, timeout, SIGKILL).
		await waitUntilUnreachable(healthUrl);

		// Final verification: one more request to confirm it's truly gone.
		let finalReachable = false;
		try {
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 3_000);
			const response = await fetch(healthUrl, { signal: controller.signal });
			clearTimeout(timeout);
			finalReachable = response.ok;
		} catch {
			finalReachable = false;
		}

		expect(finalReachable).toBe(false);
	});
});
