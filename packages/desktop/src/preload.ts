import { contextBridge, ipcRenderer } from "electron";

/**
 * Subscribe to a main→renderer channel and return a detach function.
 * Returning detach (instead of exposing `removeListener` directly)
 * prevents one renderer from removing listeners installed by another.
 */
function subscribe<T extends unknown[]>(
	channel: string,
	listener: (...args: T) => void,
): () => void {
	const wrapped = (_e: Electron.IpcRendererEvent, ...args: T): void =>
		listener(...args);
	ipcRenderer.on(channel, wrapped);
	return () => {
		ipcRenderer.removeListener(channel, wrapped);
	};
}

const desktopApi = {
	platform: process.platform,

	openProjectWindow(projectId: string): void {
		ipcRenderer.send("open-project-window", projectId);
	},

	restartRuntime(): void {
		ipcRenderer.send("restart-runtime");
	},

	/** Fires after the background updater stages a new runtime. The
	 *  renderer should surface a "Restart to apply <version>" banner. */
	onUpdateStaged(listener: (version: string) => void): () => void {
		return subscribe<[string]>("runtime:update-staged", listener);
	},

	/** Fires after a staged runtime failed startup and was rolled back.
	 *  Payload is the demoted version (or `null` if unknown). */
	onRuntimeRolledBack(
		listener: (demotedVersion: string | null) => void,
	): () => void {
		return subscribe<[string | null]>("runtime:rolled-back", listener);
	},
} as const;

contextBridge.exposeInMainWorld("desktop", desktopApi);
