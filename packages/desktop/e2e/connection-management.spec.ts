/**
 * Connection Persistence & Local Default E2E specs.
 *
 * Proves the desktop app boots into local mode by default and persists
 * connection metadata in isolated userData (connections.json).
 *
 * These tests exercise the real Electron app via Playwright's Electron
 * support, so they require a working build (`npm run build:ts`) and the
 * kanban runtime dependency installed.
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchDesktopApp, type LaunchedDesktopApp } from "./fixtures";

// ---------------------------------------------------------------------------
// Types — mirrors the persisted shape in src/connection-store.ts
// ---------------------------------------------------------------------------

interface PersistedConnection {
	id: string;
	label: string;
	serverUrl: string;
	authToken?: string;
	isEncrypted?: boolean;
}

interface PersistedStoreData {
	connections: PersistedConnection[];
	activeConnectionId: string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("connection persistence & local default", () => {
	// Each test manages its own launch/cleanup to avoid coupling test
	// ordering.  The generous per-test timeout accounts for Electron startup
	// and runtime child process initialization.
	test.setTimeout(120_000);

	// -----------------------------------------------------------------------
	// Test 1 — default startup uses local connection
	// -----------------------------------------------------------------------

	test("default startup uses local connection", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { page } = launched;

			// The loaded page origin must be localhost or 127.0.0.1.
			// This proves ConnectionManager.initialize() defaults to local mode.
			const pageUrl = new URL(page.url());
			const isLocal =
				pageUrl.hostname === "localhost" ||
				pageUrl.hostname === "127.0.0.1";

			expect(isLocal).toBe(true);
		} finally {
			await launched?.cleanup();
		}
	});

	// -----------------------------------------------------------------------
	// Test 2 — connections.json persists active connection metadata
	// -----------------------------------------------------------------------

	test("connections.json persists active connection metadata", async () => {
		let launched: LaunchedDesktopApp | undefined;

		try {
			launched = await launchDesktopApp();
			const { userDataDir } = launched;

			// Read the persisted connections.json from the isolated userData dir.
			// The ConnectionStore writes asynchronously, so poll briefly.
			const connectionsPath = join(userDataDir, "connections.json");
			for (let i = 0; i < 20 && !fs.existsSync(connectionsPath); i++) {
				await new Promise((r) => setTimeout(r, 500));
			}
			expect(fs.existsSync(connectionsPath)).toBe(true);

			const raw = fs.readFileSync(connectionsPath, "utf-8");
			const data: PersistedStoreData = JSON.parse(raw);

			// A "local" connection entry must exist.
			const localEntry = data.connections.find((c) => c.id === "local");
			expect(localEntry).toBeDefined();
			expect(localEntry!.label).toBe("Local");

			// An active connection ID must be present and set to "local".
			expect(data.activeConnectionId).toBe("local");
		} finally {
			await launched?.cleanup();
		}
	});

	// -----------------------------------------------------------------------
	// Test 3 — persisted local state is reused across relaunch
	// -----------------------------------------------------------------------

	test("persisted local state is reused across relaunch", async () => {
		// Create a caller-managed temp userDataDir that survives across
		// two app launches.
		const sharedUserDataDir = await mkdtemp(
			join(tmpdir(), "kanban-e2e-relaunch-"),
		);

		try {
			// ── First launch ─────────────────────────────────────────────
			let firstLaunch: LaunchedDesktopApp | undefined;

			try {
				firstLaunch = await launchDesktopApp({
					userDataDir: sharedUserDataDir,
				});

				// Wait for full startup (already guaranteed by the fixture).
				const firstPageUrl = new URL(firstLaunch.page.url());
				const isLocalFirst =
					firstPageUrl.hostname === "localhost" ||
					firstPageUrl.hostname === "127.0.0.1";
				expect(isLocalFirst).toBe(true);
			} finally {
				// Close the app — the cleanup function will NOT delete
				// sharedUserDataDir because we passed it via options.
				await firstLaunch?.cleanup();
			}

			// Verify connections.json was written during the first launch.
			// The ConnectionStore writes asynchronously, so poll briefly.
			const connectionsPath = join(sharedUserDataDir, "connections.json");
			for (let i = 0; i < 20 && !fs.existsSync(connectionsPath); i++) {
				await new Promise((r) => setTimeout(r, 500));
			}
			expect(fs.existsSync(connectionsPath)).toBe(true);

			const rawBetween = fs.readFileSync(connectionsPath, "utf-8");
			const dataBetween: PersistedStoreData = JSON.parse(rawBetween);
			expect(dataBetween.activeConnectionId).toBe("local");

			// ── Second launch (same userDataDir) ─────────────────────────
			let secondLaunch: LaunchedDesktopApp | undefined;

			try {
				secondLaunch = await launchDesktopApp({
					userDataDir: sharedUserDataDir,
				});

				// Startup must still resolve to local mode.
				const secondPageUrl = new URL(secondLaunch.page.url());
				const isLocalSecond =
					secondPageUrl.hostname === "localhost" ||
					secondPageUrl.hostname === "127.0.0.1";
				expect(isLocalSecond).toBe(true);

				// The persisted state must still be intact.
				const rawAfter = fs.readFileSync(connectionsPath, "utf-8");
				const dataAfter: PersistedStoreData = JSON.parse(rawAfter);

				expect(dataAfter.activeConnectionId).toBe("local");
				expect(
					dataAfter.connections.some((c) => c.id === "local"),
				).toBe(true);
			} finally {
				await secondLaunch?.cleanup();
			}
		} finally {
			// The caller owns the shared dir — clean it up here.
			await rm(sharedUserDataDir, {
				recursive: true,
				force: true,
			}).catch(() => {});
		}
	});
});
