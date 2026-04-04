/**
 * Diagnostics Dialog E2E specs — verify that the diagnostics panel reflects
 * actual desktop runtime state.
 *
 * These tests launch the full Electron app via Playwright, trigger the
 * diagnostics dialog through the real IPC path (`open-diagnostics`), and
 * assert that the rendered information matches the expected local/connected
 * state.
 *
 * SKIPPED: The DiagnosticsDialog component and useDiagnostics hook have not
 * been implemented on this branch yet. This test will be enabled once the
 * web-ui diagnostics feature is merged from main.
 */

import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("diagnostics dialog", () => {
	test.setTimeout(120_000);

	test.skip("diagnostics dialog shows local connected state", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { page, electronApp } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

			await electronApp.evaluate(({ BrowserWindow }) => {
				const windows = BrowserWindow.getAllWindows();
				if (windows.length > 0) {
					windows[0].webContents.send("open-diagnostics");
				}
			});

			const dialogTitle = page.getByRole("heading", { name: "Diagnostics" });
			await expect(dialogTitle).toBeVisible({ timeout: 10_000 });
		} finally {
			await launched?.cleanup();
		}
	});
});
