import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { AppMenu } from "./app-menu.js";
import { relayOAuthCallback } from "./oauth-relay.js";
import {
	extractProtocolUrlFromArgv,
	parseProtocolUrl,
	registerProtocol,
} from "./protocol-handler.js";
import { RuntimeOrchestrator } from "./runtime-orchestrator.js";
import { WindowFactory } from "./window-factory.js";
import { WindowRegistry } from "./window-registry.js";

const BACKGROUND_COLOR = "#1F2428";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 3484;
const HEALTH_TIMEOUT_MS = 3_000;

const preloadPath = path.join(import.meta.dirname, "preload.js");
const disconnectedHtmlPath = path.join(import.meta.dirname, "disconnected.html");

// Must run before `app.whenReady()`.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
registerProtocol(app);

// E2E state isolation for integration tests.
if (process.env.KANBAN_DESKTOP_USER_DATA) {
	app.setPath("userData", process.env.KANBAN_DESKTOP_USER_DATA);
}

let isQuitting = false;

const registry = new WindowRegistry();

const orchestrator = new RuntimeOrchestrator({
	host: DEFAULT_HOST,
	port: DEFAULT_PORT,
	healthTimeoutMs: HEALTH_TIMEOUT_MS,
	resolveCliShimPath,
});

const windowFactory = new WindowFactory({
	preloadPath,
	isPackaged: app.isPackaged,
	backgroundColor: BACKGROUND_COLOR,
	disconnectedHtmlPath,
	registry,
	orchestrator,
	isQuitting: () => isQuitting,
	onMenuDirty: () => menu.rebuild(),
});

const menu = new AppMenu({
	registry,
	orchestrator,
	onNewWindow: ({ initialPath }) =>
		windowFactory.create({ projectId: null, initialPath }),
});

// macOS can deliver `open-url` events before the runtime is ready (the app
// was launched *by* a `kanban://` link). Queue any callbacks until the
// runtime URL lands. An array — not a scalar — because nothing prevents the
// OS from delivering multiple links during the startup window (e.g. a user
// kicking off two OAuth flows in quick succession).
const pendingOAuthUrls: string[] = [];

orchestrator.on("url-changed", (url) => {
	if (url) {
		registry.loadUrlInAllWindows(url).catch((err) => {
			console.error(
				"[desktop] loadUrlInAllWindows failed:",
				err instanceof Error ? err.message : err,
			);
		});
		if (pendingOAuthUrls.length > 0) {
			const drained = pendingOAuthUrls.splice(0, pendingOAuthUrls.length);
			for (const pending of drained) handleProtocolUrl(pending);
		}
	}
	menu.rebuild();
});
orchestrator.on("crashed", () => windowFactory.showDisconnectedScreen());

function handleProtocolUrl(raw: string): void {
	const parsed = parseProtocolUrl(raw);
	if (!parsed) {
		// Future routes (deep links into projects, tasks, etc.) will land here
		// before parseProtocolUrl knows about them. A silent return makes that
		// debugging extremely opaque.
		console.warn(`[desktop] Ignoring unrecognized protocol URL: ${raw}`);
		return;
	}
	if (!parsed.isOAuthCallback) {
		console.warn(
			`[desktop] Deep link to ${parsed.pathname} received but no handler is wired for that route: ${raw}`,
		);
		return;
	}

	const runtimeUrl = orchestrator.getUrl();
	if (!runtimeUrl) {
		pendingOAuthUrls.push(raw);
		return;
	}

	const relayTarget = new URL("/kanban-mcp/mcp-oauth-callback", runtimeUrl);
	for (const [key, value] of parsed.searchParams.entries()) {
		relayTarget.searchParams.set(key, value);
	}

	const focusedWindow = registry.getFocused();
	// Late-bind the dialog target: relayOAuthCallback retries up to 3 times
	// with 1s delays (~3s total worst case). The user can switch focus during
	// that window, so the failure dialog should attach to whatever window
	// they're looking at when it actually appears, not to the snapshot we
	// captured at protocol-receive time. The window-restore below still uses
	// the snapshot — that's intentional, the restore is a one-shot reaction
	// to the deep-link arriving and should target the window that received it.
	relayOAuthCallback(relayTarget.toString(), {
		fetch: globalThis.fetch,
		getMainWindow: () => registry.getFocused(),
	}).catch((err) => console.error("[desktop] OAuth relay error:", err));


	if (focusedWindow && !focusedWindow.isDestroyed()) {
		if (focusedWindow.isMinimized()) focusedWindow.restore();
		focusedWindow.show();
		focusedWindow.focus();
	}

}

app.on("open-url", (event, url) => {
	event.preventDefault();
	handleProtocolUrl(url);
});

// Packaged builds spawn the staged shim from `Resources/bin/` (electron-builder
// copies `build/bin/{kanban,kanban.cmd}` there), while dev runs the
// `kanban-dev` shim that re-execs `dist/cli.js` from the repo so HMR / source
// maps work. The two shims have different filenames on purpose so a packaged
// app can never accidentally invoke the dev script.
function resolveCliShimPath(): string {
	if (app.isPackaged) {
		const shimName = process.platform === "win32" ? "kanban.cmd" : "kanban";
		return path.join(process.resourcesPath, "bin", shimName);
	}
	const devShimName =
		process.platform === "win32" ? "kanban-dev.cmd" : "kanban-dev";
	return path.join(import.meta.dirname, "..", "build", "bin", devShimName);
}

