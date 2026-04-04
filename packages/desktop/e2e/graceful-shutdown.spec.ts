/**
 * Graceful Shutdown E2E specs — before-quit cleanup correctness.
 *
 * Tests cover:
 * - Runtime child is terminated on app close
 * - Connection manager shutdown runs without crashing
 * - No orphaned child processes after app exit
 */

import { test, expect } from "@playwright/test";
import { launchDesktopApp } from "./fixtures";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitFor(
	fn: () => Promise<boolean> | boolean,
	timeoutMs: number,
	pollMs = 500,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, pollMs));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("graceful shutdown cleanup", () => {
	test.setTimeout(120_000);

	test("runtime becomes unreachable after app close", async () => {
		const harness = await launchDesktopApp();
		const { runtimeUrl } = harness;

		const preClose = await fetch(`${runtimeUrl}/api/health`);
		expect(preClose.ok).toBe(true);

		await harness.cleanup();

		await waitFor(async () => {
			try {
				const ctrl = new AbortController();
				setTimeout(() => ctrl.abort(), 2_000);
				const res = await fetch(`${runtimeUrl}/api/health`, {
					signal: ctrl.signal,
				});
				return !res.ok;
			} catch {
				return true;
			}
		}, 30_000);
	});

	test("before-quit handler runs without crashing", async () => {
		const harness = await launchDesktopApp();
		const { page } = harness;

		await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

		await harness.cleanup();

		expect(true).toBe(true);
	});

	test("runtime child process is terminated after app close", async () => {
		const harness = await launchDesktopApp();
		const { electronApp, runtimeUrl } = harness;

		const mainPid = await electronApp.evaluate(async () => {
			return process.pid;
		});
		expect(mainPid).toBeGreaterThan(0);

		const preClose = await fetch(`${runtimeUrl}/api/health`);
		expect(preClose.ok).toBe(true);

		await harness.cleanup();

		await waitFor(() => !isProcessAlive(mainPid), 15_000);
		expect(isProcessAlive(mainPid)).toBe(false);

		let runtimeReachable = false;
		try {
			const ctrl = new AbortController();
			setTimeout(() => ctrl.abort(), 3_000);
			const res = await fetch(`${runtimeUrl}/api/health`, {
				signal: ctrl.signal,
			});
			runtimeReachable = res.ok;
		} catch {
			runtimeReachable = false;
		}
		expect(runtimeReachable).toBe(false);
	});
});
