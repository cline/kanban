import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConnectionStore } from "../src/connection-store.js";

describe("ConnectionStore", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-store-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("initializes with a local connection as default", () => {
		const store = new ConnectionStore(tmpDir);
		const connections = store.getConnections();
		expect(connections).toHaveLength(1);
		expect(connections[0]!.id).toBe("local");
		expect(connections[0]!.label).toBe("Local");
		expect(store.getActiveConnectionId()).toBe("local");
	});

	it("persists and reloads connections", () => {
		const store1 = new ConnectionStore(tmpDir);
		store1.addConnection({
			label: "Remote 1",
			serverUrl: "https://example.com",
			authToken: "tok123",
		});

		const store2 = new ConnectionStore(tmpDir);
		const connections = store2.getConnections();
		expect(connections).toHaveLength(2);
		expect(connections[1]!.label).toBe("Remote 1");
		expect(connections[1]!.serverUrl).toBe("https://example.com");
		expect(connections[1]!.authToken).toBe("tok123");
	});

	it("always keeps local as the first connection", () => {
		const store = new ConnectionStore(tmpDir);
		store.addConnection({ label: "A", serverUrl: "https://a.com" });
		store.addConnection({ label: "B", serverUrl: "https://b.com" });
		const connections = store.getConnections();
		expect(connections[0]!.id).toBe("local");
		expect(connections).toHaveLength(3);
	});

	it("cannot remove the local connection", () => {
		const store = new ConnectionStore(tmpDir);
		store.removeConnection("local");
		expect(store.getConnections()).toHaveLength(1);
		expect(store.getConnections()[0]!.id).toBe("local");
	});

	it("removes a remote connection", () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({
			label: "Remote",
			serverUrl: "https://remote.com",
		});
		expect(store.getConnections()).toHaveLength(2);

		store.removeConnection(conn.id);
		expect(store.getConnections()).toHaveLength(1);
	});

	it("resets active connection to local when active is removed", () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({
			label: "Remote",
			serverUrl: "https://remote.com",
		});
		store.setActiveConnection(conn.id);
		expect(store.getActiveConnectionId()).toBe(conn.id);

		store.removeConnection(conn.id);
		expect(store.getActiveConnectionId()).toBe("local");
	});

	it("updates a remote connection", () => {
		const store = new ConnectionStore(tmpDir);
		const conn = store.addConnection({
			label: "Old",
			serverUrl: "https://old.com",
		});

		store.updateConnection(conn.id, {
			label: "New",
			serverUrl: "https://new.com",
			authToken: "newtoken",
		});

		const updated = store.getConnections().find((c) => c.id === conn.id);
		expect(updated!.label).toBe("New");
		expect(updated!.serverUrl).toBe("https://new.com");
		expect(updated!.authToken).toBe("newtoken");
	});

	it("cannot update the local connection", () => {
		const store = new ConnectionStore(tmpDir);
		store.updateConnection("local", { label: "Hacked" });
		expect(store.getConnections()[0]!.label).toBe("Local");
	});

	it("setActiveConnection ignores unknown IDs", () => {
		const store = new ConnectionStore(tmpDir);
		store.setActiveConnection("nonexistent");
		expect(store.getActiveConnectionId()).toBe("local");
	});

	it("getActiveConnection falls back to local for stale IDs", () => {
		const store = new ConnectionStore(tmpDir);
		// Manually write a bad file.
		const filePath = path.join(tmpDir, "connections.json");
		fs.writeFileSync(
			filePath,
			JSON.stringify({
				connections: [{ id: "local", label: "Local", serverUrl: "" }],
				activeConnectionId: "deleted-id",
			}),
		);

		const store2 = new ConnectionStore(tmpDir);
		expect(store2.getActiveConnection().id).toBe("local");
	});

	it("handles corrupt JSON gracefully", () => {
		const filePath = path.join(tmpDir, "connections.json");
		fs.writeFileSync(filePath, "NOT VALID JSON");

		const store = new ConnectionStore(tmpDir);
		expect(store.getConnections()).toHaveLength(1);
		expect(store.getConnections()[0]!.id).toBe("local");
	});

	// -- WSL connection --------------------------------------------------

	it("enableWslConnection inserts WSL after local", () => {
		const store = new ConnectionStore(tmpDir);
		store.enableWslConnection();
		const conns = store.getConnections();
		expect(conns).toHaveLength(2);
		expect(conns[0]!.id).toBe("local");
		expect(conns[1]!.id).toBe("wsl");
		expect(conns[1]!.label).toBe("WSL");
	});

	it("enableWslConnection is idempotent", () => {
		const store = new ConnectionStore(tmpDir);
		store.enableWslConnection();
		store.enableWslConnection();
		expect(store.getConnections()).toHaveLength(2);
	});

	it("hasWslConnection returns false when not enabled", () => {
		const store = new ConnectionStore(tmpDir);
		expect(store.hasWslConnection()).toBe(false);
	});

	it("hasWslConnection returns true after enabling", () => {
		const store = new ConnectionStore(tmpDir);
		store.enableWslConnection();
		expect(store.hasWslConnection()).toBe(true);
	});

	it("WSL connection persists across reloads", () => {
		const store1 = new ConnectionStore(tmpDir);
		store1.enableWslConnection();
		const store2 = new ConnectionStore(tmpDir);
		expect(store2.hasWslConnection()).toBe(true);
		expect(store2.getConnections()[1]!.id).toBe("wsl");
	});

	it("cannot update the WSL connection", () => {
		const store = new ConnectionStore(tmpDir);
		store.enableWslConnection();
		store.updateConnection("wsl", { label: "Hacked" });
		expect(store.getConnections().find((c) => c.id === "wsl")!.label).toBe("WSL");
	});

	it("WSL connection appears before remote connections", () => {
		const store = new ConnectionStore(tmpDir);
		store.addConnection({ label: "Remote", serverUrl: "https://r.com" });
		store.enableWslConnection();
		const conns = store.getConnections();
		expect(conns[0]!.id).toBe("local");
		expect(conns[1]!.id).toBe("wsl");
		expect(conns[2]!.label).toBe("Remote");
	});
});
