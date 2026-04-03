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
 */

import { BrowserWindow, dialog, type Session } from "electron";
import type { RuntimeChildManager } from "./runtime-child.js";
import type { ConnectionStore, SavedConnection } from "./connection-store.js";
import { generateAuthToken } from "./auth.js";
import { isInsecureRemoteUrl } from "./connection-utils.js";
import type { WslLauncher } from "./wsl-launch.js";

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

	constructor(options: ConnectionManagerOptions) {
		this.window = options.window;
		this.childManager = options.childManager;
		this.store = options.store;
		this.onConnectionChanged = options.onConnectionChanged;
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

	/** Initialize — starts local runtime if "local" is active. */
	async initialize(): Promise<void> {
		const active = this.store.getActiveConnection();
		if (active.id === "local") {
			await this.switchToLocal();
		} else {
			await this.switchToRemote(active);
		}
	}

	/** Graceful shutdown — stop child and/or WSL if running. */
	async shutdown(): Promise<void> {
		if (this.childRunning) {
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

	// -- Private switching ----------------------------------------------------

	private async switchToLocal(): Promise<void> {
		if (!this.childRunning) {
			this.localAuthToken = generateAuthToken();
			try {
				this.localUrl = await this.childManager.start({
					host: "127.0.0.1",
					port: "auto",
					authToken: this.localAuthToken,
				});
				this.childRunning = true;
			} catch (err) {
				console.error("[ConnectionManager] Failed to start local runtime:", err);
				this.localUrl = "about:blank";
			}
		}
		this.installAuthInterceptor(this.localUrl, this.localAuthToken);
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
			try {
				await this.childManager.shutdown();
			} catch {
				// Best-effort.
			}
			this.childRunning = false;
		}
		const token = connection.authToken ?? "";
		this.installAuthInterceptor(connection.serverUrl, token);
		await this.window.loadURL(connection.serverUrl);
	}

	private async switchToWsl(): Promise<void> {
		if (!this.createWslLauncher) {
			console.error("[ConnectionManager] WSL launcher factory not available.");
			return;
		}
		// Stop local child if running.
		if (this.childRunning) {
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
			console.error("[ConnectionManager] Failed to start WSL runtime:", err);
			this.wslUrl = "about:blank";
		}
		this.installAuthInterceptor(this.wslUrl, this.wslAuthToken);
		await this.window.loadURL(this.wslUrl);
	}

	private stopWsl(): void {
		if (this.wslLauncher) {
			this.wslLauncher.stop();
			this.wslLauncher = null;
		}
	}

	// -- Private auth ---------------------------------------------------------

	private installAuthInterceptor(serverUrl: string, token: string): void {
		this.removeAuthInterceptor();
		if (!token || !serverUrl || serverUrl === "about:blank") return;

		let origin: string;
		try {
			origin = new URL(serverUrl).origin;
		} catch {
			return;
		}

		const session: Session = this.window.webContents.session;
		const filter = { urls: [`${origin}/*`] };

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

		this.disposeAuthInterceptor = () => {
			session.webRequest.onBeforeSendHeaders(null as any);
		};
	}

	private removeAuthInterceptor(): void {
		if (this.disposeAuthInterceptor) {
			this.disposeAuthInterceptor();
			this.disposeAuthInterceptor = null;
		}
	}
}
