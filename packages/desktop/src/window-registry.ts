import { BrowserWindow, screen, shell } from "electron";

import {
	type PersistedWindowState,
	clampBoundsToDisplays,
	extractPersistablePath,
	isPersistableRuntimePath,
	loadAllWindowStates,
	saveAllWindowStates,
} from "./window-state.js";


export interface WindowEntry {
	window: BrowserWindow;
	projectId: string | null;
	lastViewedPath: string | null;
}

export interface CreateWindowOptions {
	projectId?: string | null;
	savedState?: PersistedWindowState;
	preloadPath: string;
	isPackaged: boolean;
	backgroundColor?: string;
	onWindowClosed?: (windowId: number) => void;
	onWindowFocused?: (windowId: number) => void;
	hideOnCloseForMac?: boolean;
	isQuitting?: () => boolean;
}

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const DEFAULT_BACKGROUND_COLOR = "#1F2428";

export class WindowRegistry {
	private readonly windows = new Map<number, WindowEntry>();
	private lastFocusedId: number | null = null;

	get size(): number {
		return this.windows.size;
	}

	createWindow(options: CreateWindowOptions): BrowserWindow {
		const projectId = options.projectId ?? null;
		// Clamp the saved bounds against currently-attached displays before
		// constructing the BrowserWindow. Without this, a window saved on a
		// secondary monitor that has since been disconnected lands off-screen
		// with no recovery path short of editing the state file by hand.
		const savedState = options.savedState
			? clampBoundsToDisplays(options.savedState, screen.getAllDisplays())
			: undefined;
		const backgroundColor = options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;

		const window = new BrowserWindow({
			x: savedState?.x,
			y: savedState?.y,
			width: savedState?.width ?? DEFAULT_WIDTH,
			height: savedState?.height ?? DEFAULT_HEIGHT,

			minWidth: MIN_WIDTH,
			minHeight: MIN_HEIGHT,
			title: "Kanban",
			backgroundColor,
			show: false,
			webPreferences: {
				preload: options.preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webSecurity: true,
				devTools: !options.isPackaged,
			},
		});

		if (savedState?.isMaximized) {
			window.maximize();
		}

		const entry: WindowEntry = {
			window,
			projectId,
			lastViewedPath: options.savedState?.lastViewedPath ?? null,
		};
		this.windows.set(window.id, entry);
		this.lastFocusedId = window.id;

		window.once("ready-to-show", () => {
			window.show();
		});

		window.on("focus", () => {
			this.lastFocusedId = window.id;
			options.onWindowFocused?.(window.id);
		});

		window.webContents.on("will-navigate", (event: Electron.Event, url: string) => {
			// Resolve trusted origin from the window's current URL (not at creation
			// time — startup windows haven't loaded yet).
			const currentUrl = window.webContents.getURL();
			if (currentUrl) {
				try {
					const parsed = new URL(url);
					if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
						event.preventDefault();
						return;
					}
					const trustedOrigin = new URL(currentUrl).origin;
					if (parsed.origin !== trustedOrigin) {
						event.preventDefault();
					}
				} catch {
					event.preventDefault();
				}
			}
		});

		window.webContents.setWindowOpenHandler(({ url }) => {
			try {
				const parsed = new URL(url);
				if (parsed.protocol === "http:" || parsed.protocol === "https:") {
					shell.openExternal(url);
				} else {
					// Non-http(s) schemes (`javascript:`, `file:`, custom protocols)
					// are intentionally rejected. Log so unexpected drops are
					// traceable instead of vanishing into a `deny`.
					console.debug(
						`[desktop] Refusing window.open for non-http(s) URL: ${url}`,
					);
				}
			} catch (err) {
				console.debug(
					`[desktop] Refusing window.open for unparseable URL: ${url}`,
					err instanceof Error ? err.message : err,
				);
			}
			return { action: "deny" };
		});

		window.on("close", (event) => {
			if (
				options.hideOnCloseForMac &&
				process.platform === "darwin" &&
				!(options.isQuitting?.() ?? false)
			) {
				if (this.countVisibleWindows() <= 1) {
					event.preventDefault();
					window.hide();
					return;
				}
			}
		});

