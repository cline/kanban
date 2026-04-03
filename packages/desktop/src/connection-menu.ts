/**
 * Connection menu — builds and installs the "Connection" menu in the
 * application menu bar.
 *
 * Menu structure:
 *   Connection
 *     ✓ Local
 *       Remote 1
 *       Remote 2
 *     ─────────────
 *     Add Remote Connection…
 *     Remove Connection…   (only shown when a remote is active)
 */

import {
	app,
	Menu,
	BrowserWindow,
	dialog,
	type MenuItemConstructorOptions,
} from "electron";
import type { ConnectionStore } from "./connection-store.js";
import type { ConnectionManager } from "./connection-manager.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConnectionMenuOptions {
	store: ConnectionStore;
	manager: ConnectionManager;
	window: BrowserWindow;
}

// ---------------------------------------------------------------------------
// "Add Remote Connection" dialog (inline HTML in a child window)
// ---------------------------------------------------------------------------

interface AddConnectionResult {
	label: string;
	serverUrl: string;
	authToken: string;
}

type AddConnectionDialogAction =
	| { kind: "cancel" }
	| { kind: "invalid"; message: string }
	| { kind: "submit"; result: AddConnectionResult };

const ADD_CONNECTION_DIALOG_PROTOCOL = "kanban-connection:";