ipcMain.on("open-project-window", (_event, projectId: string) => {
	if (typeof projectId === "string" && projectId) {
		windowFactory.create({ projectId });
	}
});

// Tracks an in-flight `orchestrator.restart()` so duplicate IPC pings
// (button-mash, two windows hitting "Restart" simultaneously) collapse into
// a single restart attempt. The orchestrator's own `restartPromise` join
// already serialises concurrent calls, but routing both IPCs through it
// would surface the same failure twice — once per IPC — and pop the error
// dialog twice. The early-return here keeps the user-facing UX coherent.
let activeRestart: Promise<void> | null = null;

ipcMain.on("restart-runtime", () => {
	if (activeRestart) {
		console.log("[desktop] Restart already in progress — ignoring duplicate request.");
		return;
	}
	console.log("[desktop] Restart requested from renderer.");
	activeRestart = orchestrator
		.restart()
		.catch((error) => {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[desktop] Failed to restart runtime: ${msg}`);
			dialog.showErrorBox(
				"Kanban Startup Error",
				`Failed to restart runtime:\n\n${msg}`,
			);
		})
		.finally(() => {
			activeRestart = null;
		});
});


const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	app.on("second-instance", (_event, argv) => {
		const protocolUrl = extractProtocolUrlFromArgv(argv);
		if (protocolUrl) handleProtocolUrl(protocolUrl);

		const focused = registry.getFocused();
		if (focused) {
			if (focused.isMinimized()) focused.restore();
			focused.focus();
		}
	});

	wireAppLifecycle();
}

function wireAppLifecycle(): void {
	app.whenReady().then(async () => {
		// Electron normally creates `userData` itself, but some sandboxed
		// environments (CI image with read-only `~/Library`, locked-down
		// enterprise profiles) need the explicit nudge. Log if it ever fails
		// so a missing-directory bug isn't invisible.
		await mkdir(app.getPath("userData"), { recursive: true }).catch((err) => {
			console.warn(
				"[desktop] mkdir(userData) failed:",
				err instanceof Error ? err.message : err,
			);
		});

		const persistedStates = WindowRegistry.loadPersistedWindows(
			app.getPath("userData"),
		);
		if (persistedStates.length > 0) {
			for (const savedState of persistedStates) {
				windowFactory.create({ projectId: savedState.projectId, savedState });
			}
		} else {
			windowFactory.create();
		}

		menu.rebuild();
		orchestrator.startAppNapPrevention();

		// Register before the async connect() — otherwise a macOS Dock click
		// during the initial health-check window (up to `HEALTH_TIMEOUT_MS`)
		// lands before Electron has any `activate` listener and gets dropped.
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				windowFactory.create();
			} else {
				const focused = registry.getFocused();
				if (focused && !focused.isVisible()) focused.show();
			}
		});

		try {
			await orchestrator.connect();
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			console.error(`[desktop] Failed to start runtime: ${msg}`);
			dialog.showErrorBox(
				"Kanban Startup Error",
				`Failed to start runtime:\n\n${msg}`,
			);
			// The startup-error windows have been created (above) but never
			// got a `url-changed` event, so they're still on Electron's
			// blank `about:blank`. Match the crash-time behavior: load the
			// disconnected screen so users have a visible in-window
			// fallback after dismissing the dialog instead of being stuck
			// staring at a blank shell.
			windowFactory.showDisconnectedScreen();
		}

	});

	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") app.quit();
	});

	app.on("before-quit", async (event) => {
		if (isQuitting) return;
		isQuitting = true;

		registry.saveAllStates(app.getPath("userData"));

		// Unconditional shutdown — must NOT gate on `isOwned()`.
		// `isOwned()` is false during `await manager.start()` (it flips
		// post-await on `setUrl(url, true)`), so a quit mid-spawn would
		// otherwise skip preventDefault, fall through to will-quit, and
		// orphan the child (will-quit's `dispose()` is fire-and-forget).
		// `shutdown()` handles every state: drains connect/restart, sets
		// `terminated`, and lets `startOwnRuntime`'s orphan-cleanup branch
		// kill any post-teardown spawn.
		event.preventDefault();
		try {
			await orchestrator.shutdown();
		} catch (err) {
			console.error(
				"[desktop] Runtime shutdown error during quit:",
				err instanceof Error ? err.message : err,
			);
		} finally {
			// Belt-and-suspenders: shutdown() releases this internally,
			// but a throw before that point would leave it pinned.
			orchestrator.stopAppNapPrevention();
			app.quit();
		}

	});


	// `will-quit` fires during process teardown and Electron does not await
	// promises returned from its handlers. Treat this as best-effort cleanup
	// — graceful shutdown already happened in `before-quit`.
	app.on("will-quit", () => {
		void orchestrator.dispose();
	});
}