		window.on("closed", () => {
			this.windows.delete(window.id);
			if (this.lastFocusedId === window.id) {
				this.lastFocusedId = null;
			}
			options.onWindowClosed?.(window.id);
		});

		return window;
	}

	getVisible(): WindowEntry[] {
		return [...this.windows.values()].filter(
			(entry) => !entry.window.isDestroyed() && entry.window.isVisible(),
		);
	}

	countVisibleWindows(): number {
		return this.getVisible().length;
	}

	/**
	 * All live (non-destroyed) windows we own. Used by callers that need to
	 * broadcast to "every Kanban window" without picking up renderers we
	 * didn't create (e.g. devtools, preload-spawned helpers).
	 */
	getAllLive(): BrowserWindow[] {
		const out: BrowserWindow[] = [];
		for (const entry of this.windows.values()) {
			if (!entry.window.isDestroyed()) out.push(entry.window);
		}
		return out;
	}

	/** Electron focus → our last focus → any live window. */
	getFocused(): BrowserWindow | null {
		const focused = BrowserWindow.getFocusedWindow();
		if (focused && this.windows.has(focused.id)) {
			return focused;
		}

		if (this.lastFocusedId !== null) {
			const entry = this.windows.get(this.lastFocusedId);
			if (entry && !entry.window.isDestroyed()) {
				return entry.window;
			}
			this.lastFocusedId = null;
		}

		for (const entry of this.windows.values()) {
			if (!entry.window.isDestroyed()) {
				return entry.window;
			}
		}

		return null;
	}

	saveAllStates(userDataPath: string): void {
		const states: PersistedWindowState[] = [];
		for (const entry of this.windows.values()) {
			if (entry.window.isDestroyed()) continue;
			const isMaximized = entry.window.isMaximized();
			const bounds = isMaximized
				? entry.window.getNormalBounds()
				: entry.window.getBounds();

			const persistable = extractPersistablePath(
				entry.window.webContents.getURL(),
			);
			if (persistable) entry.lastViewedPath = persistable;

			states.push({
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				isMaximized,
				projectId: entry.projectId,
				lastViewedPath: entry.lastViewedPath,
			});
		}
		saveAllWindowStates(userDataPath, states);
	}

	static loadPersistedWindows(userDataPath: string): PersistedWindowState[] {
		return loadAllWindowStates(userDataPath);
	}

	static buildWindowUrl(baseUrl: string, projectId: string | null): string {
		if (!projectId) return baseUrl;
		const url = new URL(baseUrl);
		url.pathname = `/${encodeURIComponent(projectId)}`;
		return url.toString();
	}

	private buildEntryUrl(baseUrl: string, entry: WindowEntry): string {
		// Defense in depth against upgraded users whose persisted state still
		// contains a `/Users/.../disconnected.html` pathname from older builds.
		if (entry.lastViewedPath && isPersistableRuntimePath(entry.lastViewedPath)) {
			try {
				const url = new URL(baseUrl);
				url.pathname = entry.lastViewedPath;
				return url.toString();
			} catch {
				/* fall through */
			}
		}
		if (entry.projectId) {
			return WindowRegistry.buildWindowUrl(baseUrl, entry.projectId);
		}
		return baseUrl;
	}

	async loadUrlInAllWindows(baseUrl: string): Promise<void> {
		const tasks: Array<{ id: number; promise: Promise<void> }> = [];
		for (const entry of this.windows.values()) {
			if (entry.window.isDestroyed()) continue;
			const url = this.buildEntryUrl(baseUrl, entry);
			tasks.push({ id: entry.window.id, promise: entry.window.loadURL(url) });
		}
		const results = await Promise.allSettled(tasks.map((t) => t.promise));
		results.forEach((result, index) => {
			if (result.status === "rejected") {
				const task = tasks[index];
				const reason = result.reason;
				console.warn(
					`[desktop] loadURL failed for window ${task?.id}:`,
					reason instanceof Error ? reason.message : reason,
				);
			}
		});
	}
}
