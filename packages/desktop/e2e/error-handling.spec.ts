/**
 * Error/Failure Handling E2E specs.
 *
 * Tests cover:
 * - Boot state tracks phases correctly during normal startup
 * - App does not crash with corrupt connections.json (error recovery)
 * - Preflight check resources are valid during normal boot
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("error and failure handling", () => {
	test.setTimeout(120_000);

	test("app boots to ready state on successful startup", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { page } = launched;

			await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });
		} finally {
			await launched?.cleanup();
		}
	});

	test("app survives corrupt connections.json and falls back to defaults", async () => {
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-corrupt-conn-"),
		);

		try {
			mkdirSync(sharedUserDataDir, { recursive: true });

			writeFileSync(
				join(sharedUserDataDir, "connections.json"),
				"{{{{not valid json!!!!",
				"utf-8",
			);

			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir: sharedUserDataDir });
				const { page } = launched;

				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				const pageUrl = new URL(page.url());
				expect(
					pageUrl.hostname === "localhost" || pageUrl.hostname === "127.0.0.1",
				).toBe(true);
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(sharedUserDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("app survives empty connections.json and falls back to defaults", async () => {
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-empty-conn-"),
		);

		try {
			mkdirSync(sharedUserDataDir, { recursive: true });

			writeFileSync(
				join(sharedUserDataDir, "connections.json"),
				"{}",
				"utf-8",
			);

			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir: sharedUserDataDir });
				const { page } = launched;

				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				const pageUrl = new URL(page.url());
				expect(
					pageUrl.hostname === "localhost" || pageUrl.hostname === "127.0.0.1",
				).toBe(true);
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(sharedUserDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("runtime health endpoint is accessible after boot", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { runtimeUrl } = launched;

			const response = await fetch(`${runtimeUrl}/api/health`);
			expect(response.ok).toBe(true);

			const body = (await response.json()) as { ok: boolean; version?: string };
			expect(body.ok).toBe(true);
			expect(body.version).toBeTruthy();
		} finally {
			await launched?.cleanup();
		}
	});

	test("app survives missing window-state.json gracefully", async () => {
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-no-winstate-"),
		);

		try {
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
