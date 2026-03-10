import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";

import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { RuntimeTerminalWsServerMessage } from "../core/api-contract.js";
import { parseTerminalWsClientMessage } from "../core/api-validation.js";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint.js";
import type { TerminalSessionService } from "./terminal-session-service.js";

interface TerminalWebSocketConnectionContext {
	taskId: string;
	terminalManager: TerminalSessionService;
}

interface UpgradeRequest extends IncomingMessage {
	__kanbanUpgradeHandled?: boolean;
}

export interface CreateTerminalWebSocketBridgeRequest {
	server: Server;
	resolveTerminalManager: (workspaceId: string) => TerminalSessionService | null;
	isTerminalIoWebSocketPath: (pathname: string) => boolean;
	isTerminalControlWebSocketPath: (pathname: string) => boolean;
}

export interface TerminalWebSocketBridge {
	close: () => Promise<void>;
}

const OUTPUT_BATCH_INTERVAL_MS = 4;
const LOW_LATENCY_CHUNK_BYTES = 256;
const LOW_LATENCY_IDLE_WINDOW_MS = 5;
const OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES = 16 * 1024;
const OUTPUT_BUFFER_LOW_WATER_MARK_BYTES = Math.floor(OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES / 4);
const OUTPUT_RESUME_CHECK_INTERVAL_MS = 16;

function getWebSocketTransportSocket(ws: WebSocket): Socket | null {
	const transportSocket = (ws as WebSocket & { _socket?: Socket })._socket;
	return transportSocket ?? null;
}

function rawDataToBuffer(message: RawData): Buffer {
	if (typeof message === "string") {
		return Buffer.from(message, "utf8");
	}
	if (Buffer.isBuffer(message)) {
		return message;
	}
	if (Array.isArray(message)) {
		return Buffer.concat(message.map((part) => rawDataToBuffer(part)));
	}
	return Buffer.from(message);
}

function parseWebSocketPayload(message: RawData) {
	try {
		const text = typeof message === "string" ? message : message.toString("utf8");
		const parsed = JSON.parse(text) as unknown;
		return parseTerminalWsClientMessage(parsed);
	} catch {
		return null;
	}
}

function sendControlMessage(ws: WebSocket, message: RuntimeTerminalWsServerMessage): void {
	if (ws.readyState !== ws.OPEN) {
		return;
	}
	ws.send(JSON.stringify(message));
}

