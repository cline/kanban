/**
 * Electron main process entry point.
 *
 * Creates a BrowserWindow and manages the application lifecycle.
 * The runtime child process management (Task 1.2) and auth token
 * generation (Task 1.3) are stubbed and will be wired in later phases.
 */

import { app, BrowserWindow } from "electron";
import path from "node:path";

/** The single application window. Null until created. */
let mainWindow: BrowserWindow | null = null;

function createMainWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 800,
		minHeight: 600,
		title: "Kanban",
		backgroundColor: "#1F2428",
		webPreferences: {
			preload: path.join(import.meta.dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
		},
	});

	return window;
}

app.whenReady().then(() => {
	mainWindow = createMainWindow();

	// TODO (Task 1.4): Start the runtime child process, wait for the "ready"
	// IPC message, then load its URL. For now, show a placeholder page.
	mainWindow.loadURL("about:blank");

	// macOS: re-create window when dock icon is clicked and no windows exist.
	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			mainWindow = createMainWindow();
			mainWindow.loadURL("about:blank");
		}
	});
});

// Quit when all windows are closed (except on macOS where apps stay in the
// dock until the user explicitly quits with Cmd+Q).
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	// TODO (Task 1.4): Send shutdown message to runtime child process,
	// wait for "shutdown-complete", then force-kill after 5s timeout.
});

export { mainWindow };
