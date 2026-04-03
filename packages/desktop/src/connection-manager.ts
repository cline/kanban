/**
 * ConnectionManager — orchestrates switching between local and remote
 * Kanban server connections.
 *
 * Responsibilities:
 * - Local→Remote: stop the runtime child process, install auth header
 *   interceptor for the remote origin, loadURL(serverUrl).
 * - Remote→Local: start the runtime child process, install auth header
 *   interceptor for the local origin, loadURL(localhost).
 * - HTTP warning: warn before connecting to non-localhost http:// URLs.
 * - Auth token injection via session.webRequest.onBeforeSendHeaders.
 *
 * Fallback behavior (required by connection architecture):
 * If the saved connection is invalid (deleted, unreachable, or auth fails),
 * the app should:
 *   1. Log a warning
 *   2. Fall back to local connection
 *   3. Update the persisted active connection to local
 *   4. Not crash or hang
 */

import { BrowserWindow, dialog, type Session } from "electron";
import type { RuntimeChildManager } from "./runtime-child.js";
import type { ConnectionStore, SavedConnection } from "./connection-store.js";
import { generateAuthToken } from "./auth.js";
import { isInsecureRemoteUrl } from "./connection-utils.js";
import type { WslLauncher } from "./wsl-launch.js";
import { recordBootFailure } from "./desktop-boot-state.js";
import { showDesktopFailureDialog, type DesktopFailureState } from "./desktop-failure.js";

// Re-export for convenience.
export { isInsecureRemoteUrl } from "./connection-utils.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionManagerOptions {
	window: BrowserWindow;
	childManager: RuntimeChildManager;
	store: ConnectionStore;
	onConnectionChanged?: () => void;
	/**
	 * Absolute path to the bundled Kanban CLI shim.
	 * Passed to the child process so the home-agent prompt references
	 * the bundled shim instead of relying on a global install.
	 */
	kanbanCliCommand?: string;
	/**
	 * Called when the local runtime becomes ready with its URL and auth token.
	 * Used by main.ts to publish the runtime descriptor for CLI discovery.
	 */
	onLocalRuntimeReady?: (url: string, authToken: string) => void;
	/**
	 * Called when the local runtime is being stopped (switching away or shutting down).
	 * Used by main.ts to clear the runtime descriptor.
	 */
	onLocalRuntimeStopped?: () => void;
	/**
	 * Factory that creates a `WslLauncher` on demand (with the given auth token).
	 * Only set when WSL is available on this machine.
	 */
	createWslLauncher?: (authToken: string) => WslLauncher;
}

// ---------------------------------------------------------------------------
// ConnectionManager
// ---------------------------------------------------------------------------

export class ConnectionManager {
	private readonly window: BrowserWindow;
	private readonly childManager: RuntimeChildManager;
	private readonly store: ConnectionStore;
	private readonly onConnectionChanged?: () => void;

	private localAuthToken = "";
	private localUrl = "";
	private childRunning = false;
	private disposeAuthInterceptor: (() => void) | null = null;

	private readonly createWslLauncher?: (authToken: string) => WslLauncher;
	private wslLauncher: WslLauncher | null = null;
	private wslUrl = "";
	private wslAuthToken = "";

	private readonly onLocalRuntimeReady?: (url: string, authToken: string) => void;
	private readonly onLocalRuntimeStopped?: () => void;

	private readonly kanbanCliCommand?: string;

	constructor(options: ConnectionManagerOptions) {
		this.window = options.window;
		this.childManager = options.childManager;
		this.store = options.store;
		this.onConnectionChanged = options.onConnectionChanged;
		this.kanbanCliCommand = options.kanbanCliCommand;
		this.onLocalRuntimeReady = options.onLocalRuntimeReady;
		this.onLocalRuntimeStopped = options.onLocalRuntimeStopped;
		this.createWslLauncher = options.createWslLauncher;
	}