export function createTerminalWebSocketBridge({
	server,
	resolveTerminalManager,
	isTerminalIoWebSocketPath,
	isTerminalControlWebSocketPath,
}: CreateTerminalWebSocketBridgeRequest): TerminalWebSocketBridge {
	const activeSockets = new Set<Socket>();
	server.on("connection", (socket: Socket) => {
		socket.setNoDelay(true);
		activeSockets.add(socket);
		socket.on("close", () => {
			activeSockets.delete(socket);
		});
	});

	const ioServer = new WebSocketServer({ noServer: true });
	const controlServer = new WebSocketServer({ noServer: true });

	server.on("upgrade", (request, socket, head) => {
		try {
			(socket as Socket).setNoDelay(true);
			const upgradeRequest = request as UpgradeRequest;
			const url = new URL(request.url ?? "/", getKanbanRuntimeOrigin());
			const pathname = url.pathname;
			const isIoRequest = isTerminalIoWebSocketPath(pathname);
			const isControlRequest = isTerminalControlWebSocketPath(pathname);
			if (!isIoRequest && !isControlRequest) {
				return;
			}
			upgradeRequest.__kanbanUpgradeHandled = true;

			const taskId = url.searchParams.get("taskId")?.trim();
			const workspaceId = url.searchParams.get("workspaceId")?.trim();
			if (!taskId || !workspaceId) {
				socket.destroy();
				return;
			}
			const terminalManager = resolveTerminalManager(workspaceId);
			if (!terminalManager) {
				socket.destroy();
				return;
			}

			const targetServer = isIoRequest ? ioServer : controlServer;
			targetServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
				targetServer.emit("connection", ws, { taskId, terminalManager });
			});
		} catch {
			socket.destroy();
		}
	});

	ioServer.on("connection", (ws: WebSocket, context: unknown) => {
		const taskId = (context as TerminalWebSocketConnectionContext).taskId;
		const terminalManager = (context as TerminalWebSocketConnectionContext).terminalManager;
		let detachListener: (() => void) | null = null;
		let pendingOutputChunks: Buffer[] = [];
		let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
		let lastOutputSentAt = 0;
		let outputPaused = false;
		let resumeCheckTimer: ReturnType<typeof setTimeout> | null = null;

		const clearResumeCheck = () => {
			if (resumeCheckTimer !== null) {
				clearTimeout(resumeCheckTimer);
				resumeCheckTimer = null;
			}
			const transportSocket = getWebSocketTransportSocket(ws);
			transportSocket?.removeListener("drain", checkResumeAfterBackpressure);
		};

		const checkResumeAfterBackpressure = () => {
			if (!outputPaused) {
				clearResumeCheck();
				return;
			}
			if (ws.readyState !== ws.OPEN) {
				return;
			}
			if (ws.bufferedAmount < OUTPUT_BUFFER_LOW_WATER_MARK_BYTES) {
				outputPaused = false;
				clearResumeCheck();
				terminalManager.resumeOutput(taskId);
				return;
			}
			scheduleResumeCheck();
		};

		const scheduleResumeCheck = () => {
			if (!outputPaused) {
				return;
			}
			clearResumeCheck();
			const transportSocket = getWebSocketTransportSocket(ws);
			transportSocket?.once("drain", checkResumeAfterBackpressure);
			resumeCheckTimer = setTimeout(() => {
				resumeCheckTimer = null;
				checkResumeAfterBackpressure();
			}, OUTPUT_RESUME_CHECK_INTERVAL_MS);
		};

		const checkBackpressureAfterSend = () => {
			if (outputPaused || ws.readyState !== ws.OPEN) {
				return;
			}
			if (ws.bufferedAmount >= OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES) {
				outputPaused = true;
				terminalManager.pauseOutput(taskId);
				scheduleResumeCheck();
			}
		};

		const sendOutputChunk = (chunk: Buffer) => {
			if (ws.readyState !== ws.OPEN) {
				return;
			}
			ws.send(chunk);
			lastOutputSentAt = Date.now();
			checkBackpressureAfterSend();
		};

		const flushOutputBatch = () => {
			outputFlushTimer = null;
			if (pendingOutputChunks.length === 0 || ws.readyState !== ws.OPEN) {
				pendingOutputChunks = [];
				return;
			}
			sendOutputChunk(Buffer.concat(pendingOutputChunks));
			pendingOutputChunks = [];
		};

		const enqueueOutput = (chunk: Buffer) => {
			const now = Date.now();
			const shouldSendImmediately =
				pendingOutputChunks.length === 0 &&
				outputFlushTimer === null &&
				chunk.byteLength <= LOW_LATENCY_CHUNK_BYTES &&
				now - lastOutputSentAt >= LOW_LATENCY_IDLE_WINDOW_MS;
			if (shouldSendImmediately) {
				sendOutputChunk(chunk);
				return;
			}
			pendingOutputChunks.push(chunk);
			if (outputFlushTimer === null) {
				outputFlushTimer = setTimeout(flushOutputBatch, OUTPUT_BATCH_INTERVAL_MS);
			}
		};

		detachListener = terminalManager.attach(taskId, {
			onOutput: (chunk) => {
				enqueueOutput(chunk);
			},
		});

		ws.on("message", (rawMessage: RawData) => {
			try {
				const summary = terminalManager.writeInput(taskId, rawDataToBuffer(rawMessage));
				if (!summary) {
					ws.close(1011, "Task session is not running.");
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ws.close(1011, message);
			}
		});

		ws.on("close", () => {
			if (outputFlushTimer !== null) {
				clearTimeout(outputFlushTimer);
				outputFlushTimer = null;
			}
			clearResumeCheck();
			if (outputPaused) {
				outputPaused = false;
				terminalManager.resumeOutput(taskId);
			}
			pendingOutputChunks = [];
			detachListener?.();
			detachListener = null;
		});
	});

	controlServer.on("connection", (ws: WebSocket, context: unknown) => {
		const taskId = (context as TerminalWebSocketConnectionContext).taskId;
		const terminalManager = (context as TerminalWebSocketConnectionContext).terminalManager;
		let detachListener: (() => void) | null = null;

		detachListener = terminalManager.attach(taskId, {
			onState: (summary) => {
				sendControlMessage(ws, {
					type: "state",
					summary,
				});
			},
			onExit: (code) => {
				sendControlMessage(ws, {
					type: "exit",
					code,
				});
			},
		});

		ws.on("message", (rawMessage: RawData) => {
			const message = parseWebSocketPayload(rawMessage);
			if (!message) {
				sendControlMessage(ws, {
					type: "error",
					message: "Invalid terminal control payload.",
				});
				return;
			}

			if (message.type === "resize") {
				terminalManager.resize(taskId, message.cols, message.rows);
				return;
			}

			if (message.type === "stop") {
				terminalManager.stopTaskSession(taskId);
			}
		});

		ws.on("close", () => {
			detachListener?.();
			detachListener = null;
		});
	});

	return {
		close: async () => {
			for (const client of ioServer.clients) {
				try {
					client.terminate();
				} catch {
					// Ignore websocket termination errors during shutdown.
				}
			}
			for (const client of controlServer.clients) {
				try {
					client.terminate();
				} catch {
					// Ignore websocket termination errors during shutdown.
				}
			}
			await new Promise<void>((resolveCloseWebSockets) => {
				ioServer.close(() => {
					controlServer.close(() => {
						resolveCloseWebSockets();
					});
				});
			});
			for (const socket of activeSockets) {
				try {
					socket.destroy();
				} catch {
					// Ignore socket destroy errors during shutdown.
				}
			}
		},
	};
}
