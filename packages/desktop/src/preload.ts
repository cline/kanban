import { contextBridge, ipcRenderer } from "electron";

const desktopApi = {
	platform: process.platform,

	openProjectWindow(projectId: string): void {
		ipcRenderer.send("open-project-window", projectId);
	},

	restartRuntime(): void {
		ipcRenderer.send("restart-runtime");
	},
} as const;

contextBridge.exposeInMainWorld("desktop", desktopApi);

export type DesktopApi = typeof desktopApi;
