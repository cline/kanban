/**
 * Protocol Handler E2E specs — kanban:// deep-link handling.
 *
 * Tests cover:
 * - Protocol registration (kanban:// is registered as default)
 * - Parsing and routing of kanban://oauth/callback URLs
 * - Second-instance argv forwarding of protocol URLs
 */

import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("protocol handler — kanban:// deep links", () => {
	test.setTimeout(120_000);

	test("app registers kanban:// as default protocol client", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp } = launched;

			const isDefault = await electronApp.evaluate(async ({ app }) => {
				return app.isDefaultProtocolClient("kanban");
			});

			expect(isDefault).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	test("open-url event with OAuth callback brings window to front", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp, page } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

			await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				if (win) win.minimize();
			});

			await electronApp.evaluate(({ app }) => {
				app.emit("open-url", { preventDefault: () => {} } as Electron.Event,
					"kanban://oauth/callback?code=test123&state=abc");
			});

			await page.waitForTimeout(1_000);

			const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				return win ? win.isVisible() && !win.isMinimized() : false;
			});

			expect(isVisible).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	test("second-instance with kanban:// URL focuses the existing window", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp, page } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

			await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				if (win) win.minimize();
			});

			await electronApp.evaluate(({ app }) => {
				app.emit("second-instance" as any,
					{} as Electron.Event,
					["kanban-desktop", "kanban://oauth/callback?code=xyz&state=def"],
					process.cwd(),
				);
			});

			await page.waitForTimeout(1_000);

			const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				return win ? win.isVisible() && !win.isMinimized() : false;
			});

			expect(isVisible).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});
});
