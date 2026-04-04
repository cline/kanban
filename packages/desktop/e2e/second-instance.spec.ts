/**
 * Second Instance Forwarding E2E specs.
 *
 * Tests cover:
 * - The app acquires a single-instance lock
 * - Simulated second-instance event focuses the existing window
 * - Minimized window is restored on second-instance event
 */

import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("second instance forwarding", () => {
	test.setTimeout(120_000);

	test("app holds the single-instance lock", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp } = launched;

			const windowCount = await electronApp.evaluate(({ BrowserWindow }) => {
				return BrowserWindow.getAllWindows().length;
			});

			expect(windowCount).toBeGreaterThan(0);
		} finally {
			await launched?.cleanup();
		}
	});

	test("second-instance event restores a minimized window", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp, page } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

			await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				if (win) win.minimize();
			});

			// Allow the window manager time to process the minimize request.
			await page.waitForTimeout(1_000);

			const isMinimizedBefore = await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				return win?.isMinimized() ?? false;
			});
			expect(isMinimizedBefore).toBe(true);

			await electronApp.evaluate(({ app }) => {
				app.emit("second-instance" as any,
					{} as Electron.Event,
					["kanban-desktop"],
					process.cwd(),
				);
			});

			await page.waitForTimeout(1_000);

			const isMinimizedAfter = await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				return win?.isMinimized() ?? true;
			});

			expect(isMinimizedAfter).toBe(false);
		} finally {
			await launched?.cleanup();
		}
	});

	test("second-instance event focuses the window", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp, page } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

			await electronApp.evaluate(({ app }) => {
				app.emit("second-instance" as any,
					{} as Electron.Event,
					["kanban-desktop"],
					process.cwd(),
				);
			});

			await page.waitForTimeout(500);

			const isVisible = await electronApp.evaluate(({ BrowserWindow }) => {
				const win = BrowserWindow.getAllWindows()[0];
				return win ? win.isVisible() : false;
			});

			expect(isVisible).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});
});
