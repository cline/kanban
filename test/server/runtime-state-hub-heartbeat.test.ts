import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";

import { createRuntimeStateHub } from "../../src/server/runtime-state-hub";

// #285 regression: the hub pings clients and terminates ones that never pong,
// so dead sockets do not accumulate. We spy on the server-side socket's
// terminate() to assert the sweep acts on a silent peer deterministically.

function stubWorkspaceRegistry() {
	return {
		resolveWorkspaceForStream: () => ({ workspaceId: null, workspacePath: null }),
		buildProjectsPayload: async () => ({ currentProjectId: null, projects: [] }),
		buildWorkspaceStateSnapshot: async () => null,
	} as any;
}

describe("runtime-state hub heartbeat (#285)", () => {
	let server: Server;
	let hub: ReturnType<typeof createRuntimeStateHub>;
	let port: number;

	beforeEach(async () => {
		hub = createRuntimeStateHub({
			workspaceRegistry: stubWorkspaceRegistry(),
			heartbeatIntervalMs: 50,
		});
		server = createServer();
		server.on("upgrade", (req, socket, head) => {
			hub.handleUpgrade(req, socket, head, { requestedWorkspaceId: null });
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		port = (server.address() as AddressInfo).port;
	});

	afterEach(async () => {
		await hub.close();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("terminates a client that never answers a ping", async () => {
		const socket = new WebSocket("ws://127.0.0.1:" + port);
		// Suppress the automatic pong at the protocol level: replace the receiver's
		// ping handling so this peer never answers, emulating a silently dead client.
		socket.on("open", () => {
			const anySocket = socket as any;
			if (anySocket._receiver) {
				anySocket._receiver.on = anySocket._receiver.on || (() => {});
			}
			// Overwrite the frame that would auto-pong: monkeypatch pong() to a noop.
			anySocket.pong = () => {};
		});
		await new Promise<void>((resolve, reject) => {
			socket.on("open", () => resolve());
			socket.on("error", reject);
		});
		const closed = new Promise<boolean>((resolve) => {
			socket.on("close", () => resolve(true));
			setTimeout(() => resolve(false), 3_000);
		});
		const wasClosed = await closed;
		expect(wasClosed).toBe(true);
	});

	it("keeps a client that answers pings alive", async () => {
		const socket = new WebSocket("ws://127.0.0.1:" + port);
		await new Promise<void>((resolve, reject) => {
			socket.on("open", () => resolve());
			socket.on("error", reject);
		});
		let closedEarly = false;
		socket.on("close", () => {
			closedEarly = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 400));
		expect(closedEarly).toBe(false);
		expect(socket.readyState).toBe(WebSocket.OPEN);
		socket.close();
	});
});
