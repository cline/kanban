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
  <label>Label<input id="label" placeholder="My Server" autofocus></label>
  <label>Server URL<input id="url" placeholder="https://kanban.example.com"></label>
  <label>Auth Token (optional)<input id="token" placeholder="Bearer token"></label>
  <div class="buttons">
    <button onclick="cancel()">Cancel</button>
    <button class="primary" onclick="submit()">Connect</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    function cancel() { ipcRenderer.send('add-connection-result', null); }
    function submit() {
      const label = document.getElementById('label').value.trim();
      const url = document.getElementById('url').value.trim();
      const token = document.getElementById('token').value.trim();
      if (!label || !url) { alert('Label and URL are required.'); return; }
      ipcRenderer.send('add-connection-result', JSON.stringify({ label, serverUrl: url, authToken: token }));
    }
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter') submit();
    });
  </script>
</body>
</html>`;
}

export function showAddConnectionDialog(
	parent: BrowserWindow,
): Promise<AddConnectionResult | null> {
	return new Promise((resolve) => {
		const { ipcMain } = require("electron") as typeof import("electron");

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
				contextIsolation: false,
				nodeIntegration: true,
				sandbox: false,
			},
		});

		child.setMenuBarVisibility(false);

		const onResult = (_event: unknown, raw: string | null) => {
			ipcMain.removeListener("add-connection-result", onResult);
			child.close();
			if (!raw) {
				resolve(null);
				return;
			}
			try {
				resolve(JSON.parse(raw) as AddConnectionResult);
			} catch {
				resolve(null);
			}
		};

		ipcMain.on("add-connection-result", onResult);

		child.on("closed", () => {
			ipcMain.removeListener("add-connection-result", onResult);
			resolve(null);
		});

		child.loadURL(
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

