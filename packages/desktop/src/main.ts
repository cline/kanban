/**
 * Electron main process entry point.
 *
 * Responsibilities:
 * - Single instance enforcement via app.requestSingleInstanceLock()
 * - Secure BrowserWindow with strict webPreferences
 * - RuntimeChildManager lifecycle (start, heartbeat, shutdown)
 * - Ephemeral auth token generation + header injection
 * - Custom application menu
 * - macOS App Nap / Linux suspend prevention, Dock reactivation
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
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { installAuthHeaderInterceptor } from "./auth.js";
import { ConnectionManager } from "./connection-manager.js";
import { installConnectionMenu } from "./connection-menu.js";
import { ConnectionStore } from "./connection-store.js";
import {
	advanceBootPhase,
	recordBootFailure,
	resetBootState,
} from "./desktop-boot-state.js";
import { runDesktopPreflight } from "./desktop-preflight.js";
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
import {
	clearRuntimeDescriptor,
	evaluateDescriptorTrust,
	writeRuntimeDescriptor,
} from "kanban";

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
// Desktop session identity — unique per app launch, used to detect stale
// descriptors left behind by a prior desktop session that crashed.
// ---------------------------------------------------------------------------

const desktopSessionId: string = randomUUID();

// ---------------------------------------------------------------------------
// Runtime descriptor helpers — delegate to the shared implementation in
// src/core/runtime-descriptor.ts so desktop doesn't duplicate path
// constants or write logic.
// ---------------------------------------------------------------------------

async function publishRuntimeDescriptor(url: string, token: string): Promise<void> {
	try {
		await writeRuntimeDescriptor({
			url,
			authToken: token,
			pid: process.pid,
			updatedAt: new Date().toISOString(),
			source: "desktop",
			desktopSessionId,
		});
	} catch {
		// Best effort — if we can't write the descriptor, CLI fallback won't work
		// but the desktop app itself is unaffected.
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
 * TODO: Re-implement once the kanban package can be statically imported from
 * the desktop main process. The previous implementation used a dynamic
 * `await import("kanban")` which violates the project's no-inline-import rule.
 */
async function detectInterruptedTasks(): Promise<{
	count: number;
	workspacePaths: string[];
}> {
	return { count: 0, workspacePaths: [] };
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

/** The connection store — persists saved connections to disk. */
let connectionStore: ConnectionStore | null = null;

/** The connection manager — orchestrates switching between connections. */
let connectionManager: ConnectionManager | null = null;

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

/**
 * Create the RuntimeChildManager and wire its event handlers.
 *
 * The returned manager is NOT started yet — the ConnectionManager will
 * start it when the active connection is "local".
 */
function createRuntimeChildManager(): RuntimeChildManager {
	const childScriptPath = path.join(import.meta.dirname, "runtime-child-entry.js");

	const manager = new RuntimeChildManager({
		childScriptPath,
		shutdownTimeoutMs: 5_000,
		heartbeatTimeoutMs: 15_000,
		maxRestarts: 3,
		restartDecayMs: 300_000,
	});

	// When the runtime reports ready (initial start or auto-restart after crash),
	// update local state and publish the descriptor for CLI helpers.
	//
	// NOTE: We do NOT install auth interceptors or call loadURL here — that is
	// ConnectionManager's responsibility (switchToLocal handles both).
	// Doing it here too causes double-registration of onBeforeSendHeaders and
	// double loadURL, which race and break auth.
	manager.on("ready", (url: string) => {
		runtimeUrl = url;
		authToken = connectionManager?.getLocalAuthToken() ?? authToken;
		// Publish descriptor so CLI helpers can discover this runtime.
		publishRuntimeDescriptor(url, authToken!);
	});

	manager.on("error", (message: string) => {
		console.error(`[desktop] Runtime error: ${message}`);
		if (mainWindow && !mainWindow.isDestroyed()) {
			dialog.showErrorBox(
				"Kanban Runtime Error",
				`The runtime process encountered an error:\n\n${message}`,
			);
		}
	});

	manager.on(
		"crashed",
		(exitCode: number | null, signal: string | null) => {
			console.error(
				`[desktop] Runtime crashed (code=${exitCode}, signal=${signal})`,
			);
		},
	);

	return manager;
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
		resetBootState();
		advanceBootPhase("preflight");

		if (!connectionManager) {
			console.error("[desktop] Cannot restart: connectionManager is not initialized.");
			recordBootFailure("UNKNOWN_STARTUP_FAILURE", "ConnectionManager unavailable during restart");
			return;
		}

		try {
			await connectionManager.shutdown();
		} catch {
			// best-effort
		}

		advanceBootPhase("initialize-connections");
		await connectionManager.initialize();
		advanceBootPhase("ready");
	})().finally(() => {
		runtimeRestartPromise = null;
	});

	await runtimeRestartPromise;
}