function buildDialogHtml(): string {
	return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         background: #1F2428; color: #c9d1d9; padding: 20px; margin: 0; }
  h2 { margin-top: 0; font-size: 16px; }
  label { display: block; margin-top: 12px; font-size: 13px; color: #8b949e; }
  input { display: block; width: 100%; box-sizing: border-box; margin-top: 4px;
          padding: 6px 8px; border: 1px solid #30363d; border-radius: 4px;
          background: #0d1117; color: #c9d1d9; font-size: 13px; }
  input:focus { outline: none; border-color: #58a6ff; }
  .buttons { margin-top: 20px; text-align: right; }
  button { padding: 6px 16px; border: 1px solid #30363d; border-radius: 4px;
           background: #21262d; color: #c9d1d9; cursor: pointer; font-size: 13px;
           margin-left: 8px; }
  button.primary { background: #238636; border-color: #2ea043; color: #fff; }
  button:hover { filter: brightness(1.1); }
</style>
</head>
<body>
  <h2>Add Remote Connection</h2>
  <form action="kanban-connection://submit" method="get">
    <label>Label<input name="label" placeholder="My Server" autofocus required spellcheck="false"></label>
    <label>Server URL<input name="serverUrl" type="url" placeholder="https://kanban.example.com" required spellcheck="false"></label>
    <label>Auth Token (optional)<input name="authToken" placeholder="Bearer token" spellcheck="false"></label>
    <div class="buttons">
      <button type="submit" formaction="kanban-connection://cancel" formnovalidate>Cancel</button>
      <button class="primary" type="submit">Connect</button>
    </div>
  </form>
</body>
</html>`;
}

function parseAddConnectionDialogAction(rawUrl: string): AddConnectionDialogAction | null {
	let navigationUrl: URL;
	try {
		navigationUrl = new URL(rawUrl);
	} catch {
		return null;
	}
	if (navigationUrl.protocol !== ADD_CONNECTION_DIALOG_PROTOCOL) {
		return null;
	}
	if (navigationUrl.hostname === "cancel") {
		return { kind: "cancel" };
	}
	if (navigationUrl.hostname !== "submit") {
		return { kind: "invalid", message: "Unsupported connection dialog action." };
	}

	const label = navigationUrl.searchParams.get("label")?.trim() ?? "";
	const rawServerUrl = navigationUrl.searchParams.get("serverUrl")?.trim() ?? "";
	const authToken = navigationUrl.searchParams.get("authToken")?.trim() ?? "";

	if (!label || !rawServerUrl) {
		return { kind: "invalid", message: "Label and server URL are required." };
	}

	let serverUrl: URL;
	try {
		serverUrl = new URL(rawServerUrl);
	} catch {
		return { kind: "invalid", message: "Enter a valid server URL." };
	}
	if (serverUrl.protocol !== "http:" && serverUrl.protocol !== "https:") {
		return { kind: "invalid", message: "Server URL must use http or https." };
	}

	return {
		kind: "submit",
		result: {
			label,
			serverUrl: serverUrl.toString(),
			authToken,
		},
	};
}

export function showAddConnectionDialog(
	parent: BrowserWindow,
): Promise<AddConnectionResult | null> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: AddConnectionResult | null) => {
			if (settled) {
				return;
			}
			settled = true;
			resolve(result);
		};

		const child = new BrowserWindow({
			parent,
			modal: true,
			width: 440,
			height: 320,
			resizable: false,
			minimizable: false,
			maximizable: false,
			title: "Add Remote Connection",
			backgroundColor: "#1F2428",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webSecurity: true,
				devTools: !app.isPackaged,
			},
		});

		child.setMenuBarVisibility(false);
		child.webContents.on("will-navigate", (event, rawUrl) => {
			const action = parseAddConnectionDialogAction(rawUrl);
			if (!action) {
				return;
			}
			event.preventDefault();
			if (action.kind === "cancel") {
				finish(null);
				child.close();
				return;
			}
			if (action.kind === "invalid") {
				void dialog.showMessageBox(child, {
					type: "warning",
					title: "Invalid Connection",
					message: action.message,
					buttons: ["OK"],
				});
				return;
			}
			finish(action.result);
			child.close();
		});

		child.on("closed", () => {
			finish(null);
		});

		void child.loadURL(
			`data:text/html;charset=utf-8,${encodeURIComponent(buildDialogHtml())}`,
		);
	});
}

// ---------------------------------------------------------------------------
// Menu building
// ---------------------------------------------------------------------------

/**
 * Build the Connection menu template.
 */
export function buildConnectionMenuTemplate(
	options: ConnectionMenuOptions,
): MenuItemConstructorOptions {
	const { store, manager, window: parentWindow } = options;
	const connections = store.getConnections();
	const activeId = store.getActiveConnectionId();

	const connectionItems: MenuItemConstructorOptions[] = connections.map(
		(conn) => ({
			label: conn.label,
			type: "radio" as const,
			checked: conn.id === activeId,
			click: () => {
				void manager.switchTo(conn.id);
			},
		}),
	);

	const addItem: MenuItemConstructorOptions = {
		label: "Add Remote Connection\u2026",
		click: async () => {
			const result = await showAddConnectionDialog(parentWindow);
			if (!result) return;
			const saved = store.addConnection({
				label: result.label,
				serverUrl: result.serverUrl,
				authToken: result.authToken || undefined,
			});
			// Switch to the newly added connection immediately.
			await manager.switchTo(saved.id);
		},
	};

	const removeItems: MenuItemConstructorOptions[] = [];
	const active = store.getActiveConnection();
	if (active.id !== "local" && active.id !== "wsl") {
		removeItems.push({
			label: `Remove "${active.label}"`,
			click: async () => {
				const { response } = await dialog.showMessageBox(parentWindow, {
					type: "question",
					title: "Remove Connection",
					message: `Remove the connection "${active.label}"?\n\nThis will switch back to the local runtime.`,
					buttons: ["Cancel", "Remove"],
					defaultId: 0,
					cancelId: 0,
				});
				if (response === 0) return;
				store.removeConnection(active.id);
				await manager.switchTo("local");
			},
		});
	}

	return {
		label: "Connection",
		submenu: [
			...connectionItems,
			{ type: "separator" },
			addItem,
			...removeItems,
		],
	};
}

/**
 * Build the full application menu with the Connection submenu inserted.
 * Preserves the default menus (File, Edit, View, Window, Help) and adds
 * Connection after View.
 */
export function installConnectionMenu(options: ConnectionMenuOptions): void {
	const defaultMenu = Menu.getApplicationMenu();
	const existingTemplate: MenuItemConstructorOptions[] = [];

	if (defaultMenu) {
		for (const item of defaultMenu.items) {
			// Skip any previous "Connection" menu to avoid duplicates on rebuild.
			if (item.label === "Connection") continue;
			existingTemplate.push({ role: item.role as any, label: item.label, submenu: item.submenu as any });
		}
	}

	const connectionMenu = buildConnectionMenuTemplate(options);

	// Insert after "View" (or at end if View is not found).
	const viewIndex = existingTemplate.findIndex(
		(t) => t.label === "View",
	);
	if (viewIndex >= 0) {
		existingTemplate.splice(viewIndex + 1, 0, connectionMenu);
	} else {
		existingTemplate.push(connectionMenu);
	}

	const menu = Menu.buildFromTemplate(existingTemplate);
	Menu.setApplicationMenu(menu);
}