	/** Switch to the given connection ID. */
	async switchTo(connectionId: string): Promise<void> {
		const connection = this.store
			.getConnections()
			.find((c) => c.id === connectionId);
		if (!connection) return;

		// Stop any running WSL launcher when switching away.
		if (connection.id !== "wsl") {
			this.stopWsl();
		}

		if (connection.id === "local") {
			await this.switchToLocal();
		} else if (connection.id === "wsl") {
			await this.switchToWsl();
		} else {
			await this.switchToRemote(connection);
		}

		this.store.setActiveConnection(connectionId);
		this.onConnectionChanged?.();
	}

	/**
	 * Initialize — restore the persisted active connection.
	 *
	 * Reads the active connection from the store and switches to it.
	 * If the saved connection is non-local and fails to connect (deleted,
	 * unreachable, or otherwise invalid), falls back to local gracefully:
	 *   1. Log a warning
	 *   2. Fall back to local connection
	 *   3. Update the persisted active connection to local
	 *   4. Not crash or hang
	 */
	async initialize(): Promise<void> {
		const active = this.store.getActiveConnection();
		if (active.id === "local") {
			await this.switchToLocal();
		} else if (active.id === "wsl") {
			try {
				await this.switchToWsl();
			} catch (err) {
				console.warn(
					`[ConnectionManager] Failed to restore WSL connection, falling back to local:`,
					err instanceof Error ? err.message : err,
				);
				this.store.setActiveConnection("local");
				this.onConnectionChanged?.();
				await this.switchToLocal();
			}
		} else {
			try {
				await this.switchToRemote(active);
			} catch (err) {
				console.warn(
					`[ConnectionManager] Failed to restore remote connection "${active.label}" (${active.id}), falling back to local:`,
					err instanceof Error ? err.message : err,
				);
				this.store.setActiveConnection("local");
				this.onConnectionChanged?.();
				await this.switchToLocal();
			}
		}
	}

	/** Graceful shutdown — stop child and/or WSL if running. */
	async shutdown(): Promise<void> {
		if (this.childRunning) {
			this.onLocalRuntimeStopped?.();
			try {
				await this.childManager.shutdown();
			} catch {
				// Best-effort.
			}
			this.childRunning = false;
		}
		this.stopWsl();
		this.removeAuthInterceptor();
	}

	isChildRunning(): boolean {
		return this.childRunning;
	}

	getLocalUrl(): string {
		return this.localUrl;
	}

	getLocalAuthToken(): string {
		return this.localAuthToken;
	}

	getActiveConnectionId(): string {
		return this.store.getActiveConnectionId();
	}

	// -- Private switching ----------------------------------------------------

	private async switchToLocal(): Promise<void> {
		if (!this.childRunning) {
			this.localAuthToken = generateAuthToken();
			try {
				this.localUrl = await this.childManager.start({
					host: "127.0.0.1",
					port: "auto",
					authToken: this.localAuthToken,
					kanbanCliCommand: this.kanbanCliCommand,
				});
				this.childRunning = true;
				this.onLocalRuntimeReady?.(this.localUrl, this.localAuthToken);
			} catch (err) {
				console.error("[ConnectionManager] Failed to start local runtime:", err);
				throw err;
			}
		}
		await this.installAuthInterceptor(this.localUrl, this.localAuthToken);
		await this.window.loadURL(this.localUrl);
	}

	private async switchToRemote(connection: SavedConnection): Promise<void> {
		if (isInsecureRemoteUrl(connection.serverUrl)) {
			const { response } = await dialog.showMessageBox(this.window, {
				type: "warning",
				title: "Insecure Connection",
				message:
					`The connection "${connection.label}" uses unencrypted HTTP:\n\n` +
					`${connection.serverUrl}\n\n` +
					"Your auth token and data will be sent in plain text. " +
					"Only use HTTP for localhost.\n\nContinue?",
				buttons: ["Cancel", "Connect Anyway"],
				defaultId: 0,
				cancelId: 0,
			});
			if (response === 0) return;
		}
		if (this.childRunning) {
			this.onLocalRuntimeStopped?.();
			try {
				await this.childManager.shutdown();
			} catch {
				// Best-effort.
			}
			this.childRunning = false;
		}
		const token = connection.authToken ?? "";
		await this.installAuthInterceptor(connection.serverUrl, token);
		await this.window.loadURL(connection.serverUrl);
	}

