/**
 * Connection store — persists saved connections to a JSON file in userData.
 *
 * Each connection has a unique ID, a user-facing label, and a server URL.
 * Remote connections may also carry an auth token (bearer token for the
 * remote server).
 *
 * The "local" connection (id === "local") is always present and cannot be
 * removed. It represents the bundled runtime child process.
 */

import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SavedConnection {
	/** Unique identifier. "local" is reserved for the built-in child runtime. */
	id: string;
	/** Human-readable label shown in the Connection menu. */
	label: string;
	/** Full server URL (e.g. "https://kanban.example.com"). Ignored for "local". */
	serverUrl: string;
	/** Optional auth token to send as a Bearer header to the remote server. */
	authToken?: string;
}

export interface ConnectionStoreData {
	/** Ordered list of saved connections (first is always "local"). */
	connections: SavedConnection[];
	/** ID of the currently active connection. */
	activeConnectionId: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const LOCAL_CONNECTION: SavedConnection = {
	id: "local",
	label: "Local",
	serverUrl: "",
};

/**
 * The built-in WSL connection. Inserted after "local" when WSL is detected.
 * The `serverUrl` is empty because it is determined at launch time.
 */
export const WSL_CONNECTION: SavedConnection = {
	id: "wsl",
	label: "WSL",
	serverUrl: "",
};

/** IDs that are reserved for built-in connections and cannot be removed. */
export const BUILTIN_CONNECTION_IDS = new Set(["local", "wsl"]);

function defaultData(): ConnectionStoreData {
	return {
		connections: [LOCAL_CONNECTION],
		activeConnectionId: "local",
	};
}

// ---------------------------------------------------------------------------
// ConnectionStore
// ---------------------------------------------------------------------------

export class ConnectionStore {
	private readonly filePath: string;
	private data: ConnectionStoreData;

	/**
	 * @param userDataPath — typically `app.getPath("userData")`.
	 */
	constructor(userDataPath: string) {
		this.filePath = path.join(userDataPath, "connections.json");
		this.data = this.load();
	}

	// -- Accessors -----------------------------------------------------------

	/** Return all saved connections (local is always first). */
	getConnections(): ReadonlyArray<SavedConnection> {
		return this.data.connections;
	}

	/** Return the currently active connection. */
	getActiveConnection(): SavedConnection {
		const active = this.data.connections.find(
			(c) => c.id === this.data.activeConnectionId,
		);
		// Fallback to local if the stored active ID is stale.
		return active ?? this.data.connections[0]!;
	}

	/** Return the active connection ID. */
	getActiveConnectionId(): string {
		return this.data.activeConnectionId;
	}

	// -- Mutations ------------------------------------------------------------

	/** Add a remote connection and persist. Returns the new connection. */
	addConnection(conn: Omit<SavedConnection, "id">): SavedConnection {
		const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
		const saved: SavedConnection = { id, ...conn };
		this.data.connections.push(saved);
		this.persist();
		return saved;
	}

	/**
	 * Insert the built-in WSL connection into the store.
	 * Call this when WSL is detected at startup. No-op if already present.
	 */
	enableWslConnection(): void {
		if (this.data.connections.some((c) => c.id === "wsl")) return;
		// Insert WSL right after "local".
		const localIdx = this.data.connections.findIndex((c) => c.id === "local");
		this.data.connections.splice(localIdx + 1, 0, { ...WSL_CONNECTION });
		this.persist();
	}

	/** Whether the WSL connection is present in the store. */
	hasWslConnection(): boolean {
		return this.data.connections.some((c) => c.id === "wsl");
	}

	/** Update an existing connection (cannot update built-in connections). */
	updateConnection(
		id: string,
		updates: Partial<Omit<SavedConnection, "id">>,
	): void {
		if (BUILTIN_CONNECTION_IDS.has(id)) return;
		const conn = this.data.connections.find((c) => c.id === id);
		if (!conn) return;
		if (updates.label !== undefined) conn.label = updates.label;
		if (updates.serverUrl !== undefined) conn.serverUrl = updates.serverUrl;
		if (updates.authToken !== undefined) conn.authToken = updates.authToken;
		this.persist();
	}

	/** Remove a connection by ID (cannot remove "local"). */
	removeConnection(id: string): void {
		if (id === "local") return;
		this.data.connections = this.data.connections.filter((c) => c.id !== id);
		// If the removed connection was active, switch back to local.
		if (this.data.activeConnectionId === id) {
			this.data.activeConnectionId = "local";
		}
		this.persist();
	}

	/** Set the active connection and persist. */
	setActiveConnection(id: string): void {
		const exists = this.data.connections.some((c) => c.id === id);
		if (!exists) return;
		this.data.activeConnectionId = id;
		this.persist();
	}

	// -- Persistence ----------------------------------------------------------

	private load(): ConnectionStoreData {
		try {
			const raw = fs.readFileSync(this.filePath, "utf-8");
			const parsed = JSON.parse(raw) as ConnectionStoreData;
			// Ensure "local" is always present and first.
			if (!parsed.connections?.some((c) => c.id === "local")) {
				parsed.connections = [LOCAL_CONNECTION, ...(parsed.connections ?? [])];
			} else {
				// Move local to front if it isn't.
				const localIdx = parsed.connections.findIndex((c) => c.id === "local");
				if (localIdx > 0) {
					const [local] = parsed.connections.splice(localIdx, 1);
					parsed.connections.unshift(local!);
				}
			}
			if (!parsed.activeConnectionId) {
				parsed.activeConnectionId = "local";
			}
			return parsed;
		} catch {
			return defaultData();
		}
	}

	private persist(): void {
		const dir = path.dirname(this.filePath);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, "\t"), "utf-8");
	}
}
