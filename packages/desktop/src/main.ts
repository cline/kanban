/**
 * Electron main process entry point.
 *
 * Responsibilities:
 * - Single instance enforcement via app.requestSingleInstanceLock()
 * - Secure BrowserWindow with strict webPreferences
 * - RuntimeChildManager lifecycle (start, heartbeat, shutdown)
 * - Ephemeral auth token generation + header injection
 * - Custom application menu
 * - macOS App Nap prevention, Dock reactivation
 * - powerMonitor resume health check
 * - Window state persistence to userData/window-state.json
 * - Interrupted tasks notification on restart
 * - kanban:// custom protocol for OAuth deep-links
 */

import {
	BrowserWindow,
	Menu,
	app,
	dialog,
	powerMonitor,
	powerSaveBlocker,
	shell,
} from "electron";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { generateAuthToken, installAuthHeaderInterceptor } from "./auth.js";
import type { RuntimeConfig } from "./ipc-protocol.js";
import {
	extractProtocolUrlFromArgv,
	parseProtocolUrl,
	registerProtocol,
} from "./protocol-handler.js";
import { RuntimeChildManager } from "./runtime-child.js";
import {
	type WindowState,
	loadWindowState,
	saveWindowState,
} from "./window-state.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const BACKGROUND_COLOR = "#1F2428";
const RUNTIME_HEALTH_TIMEOUT_MS = 3_000;

// ---------------------------------------------------------------------------
// Runtime descriptor — published so CLI helper commands can discover the
// desktop-managed runtime as a fallback when the default port is unreachable.
// Path: ~/.cline/kanban/runtime.json
// ---------------------------------------------------------------------------

const DESCRIPTOR_DIR = path.join(homedir(), ".cline", "kanban");
const DESCRIPTOR_PATH = path.join(DESCRIPTOR_DIR, "runtime.json");

async function publishRuntimeDescriptor(url: string, token: string): Promise<void> {
	try {
		await mkdir(DESCRIPTOR_DIR, { recursive: true });
		const descriptor = {
			url,
			authToken: token,
			pid: process.pid,
			updatedAt: new Date().toISOString(),
			source: "desktop",
		};
		await writeFile(DESCRIPTOR_PATH, JSON.stringify(descriptor, null, "\t"), "utf-8");
	} catch {
		// Best effort — if we can't write the descriptor, CLI fallback won't work
		// but the desktop app itself is unaffected.
	}
}

async function clearRuntimeDescriptor(): Promise<void> {
	try {
		await rm(DESCRIPTOR_PATH, { force: true });
	} catch {
		// Best effort.
	}
}

// ---------------------------------------------------------------------------
// Helper: capture BrowserWindow bounds for persistence
// ---------------------------------------------------------------------------

/** Capture the current window bounds/maximized state. */
function captureWindowState(window: BrowserWindow): WindowState {
	const isMaximized = window.isMaximized();
	const bounds = isMaximized ? window.getNormalBounds() : window.getBounds();
	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		isMaximized,
	};
}

// ---------------------------------------------------------------------------
// Interrupted tasks detection
// ---------------------------------------------------------------------------

/**
 * Scan the kanban workspace index for workspaces that have tasks in the
 * "In Progress" column (i.e. tasks that were interrupted by a previous shutdown).
 *
 * This is a best-effort read — errors are silently ignored so the app
 * always starts even if workspace data is missing or corrupt.
 */
