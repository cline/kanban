/**
 * Window State Persistence E2E specs.
 *
 * Tests cover:
 * - Window bounds are saved to window-state.json on close
 * - Saved bounds are restored on relaunch (same userData dir)
 * - Missing/corrupt window-state.json falls back to defaults
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

interface WindowState {
	x: number | undefined;
	y: number | undefined;
	width: number;
	height: number;
	isMaximized: boolean;
}

test.describe("window state persistence", () => {
	test.setTimeout(180_000);

	test("window-state.json is created after first launch", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { userDataDir, page } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

			const statePath = join(userDataDir, "window-state.json");
			expect(existsSync(statePath)).toBe(true);

			const raw = readFileSync(statePath, "utf-8");
			const state: WindowState = JSON.parse(raw);

			expect(typeof state.width).toBe("number");
			expect(typeof state.height).toBe("number");
			expect(typeof state.isMaximized).toBe("boolean");
			expect(state.width).toBeGreaterThan(0);
			expect(state.height).toBeGreaterThan(0);
		} finally {
			await launched?.cleanup();
		}
	});

	test("window bounds are restored across relaunch", async () => {
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-winstate-"),
		);

		try {
			let firstLaunch: LaunchedDesktopApp | undefined;
			let savedState: WindowState | undefined;

			try {
				firstLaunch = await launchDesktopApp({ userDataDir: sharedUserDataDir });
				const { page, electronApp } = firstLaunch;

				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				await electronApp.evaluate(({ BrowserWindow }) => {
					const win = BrowserWindow.getAllWindows()[0];
					if (win) {
						win.unmaximize();
						win.setSize(1100, 750);
						win.setPosition(50, 50);
					}
				});

				await page.waitForTimeout(1_000);

				const statePath = join(sharedUserDataDir, "window-state.json");
				expect(existsSync(statePath)).toBe(true);
				savedState = JSON.parse(readFileSync(statePath, "utf-8"));
			} finally {
				await firstLaunch?.cleanup();
			}

			expect(savedState).toBeDefined();
			expect(savedState!.width).toBe(1100);
			expect(savedState!.height).toBe(750);

			let secondLaunch: LaunchedDesktopApp | undefined;

			try {
				secondLaunch = await launchDesktopApp({ userDataDir: sharedUserDataDir });
				const { electronApp, page } = secondLaunch;

				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
					const win = BrowserWindow.getAllWindows()[0];
					return win ? win.getBounds() : null;
				});

				expect(bounds).toBeTruthy();
				expect(bounds!.width).toBeGreaterThanOrEqual(1090);
				expect(bounds!.width).toBeLessThanOrEqual(1110);
				expect(bounds!.height).toBeGreaterThanOrEqual(740);
				expect(bounds!.height).toBeLessThanOrEqual(760);
			} finally {
				await secondLaunch?.cleanup();
			}
		} finally {
			await rm(sharedUserDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("corrupt window-state.json falls back to defaults", async () => {
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-winstate-corrupt-"),
		);

		try {
			writeFileSync(
				join(sharedUserDataDir, "window-state.json"),
				"not valid json {{{",
				"utf-8",
			);

			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir: sharedUserDataDir });
				const { electronApp, page } = launched;

				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
					const win = BrowserWindow.getAllWindows()[0];
					return win ? win.getBounds() : null;
				});

				expect(bounds).toBeTruthy();
				expect(bounds!.width).toBeGreaterThanOrEqual(800);
				expect(bounds!.height).toBeGreaterThanOrEqual(600);
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(sharedUserDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});
});
