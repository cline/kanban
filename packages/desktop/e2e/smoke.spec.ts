/**
 * Smoke E2E specs — validate that the Electron harness works end-to-end.
 *
 * These are the first "real" tests that launch the full desktop app via
 * Playwright's Electron support and exercise the renderer ↔ runtime path.
 */
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("smoke", () => {
	test("desktop app launches and shows Kanban UI", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { page } = launched;

			// The page title should contain "Kanban".
			await expect(page).toHaveTitle(/Kanban/, { timeout: 30_000 });

			// The board should render a "Backlog" column (or text).
			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });
		} finally {
			await launched?.cleanup();
		}
	});

	test("renderer can reach the runtime after desktop app launch", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { page } = launched;

			// Use renderer-side fetch (page.evaluate), NOT page.request, to
			// exercise the real Electron session / cookie path.
			const ok = await page.evaluate(async () => {
				const res = await fetch("/api/trpc/runtime.getConfig", {
					method: "GET",
					credentials: "same-origin",
				});
				return res.ok;
			});

			expect(ok).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});
});
