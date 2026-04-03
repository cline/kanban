/**
 * Preload script for the Electron renderer process.
 *
 * Runs in a sandboxed context with access to a limited set of Node APIs.
 * Uses contextBridge to safely expose IPC channels to the renderer.
 */

import { contextBridge, ipcRenderer } from "electron";

/**
 * Desktop API exposed to the renderer via window.desktop.
 * Kept minimal; only add methods here when the renderer genuinely needs
 * main-process capabilities that can't go through the runtime HTTP/WS layer.
 */
const desktopApi = {
	/** Returns the platform the desktop app is running on. */
	platform: process.platform,

	/**
	 * Register a callback for the "open-diagnostics" menu action.
	 * Returns a dispose function to unregister the listener.
	 */
	onOpenDiagnostics(callback: () => void): () => void {
		const handler = () => callback();
		ipcRenderer.on("open-diagnostics", handler);
		return () => {
			ipcRenderer.removeListener("open-diagnostics", handler);
		};
	},
} as const;

contextBridge.exposeInMainWorld("desktop", desktopApi);

export type DesktopApi = typeof desktopApi;
