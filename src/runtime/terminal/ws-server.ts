import type { Server } from "node:http";
import type { Socket } from "node:net";

import type { RawData, WebSocket } from "ws";
import { WebSocketServer } from "ws";

import type { RuntimeTerminalWsClientMessage, RuntimeTerminalWsServerMessage } from "../api-contract.js";
import type { TerminalSessionManager } from "./session-manager.js";

interface TerminalWebSocketConnectionContext {
	taskId: string;
}

export interface CreateTerminalWebSocketBridgeRequest {
	server: Server;
	terminalManager: TerminalSessionManager;
	isTerminalWebSocketPath: (pathname: string) => boolean;
}

export interface TerminalWebSocketBridge {
	close: () => Promise<void>;
}

function bufferToBase64(input: Buffer): string {
	return input.toString("base64");
}

function base64ToBuffer(value: string): Buffer {
	return Buffer.from(value, "base64");
}

function parseWebSocketPayload(message: RawData): RuntimeTerminalWsClientMessage | null {
	try {
		const text = typeof message === "string" ? message : message.toString("utf8");
		const parsed = JSON.parse(text) as RuntimeTerminalWsClientMessage;
		if (!parsed || typeof parsed !== "object" || typeof (parsed as { type?: unknown }).type !== "string") {
			return null;
		}
		return parsed;
	} catch {
		return null;
	}
}

export function createTerminalWebSocketBridge({
	server,
	terminalManager,
	isTerminalWebSocketPath,
}: CreateTerminalWebSocketBridgeRequest): TerminalWebSocketBridge {
	const activeSockets = new Set<Socket>();
	server.on("connection", (socket: Socket) => {
		activeSockets.add(socket);
		socket.on("close", () => {
			activeSockets.delete(socket);
		});
	});

	const wsServer = new WebSocketServer({ noServer: true });
	server.on("upgrade", (request, socket, head) => {
		try {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			if (!isTerminalWebSocketPath(url.pathname)) {
				socket.destroy();
				return;
			}
			const taskId = url.searchParams.get("taskId")?.trim();
			if (!taskId) {
				socket.destroy();
				return;
			}

			wsServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
				wsServer.emit("connection", ws, { taskId });
			});
		} catch {
			socket.destroy();
		}
	});

	wsServer.on("connection", (ws: WebSocket, context: unknown) => {
		const taskId = (context as TerminalWebSocketConnectionContext).taskId;
		let detachListener: (() => void) | null = null;

		const send = (message: RuntimeTerminalWsServerMessage) => {
			if (ws.readyState !== ws.OPEN) {
				return;
			}
			ws.send(JSON.stringify(message));
		};

		detachListener = terminalManager.attach(taskId, {
			onOutput: (chunk) => {
				send({
					type: "output",
					data: bufferToBase64(chunk),
				});
			},
			onState: (summary) => {
				send({
					type: "state",
					summary,
				});
			},
			onExit: (code) => {
				send({
					type: "exit",
					code,
				});
			},
		});

		ws.on("message", (rawMessage: RawData) => {
			const message = parseWebSocketPayload(rawMessage);
			if (!message) {
				send({
					type: "error",
					message: "Invalid terminal message payload.",
				});
				return;
			}

			if (message.type === "input") {
				try {
					const summary = terminalManager.writeInput(taskId, base64ToBuffer(message.data));
					if (!summary) {
						send({
							type: "error",
							message: "Task session is not running.",
						});
					}
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);
					send({
						type: "error",
						message: errorMessage,
					});
				}
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
			for (const client of wsServer.clients) {
				try {
					client.terminate();
				} catch {
					// Ignore websocket termination errors during shutdown.
				}
			}
			await new Promise<void>((resolveCloseWebSockets) => {
				wsServer.close(() => {
					resolveCloseWebSockets();
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