async function detectInterruptedTasks(): Promise<{
	count: number;
	workspacePaths: string[];
}> {
	const info = { count: 0, workspacePaths: [] as string[] };
	try {
		// Dynamic import so the main process isn't blocked if the runtime
		// package is unavailable (e.g. first install before build).
		const kanbanState = await import("kanban").catch(() => null);
		if (!kanbanState) return info;

		const listWorkspaceIndexEntries = (kanbanState as Record<string, unknown>)
			.listWorkspaceIndexEntries as
			| (() => Promise<Array<{ repoPath: string }>>)
			| undefined;
		const loadWorkspaceState = (kanbanState as Record<string, unknown>)
			.loadWorkspaceState as
			| ((p: string) => Promise<{
					board: {
						columns: Array<{
							id: string;
							cards: Array<{ id: string }>;
						}>;
					};
			  }>)
			| undefined;

		if (!listWorkspaceIndexEntries || !loadWorkspaceState) return info;

		const entries = await listWorkspaceIndexEntries();
		for (const entry of entries) {
			try {
				const state = await loadWorkspaceState(entry.repoPath);
				const workColumn = state.board.columns.find(
					(c) => c.id === "in_progress",
				);
				const workCards = workColumn?.cards ?? [];
				if (workCards.length > 0) {
					info.count += workCards.length;
					info.workspacePaths.push(entry.repoPath);
				}
			} catch {
				// Skip unreadable workspaces.
			}
		}
	} catch {
		// Runtime modules not available — skip detection.
	}
	return info;
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

/** Build the application menu template. */
function buildMenuTemplate(): Electron.MenuItemConstructorOptions[] {
	const isMac = process.platform === "darwin";

	const appMenu: Electron.MenuItemConstructorOptions = {
		label: app.name,
		submenu: [
			{ role: "about" },
			{ type: "separator" },
			{ role: "services" },
			{ type: "separator" },
			{ role: "hide" },
			{ role: "hideOthers" },
			{ role: "unhide" },
			{ type: "separator" },
			{ role: "quit" },
		],
	};

	const editMenu: Electron.MenuItemConstructorOptions = {
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	};

	const viewMenu: Electron.MenuItemConstructorOptions = {
		label: "View",
		submenu: [
			{ role: "reload" },
			...(!app.isPackaged
				? ([
					{ role: "forceReload" },
					{ role: "toggleDevTools" },
				] as Electron.MenuItemConstructorOptions[])
				: []),
			{ type: "separator" },
			{ role: "resetZoom" },
			{ role: "zoomIn" },
			{ role: "zoomOut" },
			{ type: "separator" },
			{ role: "togglefullscreen" },
			{ type: "separator" },
			{
				label: "Diagnostics",
				click: () => {
					if (mainWindow && !mainWindow.isDestroyed()) {
						mainWindow.webContents.send("open-diagnostics");
					}
				},
			},
		],
	};

	const windowMenu: Electron.MenuItemConstructorOptions = {
		label: "Window",
		submenu: [
			{ role: "minimize" },
			{ role: "zoom" },
			...(isMac
				? [
						{ type: "separator" } as Electron.MenuItemConstructorOptions,
						{ role: "front" } as Electron.MenuItemConstructorOptions,
					]
				: [{ role: "close" } as Electron.MenuItemConstructorOptions]),
		],
	};

	const helpMenu: Electron.MenuItemConstructorOptions = {
		label: "Help",
		submenu: [
			{
				label: "Kanban Documentation",
				click: () => shell.openExternal("https://github.com/cline/kanban"),
			},
			{
				label: "Report Issue",
				click: () =>
					shell.openExternal("https://github.com/cline/kanban/issues"),
			},
		],
	};

	const template: Electron.MenuItemConstructorOptions[] = [];
	if (isMac) template.push(appMenu);
	template.push(editMenu, viewMenu, windowMenu, helpMenu);
	return template;
}

// ---------------------------------------------------------------------------
// Main process state
// ---------------------------------------------------------------------------

/** The single application window. Null until created. */
let mainWindow: BrowserWindow | null = null;

/** The runtime child process manager. */
let runtimeManager: RuntimeChildManager | null = null;

/** The ephemeral auth token for the current session. */
let authToken: string | null = null;

/** The runtime URL once the child process reports ready. */
let runtimeUrl: string | null = null;

/** In-flight runtime restart promise used to deduplicate resume-triggered restarts. */
let runtimeRestartPromise: Promise<void> | null = null;

/** Power save blocker ID to prevent macOS App Nap. -1 if not active. */
let powerSaveBlockerId = -1;

/** Whether `before-quit` has been signalled. */
let isQuitting = false;

app.commandLine.appendSwitch("disable-renderer-backgrounding");

// ---------------------------------------------------------------------------
// kanban:// protocol registration
// ---------------------------------------------------------------------------

// Register the protocol before the app is ready — this is required on
// Windows/Linux so the OS knows to route kanban:// URLs to this app even
// on the very first launch. On macOS the Info.plist declared by
// electron-builder handles association, but we still call the API for
// development builds that don't go through the builder.
registerProtocol(app);

// ---------------------------------------------------------------------------
// Protocol URL handling
// ---------------------------------------------------------------------------

/**
 * Forward a `kanban://` URL to the runtime server's OAuth callback endpoint.
 *
 * When the OS delivers a `kanban://oauth/callback?code=...&state=...` URL,
 * we translate it into a fetch against the runtime's HTTP server so that the
 * existing server-side OAuth exchange logic can complete the flow.
 *
 * This keeps the OAuth completion logic entirely within the runtime server —
 * the Electron shell only acts as a relay.
 */
function handleProtocolUrl(raw: string): void {
	const parsed = parseProtocolUrl(raw);
	if (!parsed) {
		console.warn(`[desktop] Ignoring invalid protocol URL: ${raw}`);
		return;
	}

	console.log(
		`[desktop] Protocol URL received: path=${parsed.pathname} isOAuth=${parsed.isOAuthCallback}`,
	);

	if (!parsed.isOAuthCallback) {
		// Future: handle other kanban:// paths here.
		return;
	}

	if (!runtimeUrl) {
		console.warn(
			"[desktop] Received OAuth callback but runtime is not ready — dropping.",
		);
		return;
	}

	// Relay the OAuth parameters to the runtime server's MCP OAuth callback
	// endpoint so the existing server-side logic can complete the exchange.
	const relayUrl = new URL("/kanban-mcp/mcp-oauth-callback", runtimeUrl);
	for (const [key, value] of parsed.searchParams.entries()) {
		relayUrl.searchParams.set(key, value);
	}

	fetch(relayUrl.toString(), {
		headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
	})
		.then((res) => {
			if (!res.ok) {
				console.error(
					`[desktop] OAuth relay failed: ${res.status} ${res.statusText}`,
				);
			}
		})
		.catch((err) => {
			console.error("[desktop] OAuth relay error:", err);
		});

	// Bring the window to the foreground so the user sees the result.
	if (mainWindow && !mainWindow.isDestroyed()) {
		if (mainWindow.isMinimized()) mainWindow.restore();
		mainWindow.show();
		mainWindow.focus();
	}
}

// macOS: the OS delivers the URL via the open-url event.
// This must be registered before app.whenReady() to catch URLs that arrive
// before the app finishes launching.
app.on("open-url", (event, url) => {
	event.preventDefault();
	handleProtocolUrl(url);
});

// ---------------------------------------------------------------------------
// Single instance lock
// ---------------------------------------------------------------------------

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
	app.quit();
} else {
	// Windows/Linux: when a second instance is launched with a kanban:// URL,
	// the OS passes the URL as a command-line argument. The second instance
	// forwards it here via the second-instance event, then exits.
	app.on("second-instance", (_event, argv) => {
		const protocolUrl = extractProtocolUrlFromArgv(argv);
		if (protocolUrl) {
			handleProtocolUrl(protocolUrl);
		}

		if (mainWindow) {
			if (mainWindow.isMinimized()) mainWindow.restore();
			mainWindow.focus();
		}
	});
}

