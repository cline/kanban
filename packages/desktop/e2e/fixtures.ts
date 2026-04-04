/**
 * E2E test fixture — reusable harness for all Electron E2E specs.
 *
 * Exports a single `launchDesktopApp()` function that performs all startup,
 * readiness-polling, and cleanup necessary to drive the real desktop app
 * under Playwright.
 *
 * All helpers are intentionally co-located in this file until reuse across
 * multiple fixture files clearly justifies extraction.
 */

import { type ElectronApplication, type Page, _electron as electron } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface LaunchedDesktopApp {
	electronApp: ElectronApplication;
	page: Page;
	runtimeUrl: string;
	userDataDir: string;
	runtimeDescriptorDir: string;
	cleanup: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path to the packages/desktop directory. */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DESKTOP_PKG_DIR = resolve(__dirname, "..");

/** Maximum time (ms) to wait for the runtime to become healthy. */
const RUNTIME_READY_TIMEOUT_MS = 45_000;

/** Polling interval (ms) when waiting for runtime readiness. */
const RUNTIME_READY_POLL_MS = 500;

/** Maximum time (ms) to wait for the runtime URL to be discoverable. */
const RUNTIME_URL_TIMEOUT_MS = 30_000;

/** Polling interval (ms) when waiting for the runtime URL. */
const RUNTIME_URL_POLL_MS = 300;

// ---------------------------------------------------------------------------
// Step 1 — ensureDesktopBuild
// ---------------------------------------------------------------------------

/**
 * Verify that **both** `dist/main.js` and `dist/preload.js` exist.
 *
 * If either is missing the TypeScript / esbuild build is triggered
 * automatically.  This guards against the case where `tsc` succeeds but the
 * esbuild preload bundle step fails — treating `dist/main.js` alone as
 * sufficient would leave the app broken at runtime.
 */
function ensureDesktopBuild(): void {
	const mainJs = join(DESKTOP_PKG_DIR, "dist", "main.js");
	const preloadJs = join(DESKTOP_PKG_DIR, "dist", "preload.js");

	if (existsSync(mainJs) && existsSync(preloadJs)) {
		return;
	}

	console.log("[e2e:fixture] dist/main.js or dist/preload.js missing — running build:ts …");

	try {
		execSync("npm run build:ts", {
			cwd: DESKTOP_PKG_DIR,
			stdio: "inherit",
			timeout: 120_000,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`[e2e:fixture] Failed to build packages/desktop. ` +
			`Ensure 'npm run build:ts' succeeds before running E2E tests.\n\n${message}`,
		);
	}

	// Verify build output after running the command.
	if (!existsSync(mainJs)) {
		throw new Error("[e2e:fixture] dist/main.js still missing after build:ts — check tsc output.");
	}
	if (!existsSync(preloadJs)) {
		throw new Error("[e2e:fixture] dist/preload.js still missing after build:ts — check esbuild preload bundle output.");
	}
}

// ---------------------------------------------------------------------------
// Step 2 — ensureDesktopRuntimeDependencies
// ---------------------------------------------------------------------------

/**
 * Confirm the `kanban` package dependency expected by packages/desktop is
 * resolvable.  If root-built runtime assets are needed but the package cannot
 * be found, fail with an actionable message.
 */
function ensureDesktopRuntimeDependencies(): void {
	const kanbanPkgDir = join(DESKTOP_PKG_DIR, "node_modules", "kanban");

	if (!existsSync(kanbanPkgDir)) {
		throw new Error(
			"[e2e:fixture] The 'kanban' package is not installed in packages/desktop/node_modules.\n" +
			"Run `npm install` from the repository root (or `npm install` inside packages/desktop/) " +
			"to resolve dependencies.\n" +
			"If you recently rebuilt the root kanban package, you may also need to re-pack it:\n" +
			"  1. npm pack   (in the repo root)\n" +
			"  2. npm install  (in packages/desktop/)",
		);
	}

	// Verify that the runtime-start subpath export is resolvable.
	const runtimeStartEntry = join(kanbanPkgDir, "dist", "runtime-start.js");
	if (!existsSync(runtimeStartEntry)) {
		throw new Error(
			"[e2e:fixture] The 'kanban' package is installed but dist/runtime-start.js is missing.\n" +
			"The root kanban package may need to be rebuilt:\n" +
			"  1. npm run build  (in the repo root)\n" +
			"  2. npm pack && npm install  (in packages/desktop/)",
		);
	}
}

// ---------------------------------------------------------------------------
// Steps 3 & 4 — createTempUserDataDir / createTempRuntimeDescriptorDir
// ---------------------------------------------------------------------------

/**
 * Create an isolated temporary directory for Electron `userData`.
 * Each E2E test run gets its own directory to prevent cross-contamination.
 */
async function createTempUserDataDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "kanban-e2e-userdata-"));
}

/**
 * Create an isolated temporary directory for the runtime descriptor file.
 * This prevents E2E runs from clobbering (or reading) the developer's real
 * `~/.cline/kanban/runtime.json`.
 */
async function createTempRuntimeDescriptorDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "kanban-e2e-descriptor-"));
}

// ---------------------------------------------------------------------------
// Step 7 — waitForRuntimeUrl
// ---------------------------------------------------------------------------

/**
 * Discover the runtime URL that the Electron renderer has navigated to.
 *
 * **Strategy:**
 * 1. Try `page.url()` — if the renderer has already navigated away from
 *    `about:blank` the URL is the runtime origin.
 * 2. Fall back to main-process introspection via `electronApp.evaluate()`
 *    to read the URL from the first BrowserWindow's webContents.
 *
 * Polls until a valid URL is found or `RUNTIME_URL_TIMEOUT_MS` elapses.
 */
async function waitForRuntimeUrl(
	page: Page,
	electronApp: ElectronApplication,
): Promise<string> {
	const deadline = Date.now() + RUNTIME_URL_TIMEOUT_MS;

	while (Date.now() < deadline) {
		// Strategy 1: check the renderer URL.
		const rendererUrl = page.url();
		if (rendererUrl && rendererUrl !== "about:blank" && rendererUrl.startsWith("http")) {
			return new URL(rendererUrl).origin;
		}

		// Strategy 2: introspect the main process.
		try {
			const mainProcessUrl: string | null = await electronApp.evaluate(
				async ({ BrowserWindow }) => {
					const windows = BrowserWindow.getAllWindows();
					if (windows.length === 0) return null;
					const url = windows[0].webContents.getURL();
					if (url && url !== "about:blank" && url.startsWith("http")) {
						return new URL(url).origin;
					}
					return null;
				},
			);
			if (mainProcessUrl) {
				return mainProcessUrl;
			}
		} catch {
			// Main-process evaluation can fail transiently — retry.
		}

		await sleep(RUNTIME_URL_POLL_MS);
	}

	throw new Error(
		`[e2e:fixture] Timed out after ${RUNTIME_URL_TIMEOUT_MS}ms waiting for the runtime URL. ` +
		"The Electron app may have failed to start the runtime child process.",
	);
}

// ---------------------------------------------------------------------------
// Step 8 — waitForRuntimeReady
// ---------------------------------------------------------------------------

/**
 * Poll the runtime's `/api/health` endpoint until it responds with a 200.
 *
 * **Important:** `firstWindow()` resolving does NOT mean the runtime HTTP
 * server is ready — the child process starts asynchronously, and the renderer
 * may be showing a loading screen or `about:blank`.
 *
 * We use `/api/health` because it is always unauthenticated (see
 * `src/server/auth-middleware.ts`) and returns `{ ok: true, version: "…" }`.
 */