	private async switchToWsl(): Promise<void> {
		if (!this.createWslLauncher) {
			console.error("[ConnectionManager] WSL launcher factory not available.");
			return;
		}
		// Stop local child if running.
		if (this.childRunning) {
			this.onLocalRuntimeStopped?.();
			try { await this.childManager.shutdown(); } catch { /* best-effort */ }
			this.childRunning = false;
		}
		// Stop existing WSL if running.
		this.stopWsl();

		this.wslAuthToken = generateAuthToken();
		this.wslLauncher = this.createWslLauncher(this.wslAuthToken);

		try {
			const result = await this.wslLauncher.start();
			this.wslUrl = result.url;
		} catch (err) {
			const message =
				err instanceof Error ? err.message : String(err);
			console.error("[ConnectionManager] Failed to start WSL runtime:", message);
			recordBootFailure("WSL_RUNTIME_START_FAILED", message);

			const failure: DesktopFailureState = {
				code: "WSL_RUNTIME_START_FAILED",
				title: "WSL Runtime Failed",
				message: `Failed to start the Kanban runtime in WSL:\n\n${message}`,
				canRetry: true,
				canFallbackToLocal: true,
			};

			const action = await showDesktopFailureDialog(this.window, failure);
			if (action === "retry") {
				return this.switchToWsl();
			}
			if (action === "fallback-local") {
				return this.switchToLocal();
			}
			// 'dismiss' — leave window in its current state, do not load about:blank.
			return;
		}
		await this.installAuthInterceptor(this.wslUrl, this.wslAuthToken);
		await this.window.loadURL(this.wslUrl);
	}

	private stopWsl(): void {
		if (this.wslLauncher) {
			this.wslLauncher.stop();
			this.wslLauncher = null;
		}
	}

	// -- Private auth ---------------------------------------------------------

	private async installAuthInterceptor(serverUrl: string, token: string): Promise<void> {
		this.removeAuthInterceptor();
		if (!token || !serverUrl) return;

		let origin: string;
		try {
			origin = new URL(serverUrl).origin;
		} catch {
			return;
		}

		const session: Session = this.window.webContents.session;
		const filter = { urls: [`${origin}/*`] };

		// 1. Header interceptor — covers all HTTP requests from the renderer.
		session.webRequest.onBeforeSendHeaders(
			filter,
			(
				details: { requestHeaders: Record<string, string> },
				callback: (response: { requestHeaders: Record<string, string> }) => void,
			) => {
				const headers = { ...details.requestHeaders };
				headers["Authorization"] = `Bearer ${token}`;
				callback({ requestHeaders: headers });
			},
		);

		// 2. Session cookie — covers WebSocket upgrade requests which bypass
		//    onBeforeSendHeaders in Electron (Chromium sends WS upgrades
		//    through the network stack without the webRequest intercept).
		//    The runtime auth middleware accepts this cookie as a fallback.
		const url = new URL(serverUrl);
		await session.cookies.set({
			url: origin,
			name: "kanban-auth",
			value: token,
			path: "/",
			httpOnly: true,
			secure: url.protocol === "https:",
			sameSite: "strict",
		});

		this.disposeAuthInterceptor = () => {
			session.webRequest.onBeforeSendHeaders(null);
			// Best-effort cookie removal.
			session.cookies.remove(origin, "kanban-auth").catch(() => {});
		};
	}

	private removeAuthInterceptor(): void {
		if (this.disposeAuthInterceptor) {
			this.disposeAuthInterceptor();
			this.disposeAuthInterceptor = null;
		}
	}
}