// ---------------------------------------------------------------------------
// Window creation
// ---------------------------------------------------------------------------

function createMainWindow(): BrowserWindow {
	const savedState = loadWindowState(app.getPath("userData"));

	const window = new BrowserWindow({
		x: savedState?.x,
		y: savedState?.y,
		width: savedState?.width ?? DEFAULT_WIDTH,
		height: savedState?.height ?? DEFAULT_HEIGHT,
		minWidth: MIN_WIDTH,
		minHeight: MIN_HEIGHT,
		title: "Kanban",
		backgroundColor: BACKGROUND_COLOR,
		show: false,
		webPreferences: {
			preload: path.join(import.meta.dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			webSecurity: true,
			devTools: !app.isPackaged,
		},
	});

	if (savedState?.isMaximized) {
		window.maximize();
	}

	// Show once content is ready to avoid a white flash.
	window.once("ready-to-show", () => window.show());

	// Persist window state on move/resize/maximize/unmaximize.
	const persist = () => {
		if (window.isDestroyed()) return;
		saveWindowState(app.getPath("userData"), captureWindowState(window));
	};

	window.on("resize", persist);
	window.on("move", persist);
	window.on("maximize", persist);
	window.on("unmaximize", persist);

	// Prevent navigation to external URLs — keep the renderer locked to the runtime.
	window.webContents.on("will-navigate", (event, url) => {
		if (runtimeUrl && !url.startsWith(runtimeUrl)) {
			event.preventDefault();
		}
	});

	// Block new-window requests (e.g. target="_blank") — open in the system browser.
	window.webContents.setWindowOpenHandler(({ url }) => {
		shell.openExternal(url);
		return { action: "deny" };
	});

	// On macOS, intercept the close to hide-to-dock unless the user is quitting.
	window.on("close", (event) => {
		if (process.platform === "darwin" && !isQuitting) {
			event.preventDefault();
			window.hide();
		}
	});

	return window;
}

// ---------------------------------------------------------------------------
// Runtime child process lifecycle
// ---------------------------------------------------------------------------

async function startRuntimeChild(): Promise<string> {
	authToken = generateAuthToken();

	const childScriptPath = path.join(import.meta.dirname, "runtime-child-entry.js");

	runtimeManager = new RuntimeChildManager({
		childScriptPath,
		shutdownTimeoutMs: 5_000,
		heartbeatTimeoutMs: 15_000,
		maxRestarts: 3,
		restartDecayMs: 300_000,
	});

	// When the runtime crashes and auto-restarts, re-wire the auth interceptor
	// and reload the window.
	runtimeManager.on("ready", (url: string) => {
		runtimeUrl = url;
		// Publish descriptor so CLI helpers can discover this runtime.
		publishRuntimeDescriptor(url, authToken!);
		if (mainWindow && !mainWindow.isDestroyed()) {
			installAuthHeaderInterceptor(
				mainWindow.webContents.session,
				authToken!,
				url,
			);
			mainWindow.loadURL(url);
		}
	});

	runtimeManager.on("error", (message: string) => {
		console.error(`[desktop] Runtime error: ${message}`);
		if (mainWindow && !mainWindow.isDestroyed()) {
			dialog.showErrorBox(
				"Kanban Runtime Error",
				`The runtime process encountered an error:\n\n${message}`,
			);
		}
	});

	runtimeManager.on(
		"crashed",
		(exitCode: number | null, signal: string | null) => {
			console.error(
				`[desktop] Runtime crashed (code=${exitCode}, signal=${signal})`,
			);
		},
	);

	// Compute the absolute path to the bundled CLI shim.
	// Packaged:  <app>/Contents/Resources/bin/kanban (macOS)
	//            <app>/resources/bin/kanban.cmd (Windows)
	//            <app>/resources/bin/kanban (Linux)
	// Dev mode:  <desktop-pkg>/build/bin/kanban (a dev shim)
	let kanbanCliCommand: string;
	if (app.isPackaged) {
		const shimName = process.platform === "win32" ? "kanban.cmd" : "kanban";
		kanbanCliCommand = path.join(process.resourcesPath, "bin", shimName);
	} else {
		kanbanCliCommand = path.join(import.meta.dirname, "..", "build", "bin", "kanban-dev");
	}

	const config: RuntimeConfig = {
		host: "127.0.0.1",
		port: "auto",
		authToken,
		kanbanCliCommand,
	};

	return runtimeManager.start(config);
}

async function isRuntimeHealthy(): Promise<boolean> {
	if (!runtimeUrl) {
		return false;
	}

	const healthUrl = new URL("/api/health", runtimeUrl);
	const abortController = new AbortController();
	const timeout = setTimeout(() => {
		abortController.abort();
	}, RUNTIME_HEALTH_TIMEOUT_MS);

	try {
		const response = await fetch(healthUrl, {
			signal: abortController.signal,
			headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		clearTimeout(timeout);
	}
}

async function restartRuntimeChild(): Promise<void> {
	if (runtimeRestartPromise) {
		await runtimeRestartPromise;
		return;
	}

	runtimeRestartPromise = (async () => {
		const currentRuntimeManager = runtimeManager;
		if (currentRuntimeManager?.running) {
			try {
				await currentRuntimeManager.shutdown();
			} catch (error) {
				console.warn(
					"[desktop] Runtime shutdown during restart failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}
		if (currentRuntimeManager) {
			await currentRuntimeManager.dispose().catch(() => {});
		}
		runtimeManager = null;
		runtimeUrl = null;
		await startRuntimeChild();
	})().finally(() => {
		runtimeRestartPromise = null;
	});

	await runtimeRestartPromise;
}

// ---------------------------------------------------------------------------
// App Nap prevention (macOS)
// ---------------------------------------------------------------------------

function startAppNapPrevention(): void {
	if (process.platform !== "darwin") return;
	if (powerSaveBlockerId !== -1) return;
	// "prevent-app-suspension" keeps the app active even when hidden,
	// ensuring the runtime child process keeps running.
	powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
}

function stopAppNapPrevention(): void {
	if (powerSaveBlockerId === -1) return;
	powerSaveBlocker.stop(powerSaveBlockerId);
	powerSaveBlockerId = -1;
}

// ---------------------------------------------------------------------------
// powerMonitor: health check on resume from sleep
// ---------------------------------------------------------------------------

function setupPowerMonitorHealthCheck(): void {
	powerMonitor.on("resume", () => {
		// After waking from sleep, the runtime child may have stalled.
		// Send a heartbeat-ack immediately, then verify the HTTP server is
		// still responsive. If health probing fails, restart the child.
		if (runtimeManager?.running) {
			runtimeManager.send({ type: "heartbeat-ack" });
			void isRuntimeHealthy().then(async (healthy) => {
				if (healthy) {
					return;
				}
				console.warn("[desktop] Runtime health check failed after resume; restarting runtime.");
				try {
					await restartRuntimeChild();
				} catch (error) {
					console.error(
						"[desktop] Failed to restart runtime after resume:",
						error instanceof Error ? error.message : error,
					);
				}
			});
		}
	});
}

// ---------------------------------------------------------------------------
// Interrupted tasks notification
// ---------------------------------------------------------------------------

async function showInterruptedTasksToast(): Promise<void> {
	try {
		const info = await detectInterruptedTasks();
		if (info.count === 0) return;

		const plural = info.count === 1 ? "task was" : "tasks were";
		const workspaces =
			info.workspacePaths.length <= 3
				? info.workspacePaths.join("\n")
				: `${info.workspacePaths.slice(0, 3).join("\n")}\n\u2026and ${info.workspacePaths.length - 3} more`;

		dialog.showMessageBox({
			type: "info",
			title: "Interrupted Tasks",
			message: `${info.count} ${plural} interrupted during the last session.`,
			detail: workspaces
				? `Affected workspaces:\n${workspaces}`
				: undefined,
			buttons: ["OK"],
		});
	} catch {
		// Best-effort — never block app startup.
	}
}

// ---------------------------------------------------------------------------
// Application lifecycle
// ---------------------------------------------------------------------------

if (gotTheLock) {
	app.whenReady().then(async () => {
		// Ensure userData directory exists for window-state persistence.
		await mkdir(app.getPath("userData"), { recursive: true }).catch(
			() => {},
		);

		// Create the main window.
		mainWindow = createMainWindow();

		// Build and apply the application menu.
		const menu = Menu.buildFromTemplate(buildMenuTemplate());
		Menu.setApplicationMenu(menu);

		// Prevent macOS App Nap.
		startAppNapPrevention();

		// Start the runtime child process.
		try {
			const url = await startRuntimeChild();
			runtimeUrl = url;

			// Publish descriptor so CLI helpers can discover this runtime.
			await publishRuntimeDescriptor(url, authToken!);

			// Install the auth header interceptor on the window's session.
			installAuthHeaderInterceptor(
				mainWindow.webContents.session,
				authToken!,
				url,
			);

			// Load the runtime UI.
			await mainWindow.loadURL(url);

			// Check for interrupted tasks from a previous session (non-blocking).
			showInterruptedTasksToast();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			console.error(`[desktop] Failed to start runtime: ${message}`);
			dialog.showErrorBox(
				"Kanban Startup Error",
				`Failed to start the Kanban runtime:\n\n${message}`,
			);
		}

		// Register power monitor health check.
		setupPowerMonitorHealthCheck();

		// macOS: re-create window when dock icon is clicked and no windows exist.
		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				mainWindow = createMainWindow();
				if (runtimeUrl) {
					installAuthHeaderInterceptor(
						mainWindow.webContents.session,
						authToken!,
						runtimeUrl,
					);
					mainWindow.loadURL(runtimeUrl);
				}
			} else if (mainWindow && !mainWindow.isVisible()) {
				mainWindow.show();
			}
		});
	});

	// Quit when all windows are closed (except on macOS where apps stay in
	// the dock until the user explicitly quits with Cmd+Q).
	app.on("window-all-closed", () => {
		if (process.platform !== "darwin") {
			app.quit();
		}
	});

	app.on("before-quit", async (event) => {
		if (isQuitting) return;
		isQuitting = true;

		// Persist final window state.
		if (mainWindow && !mainWindow.isDestroyed()) {
			saveWindowState(
				app.getPath("userData"),
				captureWindowState(mainWindow),
			);
		}

		// If the runtime is running, prevent the default quit, shut down
		// the child process gracefully, then quit for real.
		if (runtimeManager?.running) {
			event.preventDefault();
			try {
				await runtimeManager.shutdown();
			} catch (err) {
				console.error(
					"[desktop] Runtime shutdown error:",
					err instanceof Error ? err.message : err,
				);
			}
			stopAppNapPrevention();
			app.quit();
		} else {
			stopAppNapPrevention();
		}
	});

	app.on("will-quit", async () => {
		// Clear the runtime descriptor so CLI helpers don't try to connect
		// to a runtime that is shutting down.
		await clearRuntimeDescriptor();

		// Final cleanup — dispose the runtime manager to remove all listeners.
		if (runtimeManager) {
			await runtimeManager.dispose().catch(() => {});
			runtimeManager = null;
		}
	});
}