// ---------------------------------------------------------------------------
// App Nap / suspend prevention (macOS + Linux)
// ---------------------------------------------------------------------------
// On macOS, "prevent-app-suspension" stops App Nap from throttling the
// runtime child when the window is hidden.
// On Linux, the same Electron API prevents the desktop environment from
// suspending the process (e.g. via systemd-logind idle handling).
// On Windows this is unnecessary — Windows does not suspend GUI processes
// that hold open child processes.

function startAppNapPrevention(): void {
	if (process.platform !== "darwin" && process.platform !== "linux") return;
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
		// Only relevant when the active connection is local (child process).
		const activeId = connectionManager?.getActiveConnectionId() ?? "local";
		if (activeId !== "local") return;

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

// ---------------------------------------------------------------------------
// Helper: rebuild the connection menu (called when connection changes).
// ---------------------------------------------------------------------------

function rebuildConnectionMenu(): void {
	if (!mainWindow || !connectionStore || !connectionManager) return;
	installConnectionMenu({
		store: connectionStore,
		manager: connectionManager,
		window: mainWindow,
	});
}

// ---------------------------------------------------------------------------

if (gotTheLock) {
	app.whenReady().then(async () => {
		// ── E2E state isolation ───────────────────────────────────────────
		// When KANBAN_DESKTOP_USER_DATA is set, override Electron's userData
		// path so that E2E tests use an isolated directory for connections.json,
		// window-state.json, etc. This MUST happen before any app.getPath('userData')
		// call. No-op when the env var is absent.
		if (process.env.KANBAN_DESKTOP_USER_DATA) {
			app.setPath("userData", process.env.KANBAN_DESKTOP_USER_DATA);
		}

		// ── preflight ─────────────────────────────────────────────────────
		advanceBootPhase("preflight");

		// Ensure userData directory exists for window-state persistence.
		await mkdir(app.getPath("userData"), { recursive: true }).catch(
			() => {},
		);

		// Run preflight checks to ensure critical resources exist.
		const preloadPath = path.join(import.meta.dirname, "preload.js");
		const childScriptPath = path.join(import.meta.dirname, "runtime-child-entry.js");
		let cliShimPath: string;
		if (app.isPackaged) {
			const shimName = process.platform === "win32" ? "kanban.cmd" : "kanban";
			cliShimPath = path.join(process.resourcesPath, "bin", shimName);
		} else {
			cliShimPath = path.join(import.meta.dirname, "..", "build", "bin", "kanban-dev");
		}

		const preflightResult = runDesktopPreflight({
			preloadPath,
			childScriptPath,
			cliShimPath,
			isPackaged: app.isPackaged,
		});

		if (!preflightResult.ok) {
			const details = preflightResult.failures
				.map((f) => `[${f.code}] ${f.message}`)
				.join("\n\n");
			recordBootFailure("PREFLIGHT_FAILED", details);
			dialog.showErrorBox(
				"Kanban Startup Error",
				`Startup preflight failed — critical resources are missing:\n\n${details}`,
			);
			return;
		}

		// ── descriptor trust check ───────────────────────────────────────
		// Evaluate whether a leftover runtime descriptor from a prior session
		// should be trusted.  Stale descriptors with dead PIDs are cleaned up
		// automatically; orphaned desktop descriptors are logged as warnings.
		const trustResult = await evaluateDescriptorTrust(desktopSessionId);

		switch (trustResult.reason) {
			case "pid-dead":
				console.log(
					"[desktop] Cleaned up stale descriptor from prior session (PID was dead).",
				);
				break;
			case "prior-desktop-session":
				console.warn(
					"[desktop] Found descriptor from a prior desktop session with a live PID — " +
						"ignoring and starting a fresh runtime.",
				);
				break;
			case "terminal-owned":
				console.log(
					"[desktop] Found terminal-owned descriptor — " +
						"desktop will start its own runtime on a separate port.",
				);
				break;
			case "current-session":
				// Should not normally happen during initial startup, but harmless.
				console.log("[desktop] Descriptor already belongs to this session.");
				break;
			case "no-descriptor":
				// Nothing on disk — expected for a clean first launch.
				break;
		}

		// ── create-window ─────────────────────────────────────────────────
		advanceBootPhase("create-window");

		// Create the main window.
		mainWindow = createMainWindow();

		// Build and apply the base application menu.
		const menu = Menu.buildFromTemplate(buildMenuTemplate());
		Menu.setApplicationMenu(menu);

		// Prevent macOS App Nap.
		startAppNapPrevention();

		// ── load-persisted-state (synchronous) ────────────────────────────
		advanceBootPhase("load-persisted-state");

		// Instantiate the connection store (reads persisted connections).
		connectionStore = new ConnectionStore(app.getPath("userData"));

		// Create the RuntimeChildManager (not started yet).
		runtimeManager = createRuntimeChildManager();

		// Compute the absolute path to the bundled CLI shim.
		let kanbanCliCommand: string;
		if (app.isPackaged) {
			const shimName = process.platform === "win32" ? "kanban.cmd" : "kanban";
			kanbanCliCommand = path.join(process.resourcesPath, "bin", shimName);
		} else {
			kanbanCliCommand = path.join(import.meta.dirname, "..", "build", "bin", "kanban-dev");
		}

		// Instantiate the connection manager.
		connectionManager = new ConnectionManager({
			window: mainWindow,
			childManager: runtimeManager,
			store: connectionStore,
			kanbanCliCommand,
			onConnectionChanged: () => {
				rebuildConnectionMenu();
			},
			onLocalRuntimeReady: (url, token) => {
				runtimeUrl = url;
				authToken = token;
				void publishRuntimeDescriptor(url, token);
			},
			onLocalRuntimeStopped: () => {
				void clearRuntimeDescriptor();
				runtimeUrl = null;
			},
		});

		// Install the Connection menu into the app menu bar.
		rebuildConnectionMenu();

		// ── initialize-connections ─────────────────────────────────────────
		advanceBootPhase("initialize-connections");

		// Initialize the connection (restores persisted active connection,
		// starts local runtime if active connection is "local", or connects
		// to a remote/WSL server).
		try {
			await connectionManager.initialize();

			// ── ready ─────────────────────────────────────────────────────
			advanceBootPhase("ready");

			// Check for interrupted tasks from a previous session (non-blocking).
			showInterruptedTasksToast();
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error);
			console.error(`[desktop] Failed to start runtime: ${message}`);
			recordBootFailure("RUNTIME_CHILD_START_FAILED", message);
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
				advanceBootPhase("create-window");
				mainWindow = createMainWindow();
				if (runtimeUrl) {
					advanceBootPhase("load-renderer");
					installAuthHeaderInterceptor(
						mainWindow.webContents.session,
						authToken!,
						runtimeUrl,
					);
					// Set auth cookie for WebSocket upgrade requests (Electron's
					// onBeforeSendHeaders doesn't intercept WS upgrades).
					const origin = new URL(runtimeUrl).origin;
					mainWindow.webContents.session.cookies.set({
						url: origin,
						name: "kanban-auth",
						value: authToken!,
						path: "/",
						httpOnly: true,
						secure: false,
						sameSite: "strict",
					}).catch(() => {});
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

		// Shut down through the connection manager — this handles both
		// local child process and WSL launcher cleanup.
		if (connectionManager) {
			event.preventDefault();
			try {
				await connectionManager.shutdown();
			} catch (err) {
				console.error(
					"[desktop] Connection shutdown error:",
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

		// Clear references.
		connectionManager = null;
		connectionStore = null;
	});
}