async function waitForRuntimeReady(
	page: Page,
	runtimeUrl: string,
): Promise<void> {
	const healthUrl = `${runtimeUrl}/api/health`;
	const deadline = Date.now() + RUNTIME_READY_TIMEOUT_MS;

	while (Date.now() < deadline) {
		try {
			// Use the renderer context to make the fetch so it goes through
			// the same network stack as the real app.
			const ok = await page.evaluate(async (url: string) => {
				try {
					const res = await fetch(url, { cache: "no-store" });
					return res.ok;
				} catch {
					return false;
				}
			}, healthUrl);

			if (ok) {
				return;
			}
		} catch {
			// page.evaluate can fail if the page is navigating — retry.
		}

		await sleep(RUNTIME_READY_POLL_MS);
	}

	throw new Error(
		`[e2e:fixture] Timed out after ${RUNTIME_READY_TIMEOUT_MS}ms waiting for ` +
		`the runtime to become healthy. Polled: ${healthUrl}`,
	);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Step 9 — cleanup helper factory
// ---------------------------------------------------------------------------

/**
 * Build a cleanup function that:
 * 1. Closes the Electron application (ignoring errors if already closed).
 * 2. Removes the temporary userData and runtimeDescriptor directories.
 *
 * Uses try/catch internally so partial failures never prevent the remaining
 * cleanup steps from executing.
 */
function buildCleanup(
	electronApp: ElectronApplication,
	userDataDir: string,
	runtimeDescriptorDir: string,
	/** When `true` the caller owns `userDataDir` — don't delete it. */
	skipUserDataCleanup = false,
): () => Promise<void> {
	return async () => {
		// Close the Electron app first — this triggers the before-quit /
		// will-quit lifecycle which shuts down the runtime child process.
		try {
			await electronApp.close();
		} catch {
			// Already closed or crashed — that's fine.
		}

		// Remove temp directories.  `force: true` so missing dirs don't
		// cause errors (e.g. if cleanup runs twice).
		if (!skipUserDataCleanup) {
			try {
				await rm(userDataDir, { recursive: true, force: true });
			} catch {
				console.warn(`[e2e:fixture] Failed to remove temp userDataDir: ${userDataDir}`);
			}
		}

		try {
			await rm(runtimeDescriptorDir, { recursive: true, force: true });
		} catch {
			console.warn(`[e2e:fixture] Failed to remove temp runtimeDescriptorDir: ${runtimeDescriptorDir}`);
		}
	};
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Launch the full Kanban desktop app via Playwright's Electron support and
 * wait until the embedded runtime HTTP server is healthy.
 *
 * Returns handles to the Electron app, the first renderer page, the
 * discovered runtime URL, paths to the isolated temp directories, and a
 * `cleanup()` function that **must** be called when the test is done
 * (typically in `afterAll` / `afterEach`).
 *
 * ---
 *
 * ### Step 10 — Orphaned-process fallback strategy (future hardening)
 *
 * If a test runner is killed (SIGKILL, OOM, CI timeout) the Electron
 * process and its runtime child may be left running.  Planned mitigations:
 *
 * 1. **Global teardown** — `playwright.config.ts` can declare a
 *    `globalTeardown` script that reads a PID file written during launch
 *    and sends SIGTERM / tree-kill to any surviving processes.
 *
 * 2. **PID-based cleanup** — `launchDesktopApp()` can write the Electron
 *    PID to `<tmpdir>/kanban-e2e-<run>.pid`.  A pre-test hook or CI step
 *    can scan for stale PID files and kill matching processes.
 *
 * 3. **Process group** — on POSIX, launch Electron in its own process
 *    group (`detached: false` with a `setsid` wrapper) so
 *    `kill -TERM -<pgid>` cleans the whole tree.
 *
 * These are documented here for implementors of the global-teardown task.
 */

/**
 * Options for customising a `launchDesktopApp()` invocation.
 *
 * All fields are optional — the defaults match the original zero-argument
 * behaviour (fresh temp dirs that are cleaned up automatically).
 */
export interface LaunchDesktopAppOptions {
	/**
	 * When provided, use this directory as the Electron `userData` path
	 * instead of creating a fresh temp directory.
	 *
	 * The caller is responsible for creating the directory beforehand
	 * and cleaning it up after the test.  The built-in cleanup function
	 * will **not** delete a caller-supplied userDataDir.
	 */
	userDataDir?: string;
}

export async function launchDesktopApp(
	options?: LaunchDesktopAppOptions,
): Promise<LaunchedDesktopApp> {
	// Step 1 — ensure build artifacts exist.
	ensureDesktopBuild();

	// Step 2 — ensure runtime dependencies are resolvable.
	ensureDesktopRuntimeDependencies();

	// Step 3 — create isolated temp userData dir (or use the caller's).
	const callerOwnedUserData = !!options?.userDataDir;
	const userDataDir = options?.userDataDir ?? (await createTempUserDataDir());

	// Step 4 — create isolated temp runtime descriptor dir.
	const runtimeDescriptorDir = await createTempRuntimeDescriptorDir();

	let electronApp: ElectronApplication | undefined;

	try {
		// Step 5 — launch Electron via Playwright.
		//
		// Build a sanitised copy of the environment.  When the test runner
		// itself is launched from an Electron-based IDE (e.g. Cline), the
		// `ELECTRON_RUN_AS_NODE` env var is inherited and forces the
		// Electron binary into plain Node.js mode — which breaks
		// `import … from "electron"` in the main process.  Stripping it
		// here ensures Playwright-launched Electron always initialises as
		// a real desktop app.
		const launchEnv: Record<string, string> = {
			...process.env as Record<string, string>,
			KANBAN_DESKTOP_USER_DATA: userDataDir,
			KANBAN_DESKTOP_RUNTIME_DESCRIPTOR_DIR: runtimeDescriptorDir,
			NODE_ENV: "development",
		};
		delete launchEnv.ELECTRON_RUN_AS_NODE;

		electronApp = await electron.launch({
			args: ["dist/main.js"],
			cwd: DESKTOP_PKG_DIR,
			env: launchEnv,
		});

		// Step 6 — wait for the first BrowserWindow.
		const page = await electronApp.firstWindow();

		// Step 7 — discover the runtime URL.
		const runtimeUrl = await waitForRuntimeUrl(page, electronApp);

		// Step 8 — wait until the runtime HTTP server is healthy.
		await waitForRuntimeReady(page, runtimeUrl);

		// Step 9 — build the cleanup function.
		const cleanup = buildCleanup(
			electronApp,
			userDataDir,
			runtimeDescriptorDir,
			callerOwnedUserData,
		);

		return {
			electronApp,
			page,
			runtimeUrl,
			userDataDir,
			runtimeDescriptorDir,
			cleanup,
		};
	} catch (error) {
		// If anything goes wrong during setup, ensure we don't leak
		// processes or temp directories.
		if (electronApp) {
			try {
				await electronApp.close();
			} catch {
				// Best effort.
			}
		}

		await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
		await rm(runtimeDescriptorDir, { recursive: true, force: true }).catch(() => {});

		throw error;
	}
}
