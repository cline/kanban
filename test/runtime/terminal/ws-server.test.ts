import { EventEmitter, once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawData } from "ws";
import { WebSocket } from "ws";

import type { RuntimeTaskSessionSummary, RuntimeTerminalWsServerMessage } from "../../../src/core/api-contract";
import { getKanbanRuntimePort, setKanbanRuntimePort } from "../../../src/core/runtime-endpoint";
import type { TerminalSessionListener, TerminalSessionService } from "../../../src/terminal/terminal-session-service";
import type { TerminalRestoreSnapshot } from "../../../src/terminal/terminal-state-mirror";
import { createTerminalWebSocketBridge, type TerminalWebSocketBridge } from "../../../src/terminal/ws-server";

const TASK_ID = "task-1";
const WORKSPACE_ID = "workspace-1";

function createSummary(taskId = TASK_ID): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "running",
		agentId: "codex",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: 1,
		updatedAt: 1,
		lastOutputAt: 1,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

function rawDataToBuffer(data: RawData): Buffer {
	if (typeof data === "string") {
		return Buffer.from(data, "utf8");
	}
	if (Buffer.isBuffer(data)) {
		return data;
	}
	if (Array.isArray(data)) {
		return Buffer.concat(data.map((part) => rawDataToBuffer(part)));
	}
	return Buffer.from(data);
}

class FakeTerminalManager implements TerminalSessionService {
	private readonly listenersByTaskId = new Map<string, Set<TerminalSessionListener>>();
	restoreGeneration = 1;

	attach(taskId: string, listener: TerminalSessionListener): (() => void) | null {
		const listeners = this.listenersByTaskId.get(taskId) ?? new Set<TerminalSessionListener>();
		this.listenersByTaskId.set(taskId, listeners);
		listeners.add(listener);
		listener.onState?.(createSummary(taskId));
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) {
				this.listenersByTaskId.delete(taskId);
			}
		};
	}

	getRestoreSnapshot = vi.fn(
		async (): Promise<TerminalRestoreSnapshot> => ({
			snapshot: "",
			cols: 80,
			rows: 24,
			restoreGeneration: this.restoreGeneration,
		}),
	);

	beginNewSession(): void {
		this.restoreGeneration += 1;
	}
	recoverStaleSession = vi.fn(() => createSummary());
	writeInput = vi.fn(() => createSummary());
	resize = vi.fn(() => true);
	pauseOutput = vi.fn(() => true);
	resumeOutput = vi.fn(() => true);
	stopTaskSession = vi.fn(() => createSummary());

	emitOutput(taskId: string, data: string): void {
		for (const listener of this.listenersByTaskId.get(taskId) ?? []) {
			listener.onOutput?.(Buffer.from(data, "utf8"));
		}
	}
}

interface QueuedWebSocket {
	socket: WebSocket;
	queue: RawData[];
	events: EventEmitter;
}

async function openQueuedWebSocket(url: string): Promise<QueuedWebSocket> {
	const socket = new WebSocket(url);
	const queue: RawData[] = [];
	const events = new EventEmitter();
	socket.on("message", (message) => {
		queue.push(message);
		events.emit("message");
	});
	await new Promise<void>((resolve, reject) => {
		const timeoutId = setTimeout(() => reject(new Error(`Timed out connecting websocket: ${url}`)), 2_000);
		socket.once("open", () => {
			clearTimeout(timeoutId);
			resolve();
		});
		socket.once("error", (error) => {
			clearTimeout(timeoutId);
			reject(error);
		});
	});
	return { socket, queue, events };
}

async function waitForControlMessage(
	queuedSocket: QueuedWebSocket,
	predicate: (message: RuntimeTerminalWsServerMessage) => boolean,
	timeoutMs = 2_000,
): Promise<RuntimeTerminalWsServerMessage> {
	return await new Promise((resolve, reject) => {
		const tryResolve = () => {
			const index = queuedSocket.queue.findIndex((rawData) => {
				const message = JSON.parse(rawDataToBuffer(rawData).toString("utf8")) as RuntimeTerminalWsServerMessage;
				return predicate(message);
			});
			if (index < 0) {
				return;
			}
			const [rawData] = queuedSocket.queue.splice(index, 1);
			clearTimeout(timeoutId);
			queuedSocket.events.removeListener("message", tryResolve);
			resolve(JSON.parse(rawDataToBuffer(rawData).toString("utf8")) as RuntimeTerminalWsServerMessage);
		};
		const timeoutId = setTimeout(() => {
			queuedSocket.events.removeListener("message", tryResolve);
			reject(new Error("Timed out waiting for terminal control message."));
		}, timeoutMs);
		queuedSocket.events.on("message", tryResolve);
		tryResolve();
		queuedSocket.socket.once("error", (error) => {
			clearTimeout(timeoutId);
			queuedSocket.events.removeListener("message", tryResolve);
			reject(error);
		});
	});
}

