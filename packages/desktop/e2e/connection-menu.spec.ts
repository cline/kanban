/**
 * Connection Menu E2E specs — menu structure and interactions.
 *
 * Tests cover:
 * - Connection menu exists in the application menu bar
 * - "Local" connection entry is present and checked by default
 * - "Add Remote Connection…" menu item is present
 * - No "Remove" item when local is active
 */

import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("connection menu", () => {
	test.setTimeout(120_000);

	test("application menu contains a Connection submenu", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp } = launched;

			const menuLabels = await electronApp.evaluate(({ Menu }) => {
				const appMenu = Menu.getApplicationMenu();
				if (!appMenu) return [];
				return appMenu.items.map((item) => item.label);
			});

			expect(menuLabels).toContain("Connection");
		} finally {
			await launched?.cleanup();
		}
	});

	test("Connection menu has Local entry checked by default", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp } = launched;

			const result = await electronApp.evaluate(({ Menu }) => {
				const appMenu = Menu.getApplicationMenu();
				if (!appMenu) return { found: false, checked: false };

				const connectionMenu = appMenu.items.find(
					(item) => item.label === "Connection",
				);
				if (!connectionMenu?.submenu) return { found: false, checked: false };

				const localItem = connectionMenu.submenu.items.find(
					(item) => item.label === "Local",
				);
				return {
					found: !!localItem,
					checked: localItem?.checked ?? false,
				};
			});

			expect(result.found).toBe(true);
			expect(result.checked).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	test("Connection menu has 'Add Remote Connection…' item", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp } = launched;

			const hasAddRemote = await electronApp.evaluate(({ Menu }) => {
				const appMenu = Menu.getApplicationMenu();
				if (!appMenu) return false;

				const connectionMenu = appMenu.items.find(
					(item) => item.label === "Connection",
				);
				if (!connectionMenu?.submenu) return false;

				return connectionMenu.submenu.items.some(
					(item) => item.label === "Add Remote Connection\u2026",
				);
			});

			expect(hasAddRemote).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	test("Connection menu does not show Remove item for local connection", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { electronApp } = launched;

			const hasRemove = await electronApp.evaluate(({ Menu }) => {
				const appMenu = Menu.getApplicationMenu();
				if (!appMenu) return false;

				const connectionMenu = appMenu.items.find(
					(item) => item.label === "Connection",
				);
				if (!connectionMenu?.submenu) return false;

				return connectionMenu.submenu.items.some(
					(item) => item.label.startsWith("Remove"),
				);
			});

			expect(hasRemove).toBe(false);
		} finally {
			await launched?.cleanup();
		}
	});
});