async function waitForIoMessage(queuedSocket: QueuedWebSocket, timeoutMs = 2_000): Promise<Buffer> {
	return await new Promise((resolve, reject) => {
		const tryResolve = () => {
			const rawData = queuedSocket.queue.shift();
			if (!rawData) {
				return;
			}
			clearTimeout(timeoutId);
			queuedSocket.events.removeListener("message", tryResolve);
			resolve(rawDataToBuffer(rawData));
		};
		const timeoutId = setTimeout(() => {
			queuedSocket.events.removeListener("message", tryResolve);
			reject(new Error("Timed out waiting for terminal output."));
		}, timeoutMs);
		queuedSocket.events.on("message", tryResolve);
		tryResolve();
		queuedSocket.socket.once("error", (error) => {
			clearTimeout(timeoutId);
			queuedSocket.events.removeListener("message", tryResolve);
			reject(error);
		});
	});
}

async function closeSocket(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
		return;
	}
	socket.close();
	await once(socket, "close");
}

async function waitForAssertion(assertion: () => void, timeoutMs = 250): Promise<void> {
	const startedAt = Date.now();
	let lastError: unknown = null;
	while (Date.now() - startedAt < timeoutMs) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	if (lastError) {
		throw lastError;
	}
	assertion();
}

// ---------------------------------------------------------------------------
// Helper: attempt a raw WebSocket upgrade and capture the response status line
// ---------------------------------------------------------------------------
async function attemptUpgradeAndReadResponse(
	url: string,
	cookieHeader?: string,
	timeoutMs = 2_000,
): Promise<{ statusLine: string }> {
	return await new Promise((resolve, reject) => {
		const timeoutId = setTimeout(() => {
			reject(new Error(`Timed out waiting for upgrade response: ${url}`));
		}, timeoutMs);

		const ws = new WebSocket(url, {
			headers: cookieHeader ? { cookie: cookieHeader } : undefined,
		});

		let statusLine = "";

		ws.on("unexpected-response", (_req, res) => {
			clearTimeout(timeoutId);
			statusLine = `HTTP/${res.httpVersion} ${res.statusCode} ${res.statusMessage}`;
			res.resume();
			resolve({ statusLine });
		});

		ws.on("open", () => {
			clearTimeout(timeoutId);
			ws.close();
			resolve({ statusLine: "HTTP/1.1 101 Switching Protocols" });
		});

		ws.on("error", (err) => {
			clearTimeout(timeoutId);
			// Node's ws library translates the 401 "connection: close" into an
			// error event rather than "unexpected-response" in some versions;
			// treat any error as a rejected upgrade.
			if (!statusLine) {
				statusLine = err.message;
			}
			resolve({ statusLine });
		});
	});
}

describe("createTerminalWebSocketBridge – passcode gate", () => {
	let server: Server;
	let bridge: TerminalWebSocketBridge;
	let terminalManager: FakeTerminalManager;
	let runtimeUrl: string;
	let originalRuntimePort: number;

	beforeEach(async () => {
		originalRuntimePort = getKanbanRuntimePort();
		terminalManager = new FakeTerminalManager();
		server = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		bridge = createTerminalWebSocketBridge({
			server,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? terminalManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			// Validator: only the token "valid-token" is accepted.
			validateUpgradeSession: (cookieHeader) => cookieHeader?.includes("kanban_session=valid-token") === true,
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address() as AddressInfo | null;
		if (!address) {
			throw new Error("Expected websocket server address.");
		}
		// Align the runtime endpoint config with the test server so the
		// middleware Host/Origin allowlist accepts our random port.
		setKanbanRuntimePort(address.port);
		runtimeUrl = `ws://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		setKanbanRuntimePort(originalRuntimePort);
		await bridge.close();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	});

	it("rejects /api/terminal/io upgrade with 401 when no session cookie is present", async () => {
		const url = `${runtimeUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}`;
		const { statusLine } = await attemptUpgradeAndReadResponse(url);
		expect(statusLine).toContain("401");
	});

	it("rejects /api/terminal/control upgrade with 401 when session token is invalid", async () => {
		const url = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}`;
		const { statusLine } = await attemptUpgradeAndReadResponse(url, "kanban_session=wrong-token");
		expect(statusLine).toContain("401");
	});

	it("allows /api/terminal/io upgrade when a valid session cookie is present", async () => {
		const url = `${runtimeUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}`;
		const { statusLine } = await attemptUpgradeAndReadResponse(url, "kanban_session=valid-token");
		expect(statusLine).toContain("101");
	});

	it("allows /api/terminal/control upgrade when a valid session cookie is present", async () => {
		const url = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}`;
		const { statusLine } = await attemptUpgradeAndReadResponse(url, "kanban_session=valid-token");
		expect(statusLine).toContain("101");
	});

	it("allows upgrades when validateUpgradeSession is not set (local mode)", async () => {
		// We need a completely independent HTTP server + bridge for this test.
		// Node's EventEmitter stacks upgrade listeners, so reusing the same server
		// would leave the passcode-enforcing listener in place alongside the new
		// no-validator bridge, causing the 401 path to still fire first.
		const freshServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const freshManager = new FakeTerminalManager();
		const freshBridge = createTerminalWebSocketBridge({
			server: freshServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? freshManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			// No validateUpgradeSession: local mode, no gate.
		});
		freshServer.listen(0, "127.0.0.1");
		await once(freshServer, "listening");
		const freshAddress = freshServer.address() as AddressInfo | null;
		if (!freshAddress) {
			throw new Error("Expected fresh server address.");
		}
		setKanbanRuntimePort(freshAddress.port);
		const freshUrl = `ws://127.0.0.1:${freshAddress.port}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}`;

		try {
			const { statusLine } = await attemptUpgradeAndReadResponse(freshUrl);
			expect(statusLine).toContain("101");
		} finally {
			await freshBridge.close();
			await new Promise<void>((resolve, reject) => {
				freshServer.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});
});

describe("createTerminalWebSocketBridge", () => {
	let server: Server;
	let bridge: TerminalWebSocketBridge;
	let terminalManager: FakeTerminalManager;
	let runtimeUrl: string;
	let originalRuntimePort: number;

	beforeEach(async () => {
		originalRuntimePort = getKanbanRuntimePort();
		terminalManager = new FakeTerminalManager();
		server = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		bridge = createTerminalWebSocketBridge({
			server,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? terminalManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
		});
		server.listen(0, "127.0.0.1");
		await once(server, "listening");
		const address = server.address() as AddressInfo | null;
		if (!address) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(address.port);
		runtimeUrl = `ws://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		setKanbanRuntimePort(originalRuntimePort);
		await bridge.close();
		await new Promise<void>((resolve, reject) => {
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	});

	it("broadcasts one PTY session to multiple viewers", async () => {
		const ioUrlA = `${runtimeUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-a`;
		const controlUrlA = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-a`;
		const ioUrlB = `${runtimeUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-b`;
		const controlUrlB = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-b`;

		const ioSocketA = await openQueuedWebSocket(ioUrlA);
		const controlSocketA = await openQueuedWebSocket(controlUrlA);
		const ioSocketB = await openQueuedWebSocket(ioUrlB);
		const controlSocketB = await openQueuedWebSocket(controlUrlB);

		await waitForControlMessage(controlSocketA, (message) => message.type === "restore");
		await waitForControlMessage(controlSocketB, (message) => message.type === "restore");
		controlSocketA.socket.send(JSON.stringify({ type: "restore_complete" }));
		controlSocketB.socket.send(JSON.stringify({ type: "restore_complete" }));

		terminalManager.emitOutput(TASK_ID, "hello");

		await expect(waitForIoMessage(ioSocketA)).resolves.toEqual(Buffer.from("hello", "utf8"));
		await expect(waitForIoMessage(ioSocketB)).resolves.toEqual(Buffer.from("hello", "utf8"));

		await closeSocket(ioSocketA.socket);
		await closeSocket(controlSocketA.socket);

		terminalManager.emitOutput(TASK_ID, "world");

		await expect(waitForIoMessage(ioSocketB)).resolves.toEqual(Buffer.from("world", "utf8"));

		await closeSocket(ioSocketB.socket);
		await closeSocket(controlSocketB.socket);
	});

	it("keeps the PTY paused until every backpressured viewer drains", async () => {
		const ioUrlA = `${runtimeUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-a`;
		const controlUrlA = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-a`;
		const ioUrlB = `${runtimeUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-b`;
		const controlUrlB = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-b`;

		const ioSocketA = await openQueuedWebSocket(ioUrlA);
		const controlSocketA = await openQueuedWebSocket(controlUrlA);
		const ioSocketB = await openQueuedWebSocket(ioUrlB);
		const controlSocketB = await openQueuedWebSocket(controlUrlB);

		await waitForControlMessage(controlSocketA, (message) => message.type === "restore");
		await waitForControlMessage(controlSocketB, (message) => message.type === "restore");
		controlSocketA.socket.send(JSON.stringify({ type: "restore_complete" }));
		controlSocketB.socket.send(JSON.stringify({ type: "restore_complete" }));

		const output = "x".repeat(120_000);
		terminalManager.emitOutput(TASK_ID, output);

		const outputA = await waitForIoMessage(ioSocketA);
		const outputB = await waitForIoMessage(ioSocketB);
		expect(outputA.byteLength).toBe(Buffer.byteLength(output));
		expect(outputB.byteLength).toBe(Buffer.byteLength(output));
		expect(terminalManager.pauseOutput).toHaveBeenCalledTimes(1);

		controlSocketA.socket.send(JSON.stringify({ type: "output_ack", bytes: outputA.byteLength }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(terminalManager.resumeOutput).not.toHaveBeenCalled();

		controlSocketB.socket.send(JSON.stringify({ type: "output_ack", bytes: outputB.byteLength }));
		await waitForAssertion(() => {
			expect(terminalManager.resumeOutput).toHaveBeenCalledTimes(1);
		});

		await closeSocket(ioSocketA.socket);
		await closeSocket(controlSocketA.socket);
		await closeSocket(ioSocketB.socket);
		await closeSocket(controlSocketB.socket);
	});

	it("includes restoreGeneration on restore and keeps it for the same session", async () => {
		const controlUrl = `${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-a`;

		const first = await openQueuedWebSocket(controlUrl);
		const restoreA = await waitForControlMessage(first, (message) => message.type === "restore");
		expect(restoreA).toMatchObject({
			type: "restore",
			restoreGeneration: 1,
		});
		await closeSocket(first.socket);

		const second = await openQueuedWebSocket(
			`${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-b`,
		);
		const restoreB = await waitForControlMessage(second, (message) => message.type === "restore");
		expect(restoreB).toMatchObject({
			type: "restore",
			restoreGeneration: 1,
		});
		await closeSocket(second.socket);
	});

	it("sends a higher restoreGeneration after a new session starts", async () => {
		const first = await openQueuedWebSocket(
			`${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-a`,
		);
		const restoreA = await waitForControlMessage(first, (message) => message.type === "restore");
		expect(restoreA).toMatchObject({ type: "restore", restoreGeneration: 1 });
		await closeSocket(first.socket);

		terminalManager.beginNewSession();

		const second = await openQueuedWebSocket(
			`${runtimeUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=client-b`,
		);
		const restoreB = await waitForControlMessage(second, (message) => message.type === "restore");
		expect(restoreB).toMatchObject({ type: "restore", restoreGeneration: 2 });
		await closeSocket(second.socket);
	});

	it("terminates an unresponsive viewer and releases its PTY backpressure", async () => {
		const heartbeatManager = new FakeTerminalManager();
		const heartbeatServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const heartbeatBridge = createTerminalWebSocketBridge({
			server: heartbeatServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? heartbeatManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 50,
		});
		heartbeatServer.listen(0, "127.0.0.1");
		await once(heartbeatServer, "listening");
		const heartbeatAddress = heartbeatServer.address() as AddressInfo | null;
		if (!heartbeatAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(heartbeatAddress.port);
		const heartbeatUrl = `ws://127.0.0.1:${heartbeatAddress.port}`;

		let ioSocket: WebSocket | null = null;
		let controlSocket: WebSocket | null = null;
		try {
			const ioUrl = `${heartbeatUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=zombie`;
			const controlUrl = `${heartbeatUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=zombie`;

			// Zombie viewer: connected, but never acks output and never replies to pings.
			ioSocket = new WebSocket(ioUrl, { autoPong: false });
			await once(ioSocket, "open");
			controlSocket = new WebSocket(controlUrl, { autoPong: false });
			// Register before "open" resolves: the server sends restore immediately.
			const restoreReceived = new Promise<void>((resolve) => {
				controlSocket?.on("message", (message) => {
					const parsed = JSON.parse(rawDataToBuffer(message).toString("utf8")) as RuntimeTerminalWsServerMessage;
					if (parsed.type === "restore") {
						resolve();
					}
				});
			});
			await once(controlSocket, "open");
			await restoreReceived;
			controlSocket.send(JSON.stringify({ type: "restore_complete" }));

			const output = "x".repeat(120_000);
			heartbeatManager.emitOutput(TASK_ID, output);
			await waitForAssertion(() => {
				expect(heartbeatManager.pauseOutput).toHaveBeenCalledTimes(1);
			});
			expect(heartbeatManager.resumeOutput).not.toHaveBeenCalled();

			// The heartbeat terminates the unresponsive sockets, and the close path
			// releases the viewer's backpressure claim on the shared PTY.
			await waitForAssertion(() => {
				expect(heartbeatManager.resumeOutput).toHaveBeenCalledTimes(1);
			}, 2_000);
			await waitForAssertion(() => {
				expect(ioSocket?.readyState).toBe(WebSocket.CLOSED);
			}, 2_000);
		} finally {
			for (const socket of [ioSocket, controlSocket]) {
				if (socket && socket.readyState !== WebSocket.CLOSED) {
					socket.terminate();
				}
			}
			await heartbeatBridge.close();
			await new Promise<void>((resolve, reject) => {
				heartbeatServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("releases PTY backpressure from a viewer that pongs but never acknowledges output", async () => {
		// A backgrounded mobile tab is not a zombie socket: browsers answer ping
		// frames from the network stack, so the heartbeat sees it as alive. But its
		// renderer is frozen, so xterm never fires the write callback that sends
		// output_ack. Without the ack-stall watchdog this viewer holds pauseOutput()
		// on the shared PTY forever and the agent blocks on its next stdout write.
		const stallManager = new FakeTerminalManager();
		const stallServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const stallBridge = createTerminalWebSocketBridge({
			server: stallServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? stallManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			// Long enough that the heartbeat cannot be what releases the PTY.
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 150,
		});
		stallServer.listen(0, "127.0.0.1");
		await once(stallServer, "listening");
		const stallAddress = stallServer.address() as AddressInfo | null;
		if (!stallAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(stallAddress.port);
		const stallUrl = `ws://127.0.0.1:${stallAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${stallUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=backgrounded`;
			const controlUrl = `${stallUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=backgrounded`;

			// Note: default autoPong. This viewer answers every ping, exactly like a
			// real suspended tab, so the liveness heartbeat will never terminate it.
			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));

			stallManager.emitOutput(TASK_ID, "x".repeat(120_000));
			await waitForAssertion(() => {
				expect(stallManager.pauseOutput).toHaveBeenCalledTimes(1);
			});
			expect(stallManager.resumeOutput).not.toHaveBeenCalled();

			// No output_ack is ever sent. The stall watchdog disconnects the viewer
			// and the close path releases its claim on the shared PTY.
			await waitForAssertion(() => {
				expect(stallManager.resumeOutput).toHaveBeenCalledTimes(1);
			}, 2_000);
			await waitForAssertion(() => {
				expect(ioSocket?.socket.readyState).toBe(WebSocket.CLOSED);
			}, 2_000);
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await stallBridge.close();
			await new Promise<void>((resolve, reject) => {
				stallServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("keeps a slow but progressing viewer connected while it drains", async () => {
		// The watchdog must not punish a genuinely slow renderer. Partial acks are
		// progress and rearm the timer, so only a fully stalled viewer is dropped.
		const slowManager = new FakeTerminalManager();
		const slowServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const slowBridge = createTerminalWebSocketBridge({
			server: slowServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? slowManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 200,
		});
		slowServer.listen(0, "127.0.0.1");
		await once(slowServer, "listening");
		const slowAddress = slowServer.address() as AddressInfo | null;
		if (!slowAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(slowAddress.port);
		const slowUrl = `ws://127.0.0.1:${slowAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${slowUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=slow`;
			const controlUrl = `${slowUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=slow`;

			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));

			const totalBytes = 120_000;
			slowManager.emitOutput(TASK_ID, "x".repeat(totalBytes));
			await waitForAssertion(() => {
				expect(slowManager.pauseOutput).toHaveBeenCalledTimes(1);
			});

			// Dribble acks in over more than one watchdog period.
			let acknowledged = 0;
			while (acknowledged < totalBytes) {
				const chunk = Math.min(20_000, totalBytes - acknowledged);
				controlSocket.socket.send(JSON.stringify({ type: "output_ack", bytes: chunk }));
				acknowledged += chunk;
				await new Promise((resolve) => setTimeout(resolve, 60));
			}

			await waitForAssertion(() => {
				expect(slowManager.resumeOutput).toHaveBeenCalledTimes(1);
			}, 2_000);
			expect(ioSocket.socket.readyState).toBe(WebSocket.OPEN);
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await slowBridge.close();
			await new Promise<void>((resolve, reject) => {
				slowServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("re-restores a viewer that never acks and resumes the PTY instead of blocking", async () => {
		// The pause budget must rescue the PTY on its own: both the heartbeat and the
		// ack-stall watchdog are set far above the budget so neither of them can be
		// what releases the pause.
		const budgetManager = new FakeTerminalManager();
		const budgetServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const budgetBridge = createTerminalWebSocketBridge({
			server: budgetServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? budgetManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 60_000,
			viewerPauseBudgetMs: 150,
		});
		budgetServer.listen(0, "127.0.0.1");
		await once(budgetServer, "listening");
		const budgetAddress = budgetServer.address() as AddressInfo | null;
		if (!budgetAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(budgetAddress.port);
		const budgetUrl = `ws://127.0.0.1:${budgetAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${budgetUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=stalled`;
			const controlUrl = `${budgetUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=stalled`;

			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));

			budgetManager.emitOutput(TASK_ID, "x".repeat(120_000));
			await waitForAssertion(() => {
				expect(budgetManager.pauseOutput).toHaveBeenCalledTimes(1);
			});
			expect(budgetManager.resumeOutput).not.toHaveBeenCalled();

			// The viewer never acks. Instead of holding the pause until the ack-stall
			// watchdog (60s away), the wall-clock pause budget expires and re-restores
			// this viewer, which releases the shared PTY.
			await waitForAssertion(() => {
				expect(budgetManager.resumeOutput).toHaveBeenCalledTimes(1);
			}, 2_000);
			const reRestore = await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			// Forced re-restores omit restoreGeneration so clients cannot skip them.
			expect(reRestore).not.toHaveProperty("restoreGeneration");
			// This is a recovery, not an eviction: the viewer keeps its sockets.
			expect(ioSocket.socket.readyState).toBe(WebSocket.OPEN);
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await budgetBridge.close();
			await new Promise<void>((resolve, reject) => {
				budgetServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("keeps a second viewer streaming while the first viewer overflows its budget", async () => {
		const isolatedManager = new FakeTerminalManager();
		const isolatedServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const isolatedBridge = createTerminalWebSocketBridge({
			server: isolatedServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? isolatedManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 60_000,
			viewerPauseBudgetMs: 150,
		});
		isolatedServer.listen(0, "127.0.0.1");
		await once(isolatedServer, "listening");
		const isolatedAddress = isolatedServer.address() as AddressInfo | null;
		if (!isolatedAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(isolatedAddress.port);
		const isolatedUrl = `ws://127.0.0.1:${isolatedAddress.port}`;

		let ioSocketA: QueuedWebSocket | null = null;
		let controlSocketA: QueuedWebSocket | null = null;
		let ioSocketB: QueuedWebSocket | null = null;
		let controlSocketB: QueuedWebSocket | null = null;
		try {
			const ioUrlA = `${isolatedUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=stalled`;
			const controlUrlA = `${isolatedUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=stalled`;
			const ioUrlB = `${isolatedUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=healthy`;
			const controlUrlB = `${isolatedUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=healthy`;

			ioSocketA = await openQueuedWebSocket(ioUrlA);
			controlSocketA = await openQueuedWebSocket(controlUrlA);
			ioSocketB = await openQueuedWebSocket(ioUrlB);
			controlSocketB = await openQueuedWebSocket(controlUrlB);

			await waitForControlMessage(controlSocketA, (message) => message.type === "restore");
			await waitForControlMessage(controlSocketB, (message) => message.type === "restore");
			controlSocketA.socket.send(JSON.stringify({ type: "restore_complete" }));
			controlSocketB.socket.send(JSON.stringify({ type: "restore_complete" }));

			const output = "x".repeat(120_000);
			isolatedManager.emitOutput(TASK_ID, output);
			const outputA = await waitForIoMessage(ioSocketA);
			const outputB = await waitForIoMessage(ioSocketB);
			expect(outputA.byteLength).toBe(Buffer.byteLength(output));
			expect(outputB.byteLength).toBe(Buffer.byteLength(output));
			await waitForAssertion(() => {
				expect(isolatedManager.pauseOutput).toHaveBeenCalledTimes(1);
			});

			// The healthy viewer drains; the stalled viewer never acks.
			controlSocketB.socket.send(JSON.stringify({ type: "output_ack", bytes: outputB.byteLength }));

			// The stalled viewer overflows its budget and is re-restored, which releases
			// the shared PTY. The healthy viewer is untouched by any of this.
			await waitForAssertion(() => {
				expect(isolatedManager.resumeOutput).toHaveBeenCalledTimes(1);
			}, 2_000);
			await waitForControlMessage(controlSocketA, (message) => message.type === "restore");

			isolatedManager.emitOutput(TASK_ID, "tail-output");
			await expect(waitForIoMessage(ioSocketB)).resolves.toEqual(Buffer.from("tail-output", "utf8"));
			expect(ioSocketA.socket.readyState).toBe(WebSocket.OPEN);

			// The healthy viewer never receives a second restore.
			const extraRestoresForB = controlSocketB.queue.filter((rawData) => {
				const message = JSON.parse(rawDataToBuffer(rawData).toString("utf8")) as RuntimeTerminalWsServerMessage;
				return message.type === "restore";
			});
			expect(extraRestoresForB).toHaveLength(0);
		} finally {
			for (const queued of [ioSocketA, controlSocketA, ioSocketB, controlSocketB]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await isolatedBridge.close();
			await new Promise<void>((resolve, reject) => {
				isolatedServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("bounds pre-restore buffering for a viewer that never completes restore", async () => {
		// Without the pending budget, a viewer that connects and never sends
		// restore_complete accumulates every PTY chunk in runtime memory forever.
		const pendingManager = new FakeTerminalManager();
		const pendingServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const pendingBridge = createTerminalWebSocketBridge({
			server: pendingServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? pendingManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 60_000,
			viewerPendingBudgetBytes: 8 * 1024,
		});
		pendingServer.listen(0, "127.0.0.1");
		await once(pendingServer, "listening");
		const pendingAddress = pendingServer.address() as AddressInfo | null;
		if (!pendingAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(pendingAddress.port);
		const pendingUrl = `ws://127.0.0.1:${pendingAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${pendingUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=never-restored`;
			const controlUrl = `${pendingUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=never-restored`;

			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			// Deliberately never send restore_complete.

			pendingManager.emitOutput(TASK_ID, "x".repeat(32 * 1024));

			// The pending buffer overflows and the viewer is re-restored instead of
			// growing without bound. No live output was ever committed, so the PTY
			// was never paused either.
			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			expect(pendingManager.pauseOutput).not.toHaveBeenCalled();
			expect(ioSocket.socket.readyState).toBe(WebSocket.OPEN);
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await pendingBridge.close();
			await new Promise<void>((resolve, reject) => {
				pendingServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("does not re-restore a slow but progressing viewer within its budget", async () => {
		// Regression guard against an over-eager budget: partial acks are progress.
		// A viewer that keeps draining within its byte and wall-clock budgets must
		// ride out the pause and never lose its stream.
		const slowBudgetManager = new FakeTerminalManager();
		const slowBudgetServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const slowBudgetBridge = createTerminalWebSocketBridge({
			server: slowBudgetServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? slowBudgetManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 60_000,
			viewerPauseBudgetMs: 2_000,
			viewerPauseBudgetBytes: 512 * 1024,
		});
		slowBudgetServer.listen(0, "127.0.0.1");
		await once(slowBudgetServer, "listening");
		const slowBudgetAddress = slowBudgetServer.address() as AddressInfo | null;
		if (!slowBudgetAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(slowBudgetAddress.port);
		const slowBudgetUrl = `ws://127.0.0.1:${slowBudgetAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${slowBudgetUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=slow`;
			const controlUrl = `${slowBudgetUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=slow`;

			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));

			const totalBytes = 120_000;
			slowBudgetManager.emitOutput(TASK_ID, "x".repeat(totalBytes));
			await waitForAssertion(() => {
				expect(slowBudgetManager.pauseOutput).toHaveBeenCalledTimes(1);
			});

			// Dribble acks in; the full drain stays inside the pause budget.
			let acknowledged = 0;
			while (acknowledged < totalBytes) {
				const chunk = Math.min(20_000, totalBytes - acknowledged);
				controlSocket.socket.send(JSON.stringify({ type: "output_ack", bytes: chunk }));
				acknowledged += chunk;
				await new Promise((resolve) => setTimeout(resolve, 60));
			}

			await waitForAssertion(() => {
				expect(slowBudgetManager.resumeOutput).toHaveBeenCalledTimes(1);
			}, 2_000);
			await new Promise((resolve) => setTimeout(resolve, 100));
			const extraRestores = controlSocket.queue.filter((rawData) => {
				const message = JSON.parse(rawDataToBuffer(rawData).toString("utf8")) as RuntimeTerminalWsServerMessage;
				return message.type === "restore";
			});
			expect(extraRestores).toHaveLength(0);
			expect(ioSocket.socket.readyState).toBe(WebSocket.OPEN);
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await slowBudgetBridge.close();
			await new Promise<void>((resolve, reject) => {
				slowBudgetServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("terminates a permanently frozen viewer after the forced re-restore limit", async () => {
		// A forced re-restore clears outputPaused and the ack-stall timer, so a
		// viewer that never completes restore again would otherwise trip the pending
		// budget and be re-restored forever: neither existing safety net can stop
		// that loop (heartbeat is far away, and the watchdog needs outputPaused).
		// The cap must terminate it instead.
		const forcedRestoreLimit = 2;
		const frozenManager = new FakeTerminalManager();
		const frozenServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const frozenBridge = createTerminalWebSocketBridge({
			server: frozenServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? frozenManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 60_000,
			viewerPauseBudgetMs: 100,
			viewerPendingBudgetBytes: 8 * 1024,
			forcedRestoreLimit,
		});
		frozenServer.listen(0, "127.0.0.1");
		await once(frozenServer, "listening");
		const frozenAddress = frozenServer.address() as AddressInfo | null;
		if (!frozenAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(frozenAddress.port);
		const frozenUrl = `ws://127.0.0.1:${frozenAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${frozenUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=frozen`;
			const controlUrl = `${frozenUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=frozen`;

			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			// Complete the initial restore once so this viewer can be backpressured
			// and actually pause the PTY; after this it never acks and never
			// completes another restore, like a permanently frozen tab.
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));
			// Let restore_complete land before emitting: with the tiny pending budget,
			// output that reached the pending buffer first would itself trip a
			// re-restore before this viewer could ever pause the PTY.
			await new Promise((resolve) => setTimeout(resolve, 20));

			frozenManager.emitOutput(TASK_ID, "x".repeat(120_000));
			await waitForAssertion(() => {
				expect(frozenManager.pauseOutput).toHaveBeenCalledTimes(1);
			});

			// Feed output until the viewer is terminated or the loop gives up.
			for (let iteration = 0; iteration < 10 && ioSocket.socket.readyState !== WebSocket.CLOSED; iteration++) {
				frozenManager.emitOutput(TASK_ID, "x".repeat(32 * 1024));
				await new Promise((resolve) => setTimeout(resolve, 20));
			}

			await waitForAssertion(() => {
				expect(ioSocket?.socket.readyState).toBe(WebSocket.CLOSED);
			}, 3_000);

			// The initial connect restore plus at most one forced attempt per unit of
			// limit; after that the viewer is terminated, not re-restored again.
			const forcedRestores = controlSocket.queue.filter((rawData) => {
				const message = JSON.parse(rawDataToBuffer(rawData).toString("utf8")) as RuntimeTerminalWsServerMessage;
				return message.type === "restore";
			});
			expect(forcedRestores.length).toBeLessThanOrEqual(forcedRestoreLimit);
			// The viewer's backpressure claim was released, so the PTY is not left paused.
			expect(frozenManager.resumeOutput).toHaveBeenCalled();
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await frozenBridge.close();
			await new Promise<void>((resolve, reject) => {
				frozenServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("resets the forced re-restore counter when a viewer recovers", async () => {
		// Regression guard: two overflows separated by a successful restore must not
		// be summed toward the limit. With forcedRestoreLimit of 1, a viewer whose
		// counter was not reset would be terminated on the second overflow.
		const recoveringManager = new FakeTerminalManager();
		const recoveringServer = createServer((_request, response) => {
			response.writeHead(404);
			response.end();
		});
		const recoveringBridge = createTerminalWebSocketBridge({
			server: recoveringServer,
			resolveTerminalManager: (workspaceId) => (workspaceId === WORKSPACE_ID ? recoveringManager : null),
			isTerminalIoWebSocketPath: (pathname) => pathname === "/api/terminal/io",
			isTerminalControlWebSocketPath: (pathname) => pathname === "/api/terminal/control",
			heartbeatIntervalMs: 60_000,
			ackStallTimeoutMs: 60_000,
			viewerPauseBudgetMs: 100,
			forcedRestoreLimit: 1,
		});
		recoveringServer.listen(0, "127.0.0.1");
		await once(recoveringServer, "listening");
		const recoveringAddress = recoveringServer.address() as AddressInfo | null;
		if (!recoveringAddress) {
			throw new Error("Expected websocket server address.");
		}
		setKanbanRuntimePort(recoveringAddress.port);
		const recoveringUrl = `ws://127.0.0.1:${recoveringAddress.port}`;

		let ioSocket: QueuedWebSocket | null = null;
		let controlSocket: QueuedWebSocket | null = null;
		try {
			const ioUrl = `${recoveringUrl}/api/terminal/io?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=recovering`;
			const controlUrl = `${recoveringUrl}/api/terminal/control?taskId=${TASK_ID}&workspaceId=${WORKSPACE_ID}&clientId=recovering`;

			ioSocket = await openQueuedWebSocket(ioUrl);
			controlSocket = await openQueuedWebSocket(controlUrl);

			await waitForControlMessage(controlSocket, (message) => message.type === "restore");
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));

			// First overflow: stall past the pause budget without acking.
			recoveringManager.emitOutput(TASK_ID, "x".repeat(120_000));
			await waitForControlMessage(controlSocket, (message) => message.type === "restore");

			// The viewer recovers.
			controlSocket.socket.send(JSON.stringify({ type: "restore_complete" }));

			// Second, unrelated overflow later on.
			recoveringManager.emitOutput(TASK_ID, "y".repeat(120_000));
			await waitForControlMessage(controlSocket, (message) => message.type === "restore", 3_000);

			expect(ioSocket.socket.readyState).toBe(WebSocket.OPEN);
			expect(recoveringManager.resumeOutput).toHaveBeenCalledTimes(2);
		} finally {
			for (const queued of [ioSocket, controlSocket]) {
				if (queued && queued.socket.readyState !== WebSocket.CLOSED) {
					queued.socket.terminate();
				}
			}
			await recoveringBridge.close();
			await new Promise<void>((resolve, reject) => {
				recoveringServer.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});
});
