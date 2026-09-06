import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";

import type { RawData } from "ws";
import { WebSocket, WebSocketServer } from "ws";

import type { RuntimeTerminalWsServerMessage } from "../core/api-contract";
import { parseTerminalWsClientMessage } from "../core/api-validation";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import { handleSocketUpgrade } from "../server/middleware";
import type { TerminalSessionService } from "./terminal-session-service";

interface TerminalWebSocketConnectionContext {
	taskId: string;
	workspaceId: string;
	clientId: string;
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
	/**
	 * Optional session validator for remote-mode passcode enforcement.
	 * When provided, WebSocket upgrade requests that fail validation are
	 * rejected with HTTP 401 before the connection is established.
	 * @param cookieHeader - The value of the Cookie request header (may be undefined).
	 * @returns true if the request is authenticated, false otherwise.
	 */
	validateUpgradeSession?: (cookieHeader: string | undefined) => boolean;
	/**
	 * Interval between viewer liveness pings. Defaults to
	 * TERMINAL_WS_HEARTBEAT_INTERVAL_MS. Exposed so tests can use a short interval.
	 */
	heartbeatIntervalMs?: number;
	/**
	 * How long a backpressured viewer may go without acknowledging any output
	 * before it is treated as unable to drain and disconnected. Defaults to
	 * TERMINAL_WS_ACK_STALL_TIMEOUT_MS. Exposed so tests can use a short timeout.
	 */
	ackStallTimeoutMs?: number;
	/**
	 * How many unacknowledged bytes a viewer may hold while the PTY is paused
	 * before it is re-restored from a snapshot instead. Defaults to
	 * OUTPUT_VIEWER_PAUSE_BUDGET_BYTES. Exposed so tests can use a small budget.
	 */
	viewerPauseBudgetBytes?: number;
	/**
	 * How long in milliseconds a viewer may hold the PTY paused before it is
	 * re-restored from a snapshot instead. Defaults to
	 * OUTPUT_VIEWER_PAUSE_BUDGET_MS. Exposed so tests can use a short budget.
	 */
	viewerPauseBudgetMs?: number;
	/**
	 * How many bytes may be buffered for a viewer that has not completed restore
	 * before it is re-restored. Defaults to OUTPUT_VIEWER_PENDING_BUDGET_BYTES.
	 * Exposed so tests can use a small budget.
	 */
	viewerPendingBudgetBytes?: number;
	/**
	 * How many consecutive forced re-restores a viewer may receive before it is
	 * terminated instead. Defaults to OUTPUT_VIEWER_FORCED_RESTORE_LIMIT.
	 * Exposed so tests can use a small limit.
	 */
	forcedRestoreLimit?: number;
}

export interface TerminalWebSocketBridge {
	close: () => Promise<void>;
}

interface IoOutputState {
	enqueueOutput: (chunk: Buffer) => void;
	acknowledgeOutput: (bytes: number) => void;
	// Called when a viewer exceeds its budget: drops everything buffered for this
	// viewer and clears its flow-control state so the caller can re-restore it.
	discardOutputForReRestore: () => void;
	dispose: () => void;
}

// One PTY session can have many browser viewers at the same time.
// Keep shared stream ownership at the task level, then isolate restore,
// buffering, and socket replacement per clientId so one tab cannot evict another.
interface TerminalViewerState {
	clientId: string;
	pendingOutputChunks: Buffer[];
	pendingOutputBytes: number;
	restoreComplete: boolean;
	// Consecutive forced re-restores since the viewer last completed one. A viewer
	// that keeps overflowing without ever finishing restore is terminated after a
	// small number of attempts instead of being re-restored forever.
	forcedRestoreCount: number;
	ioState: IoOutputState | null;
	ioSocket: WebSocket | null;
	controlSocket: WebSocket | null;
	detachControlListener: (() => void) | null;
	flushPendingOutput: () => void;
}

interface TerminalStreamState {
	viewers: Map<string, TerminalViewerState>;
	// There is one real terminal process, but many browser tabs can watch it.
	// If one tab falls behind, we pause the shared PTY so it does not get flooded.
	// We cannot let a faster tab resume on its own, because the slower tab is still behind.
	// VS Code does the same basic thing for one terminal view by tracking unacknowledged
	// output and pausing once it crosses a high watermark, then resuming below a low watermark.
	// Our extra wrinkle is that one PTY can have many viewers, so we track every backpressured
	// viewer here and only resume once the last slow viewer catches up or disconnects.
	backpressuredViewerIds: Set<string>;
	detachOutputListener: (() => void) | null;
}

const OUTPUT_BATCH_INTERVAL_MS = 4;
const LOW_LATENCY_CHUNK_BYTES = 256;
const LOW_LATENCY_IDLE_WINDOW_MS = 5;
const OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES = 16 * 1024;
const OUTPUT_BUFFER_LOW_WATER_MARK_BYTES = Math.floor(OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES / 4);
const OUTPUT_ACK_HIGH_WATER_MARK_BYTES = 100_000;
const OUTPUT_ACK_LOW_WATER_MARK_BYTES = 5_000;
const OUTPUT_RESUME_CHECK_INTERVAL_MS = 16;
const TERMINAL_WS_HEARTBEAT_INTERVAL_MS = 30_000;
// A backgrounded or suspended browser tab keeps answering protocol-level pings
// (browsers pong from the network stack, without running JavaScript), so the
// heartbeat above cannot detect it. But its renderer is frozen, so it never
// sends output_ack, and a viewer that is already backpressured then holds
// pauseOutput() on the shared PTY forever. Treat "no ack progress while paused"
// as its own liveness signal and disconnect the viewer when it stalls.
const TERMINAL_WS_ACK_STALL_TIMEOUT_MS = 20_000;
// Flow control pauses the shared PTY, which blocks the agent process on stdout,
// so no single viewer may hold a pause open-ended. Give each viewer a byte and a
// wall-clock budget; past either, that viewer alone loses its buffered output and
// is re-restored from a snapshot while the PTY keeps running. Slow-but-progressing
// viewers stay well inside both budgets; only genuinely stalled ones are re-restored.
const OUTPUT_VIEWER_PAUSE_BUDGET_BYTES = 512 * 1024;
const OUTPUT_VIEWER_PAUSE_BUDGET_MS = 2_000;
// A viewer that connects but never sends restore_complete buffers every PTY chunk
// in runtime memory. Cap that buffer so a stuck viewer cannot leak memory without
// bound; on overflow it gets a fresh restore instead.
const OUTPUT_VIEWER_PENDING_BUDGET_BYTES = 512 * 1024;
// A forced re-restore clears outputPaused and the ack-stall timer, so a viewer
// that never completes restore would otherwise re-trigger the pending budget and
// be re-restored forever: the ack-stall watchdog needs outputPaused to fire, and
// the heartbeat cannot see a backgrounded tab (it still pongs). Cap consecutive
// forced re-restores; past the limit, terminate the viewer exactly like the
// ack-stall watchdog does.
const OUTPUT_VIEWER_FORCED_RESTORE_LIMIT = 3;

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

function buildConnectionKey(workspaceId: string, taskId: string): string {
	return `${workspaceId}:${taskId}`;
}

function getTerminalClientId(url: URL): string {
	return url.searchParams.get("clientId")?.trim() || "legacy";
}

// Browser viewer sockets can die without a clean close (laptop lid, dropped SSH
// tunnel, killed browser). The ws library then keeps them OPEN indefinitely, and
// while such a zombie viewer is backpressured it holds pauseOutput() on the shared
// PTY forever, which blocks the agent process on its stdout writes.
//
// Ping every viewer periodically and terminate any socket that misses a pong. The
// normal close handlers then run and release the viewer's backpressure claim.
function startWebSocketHeartbeat(wss: WebSocketServer, intervalMs: number): () => void {
	const aliveSockets = new WeakSet<WebSocket>();
	const onConnection = (client: WebSocket) => {
		aliveSockets.add(client);
		client.on("pong", () => {
			aliveSockets.add(client);
		});
	};
	wss.on("connection", onConnection);
	const timer = setInterval(() => {
		for (const client of wss.clients) {
			if (client.readyState !== WebSocket.OPEN) {
				continue;
			}
			if (!aliveSockets.has(client)) {
				client.terminate();
				continue;
			}
			aliveSockets.delete(client);
			try {
				client.ping();
			} catch {
				client.terminate();
			}
		}
	}, intervalMs);
	timer.unref();
	return () => {
		clearInterval(timer);
		wss.off("connection", onConnection);
	};
}

export function createTerminalWebSocketBridge({
	server,
	resolveTerminalManager,
	isTerminalIoWebSocketPath,
	isTerminalControlWebSocketPath,
	validateUpgradeSession,
	heartbeatIntervalMs,
	ackStallTimeoutMs,
	viewerPauseBudgetBytes,
	viewerPauseBudgetMs,
	viewerPendingBudgetBytes,
	forcedRestoreLimit,
}: CreateTerminalWebSocketBridgeRequest): TerminalWebSocketBridge {
	const activeSockets = new Set<Socket>();
	const terminalStreamStates = new Map<string, TerminalStreamState>();
	server.on("connection", (socket: Socket) => {
		socket.setNoDelay(true);
		activeSockets.add(socket);
		socket.on("close", () => {
			activeSockets.delete(socket);
		});
	});

	const ioServer = new WebSocketServer({ noServer: true });
	const controlServer = new WebSocketServer({ noServer: true });
	const resolvedHeartbeatIntervalMs = heartbeatIntervalMs ?? TERMINAL_WS_HEARTBEAT_INTERVAL_MS;
	const resolvedAckStallTimeoutMs = ackStallTimeoutMs ?? TERMINAL_WS_ACK_STALL_TIMEOUT_MS;
	const resolvedViewerPauseBudgetBytes = viewerPauseBudgetBytes ?? OUTPUT_VIEWER_PAUSE_BUDGET_BYTES;
	const resolvedViewerPauseBudgetMs = viewerPauseBudgetMs ?? OUTPUT_VIEWER_PAUSE_BUDGET_MS;
	const resolvedViewerPendingBudgetBytes = viewerPendingBudgetBytes ?? OUTPUT_VIEWER_PENDING_BUDGET_BYTES;
	const resolvedForcedRestoreLimit = forcedRestoreLimit ?? OUTPUT_VIEWER_FORCED_RESTORE_LIMIT;
	const stopIoHeartbeat = startWebSocketHeartbeat(ioServer, resolvedHeartbeatIntervalMs);
	const stopControlHeartbeat = startWebSocketHeartbeat(controlServer, resolvedHeartbeatIntervalMs);

	const getOrCreateTerminalStreamState = (connectionKey: string): TerminalStreamState => {
		const existing = terminalStreamStates.get(connectionKey);
		if (existing) {
			return existing;
		}
		const created: TerminalStreamState = {
			viewers: new Map(),
			backpressuredViewerIds: new Set(),
			detachOutputListener: null,
		};
		terminalStreamStates.set(connectionKey, created);
		return created;
	};

	const cleanupTerminalStreamStateIfUnused = (connectionKey: string): void => {
		const state = terminalStreamStates.get(connectionKey);
		if (!state || state.viewers.size > 0) {
			return;
		}
		state.detachOutputListener?.();
		state.detachOutputListener = null;
		terminalStreamStates.delete(connectionKey);
	};

	const getOrCreateViewerState = (streamState: TerminalStreamState, clientId: string): TerminalViewerState => {
		const existing = streamState.viewers.get(clientId);
		if (existing) {
			return existing;
		}
		const created: TerminalViewerState = {
			clientId,
			pendingOutputChunks: [],
			pendingOutputBytes: 0,
			restoreComplete: false,
			forcedRestoreCount: 0,
			ioState: null,
			ioSocket: null,
			controlSocket: null,
			detachControlListener: null,
			flushPendingOutput: () => {
				if (!created.restoreComplete || !created.ioState || created.pendingOutputChunks.length === 0) {
					return;
				}
				for (const chunk of created.pendingOutputChunks) {
					created.ioState.enqueueOutput(chunk);
				}
				created.pendingOutputChunks = [];
				created.pendingOutputBytes = 0;
			},
		};
		streamState.viewers.set(clientId, created);
		return created;
	};

	const cleanupViewerStateIfUnused = (
		connectionKey: string,
		streamState: TerminalStreamState,
		viewerState: TerminalViewerState,
	): void => {
		if (viewerState.ioSocket || viewerState.controlSocket) {
			return;
		}
		viewerState.detachControlListener?.();
		viewerState.detachControlListener = null;
		streamState.viewers.delete(viewerState.clientId);
		cleanupTerminalStreamStateIfUnused(connectionKey);
	};

	const createIoOutputState = (
		ws: WebSocket,
		streamState: TerminalStreamState,
		clientId: string,
		taskId: string,
		terminalManager: TerminalSessionService,
		onPauseBudgetExceeded: () => void,
	): IoOutputState => {
		let pendingOutputChunks: Buffer[] = [];
		let outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
		let lastOutputSentAt = 0;
		let outputPaused = false;
		let resumeCheckTimer: ReturnType<typeof setTimeout> | null = null;
		// Armed whenever this viewer is holding the PTY paused. Any acknowledged
		// byte counts as progress and rearms it; expiry means the viewer is not
		// draining at all and must not keep the shared PTY blocked.
		let ackStallTimer: ReturnType<typeof setTimeout> | null = null;
		// Bounds how long this viewer may hold the PTY paused. Unlike the ack-stall
		// timer above, acks do not rearm it: partial progress still keeps the agent
		// blocked, so total pause time is capped and the timer restarts with each pause.
		let pauseBudgetTimer: ReturnType<typeof setTimeout> | null = null;
		// Same idea as VS Code terminal flow control: count output that has been sent
		// but not yet acknowledged as committed by the terminal renderer. We also look
		// at the websocket's own bufferedAmount so we catch both xterm lag and socket lag.
		let unacknowledgedOutputBytes = 0;

		const shouldPauseOutput = () =>
			ws.bufferedAmount >= OUTPUT_BUFFER_HIGH_WATER_MARK_BYTES ||
			unacknowledgedOutputBytes >= OUTPUT_ACK_HIGH_WATER_MARK_BYTES;

		const canResumeOutput = () =>
			ws.bufferedAmount < OUTPUT_BUFFER_LOW_WATER_MARK_BYTES &&
			unacknowledgedOutputBytes < OUTPUT_ACK_LOW_WATER_MARK_BYTES;

		const clearAckStallTimer = () => {
			if (ackStallTimer !== null) {
				clearTimeout(ackStallTimer);
				ackStallTimer = null;
			}
		};

		const armAckStallTimer = () => {
			clearAckStallTimer();
			ackStallTimer = setTimeout(() => {
				ackStallTimer = null;
				if (!outputPaused || ws.readyState !== ws.OPEN) {
					return;
				}
				// This viewer may still be answering pings, but it has acknowledged
				// nothing for a full timeout while holding the PTY paused. Terminate
				// it; the normal close handler releases its backpressure claim and
				// resumes the PTY. A returning tab reconnects and gets a fresh restore.
				ws.terminate();
			}, resolvedAckStallTimeoutMs);
			ackStallTimer.unref?.();
		};

		const clearPauseBudgetTimer = () => {
			if (pauseBudgetTimer !== null) {
				clearTimeout(pauseBudgetTimer);
				pauseBudgetTimer = null;
			}
		};

		const armPauseBudgetTimer = () => {
			clearPauseBudgetTimer();
			pauseBudgetTimer = setTimeout(() => {
				pauseBudgetTimer = null;
				if (!outputPaused || ws.readyState !== ws.OPEN) {
					return;
				}
				// This viewer has held the PTY paused for its entire budget, so the
				// agent has been blocked on stdout the whole time. Release the pause
				// and re-restore this viewer from a snapshot instead of waiting longer.
				onPauseBudgetExceeded();
			}, resolvedViewerPauseBudgetMs);
			pauseBudgetTimer.unref?.();
		};

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
			if (canResumeOutput()) {
				outputPaused = false;
				clearResumeCheck();
				clearAckStallTimer();
				clearPauseBudgetTimer();
				streamState.backpressuredViewerIds.delete(clientId);
				if (streamState.backpressuredViewerIds.size === 0) {
					terminalManager.resumeOutput(taskId);
				}
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

		const checkBackpressureAfterSend = (chunk: Buffer) => {
			if (outputPaused || ws.readyState !== ws.OPEN) {
				return;
			}
			unacknowledgedOutputBytes += chunk.byteLength;
			if (shouldPauseOutput()) {
				outputPaused = true;
				const previouslyPaused = streamState.backpressuredViewerIds.size > 0;
				streamState.backpressuredViewerIds.add(clientId);
				if (!previouslyPaused) {
					terminalManager.pauseOutput(taskId);
				}
				// A single chunk can overshoot the watermarks by more than the entire
				// budget; re-restore immediately instead of pausing on a deficit that
				// cannot drain in time.
				if (unacknowledgedOutputBytes >= resolvedViewerPauseBudgetBytes) {
					onPauseBudgetExceeded();
					return;
				}
				armAckStallTimer();
				armPauseBudgetTimer();
				scheduleResumeCheck();
			}
		};

		const sendOutputChunk = (chunk: Buffer) => {
			if (ws.readyState !== ws.OPEN) {
				return;
			}
			ws.send(chunk);
			lastOutputSentAt = Date.now();
			checkBackpressureAfterSend(chunk);
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

		return {
			enqueueOutput: (chunk: Buffer) => {
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
			},
			acknowledgeOutput: (bytes: number) => {
				const acknowledgedBytes = Math.max(0, Math.floor(bytes));
				unacknowledgedOutputBytes = Math.max(0, unacknowledgedOutputBytes - acknowledgedBytes);
				// A viewer that drains slowly is fine; a viewer that drains nothing is not.
				// Rearm on progress so only a fully stalled renderer trips the watchdog.
				if (acknowledgedBytes > 0 && outputPaused) {
					armAckStallTimer();
				}
				checkResumeAfterBackpressure();
			},
			// Drop everything buffered for this viewer and reset its flow control so
			// the caller can re-restore it. Backpressure bookkeeping on streamState
			// is the caller's job, because the PTY only resumes when no viewer is left.
			discardOutputForReRestore: () => {
				if (outputFlushTimer !== null) {
					clearTimeout(outputFlushTimer);
					outputFlushTimer = null;
				}
				pendingOutputChunks = [];
				clearResumeCheck();
				clearAckStallTimer();
				clearPauseBudgetTimer();
				outputPaused = false;
				unacknowledgedOutputBytes = 0;
			},
			dispose: () => {
				if (outputFlushTimer !== null) {
					clearTimeout(outputFlushTimer);
					outputFlushTimer = null;
				}
				clearResumeCheck();
				clearAckStallTimer();
				clearPauseBudgetTimer();
				if (outputPaused) {
					outputPaused = false;
					streamState.backpressuredViewerIds.delete(clientId);
					if (streamState.backpressuredViewerIds.size === 0) {
						terminalManager.resumeOutput(taskId);
					}
				}
				pendingOutputChunks = [];
			},
		};
	};

	const sendRestoreToViewer = (
		viewerState: TerminalViewerState,
		taskId: string,
		terminalManager: TerminalSessionService,
		forceReapply: boolean,
	): void => {
		const controlSocket = viewerState.controlSocket;
		if (!controlSocket) {
			return;
		}
		void terminalManager
			.getRestoreSnapshot(taskId)
			.then((snapshot) => {
				sendControlMessage(controlSocket, {
					type: "restore",
					snapshot: snapshot?.snapshot ?? "",
					cols: snapshot?.cols ?? null,
					rows: snapshot?.rows ?? null,
					// A forced re-restore replaces output the viewer never committed, so
					// it must be applied unconditionally. Omitting restoreGeneration is
					// what guarantees that: clients skip restores whose generation they
					// already applied, and this one must not be skipped.
					restoreGeneration: forceReapply ? undefined : snapshot?.restoreGeneration,
				});
			})
			.catch(() => {
				sendControlMessage(controlSocket, {
					type: "restore",
					snapshot: "",
					cols: null,
					rows: null,
				});
			});
	};

	// Recovery for a viewer that exceeded its pause or pending budget: drop
	// everything buffered for it, release its claim on the shared PTY, and resync
	// it from a snapshot. The socket stays open and no other viewer is affected;
	// the stalled viewer loses scrollback it never rendered, the agent keeps running.
	const reRestoreViewer = (
		streamState: TerminalStreamState,
		viewerState: TerminalViewerState,
		taskId: string,
		terminalManager: TerminalSessionService,
	): void => {
		viewerState.ioState?.discardOutputForReRestore();
		viewerState.pendingOutputChunks = [];
		viewerState.pendingOutputBytes = 0;
		viewerState.restoreComplete = false;
		const wasBackpressured = streamState.backpressuredViewerIds.delete(viewerState.clientId);
		if (wasBackpressured && streamState.backpressuredViewerIds.size === 0) {
			terminalManager.resumeOutput(taskId);
		}
		if (viewerState.forcedRestoreCount >= resolvedForcedRestoreLimit) {
			// Every re-restore attempt so far ended with this viewer still unable to
			// complete restore, so it cannot recover and must not keep generating
			// snapshot work forever. Fall back to the ack-stall watchdog's behavior:
			// terminate the io socket and let the normal close path clean up. A
			// returning tab reconnects and gets a fresh restore.
			viewerState.ioSocket?.terminate();
			return;
		}
		viewerState.forcedRestoreCount += 1;
		sendRestoreToViewer(viewerState, taskId, terminalManager, true);
	};

	const ensureOutputListener = (
		streamState: TerminalStreamState,
		taskId: string,
		terminalManager: TerminalSessionService,
	): void => {
		if (streamState.detachOutputListener) {
			return;
		}
		// Attach PTY output once per task session and fan it out to every viewer.
		// Earlier code attached per websocket, which made the same task effectively
		// last-viewer-wins across tabs.
		streamState.detachOutputListener = terminalManager.attach(taskId, {
			onOutput: (chunk) => {
				for (const viewerState of streamState.viewers.values()) {
					if (viewerState.restoreComplete && viewerState.ioState) {
						viewerState.ioState.enqueueOutput(chunk);
						continue;
					}
					viewerState.pendingOutputChunks.push(chunk);
					viewerState.pendingOutputBytes += chunk.byteLength;
					if (viewerState.pendingOutputBytes > resolvedViewerPendingBudgetBytes) {
						reRestoreViewer(streamState, viewerState, taskId, terminalManager);
					}
				}
			},
		});
	};

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
			if (handleSocketUpgrade(request, socket).end) {
				return;
			}
			// ── Passcode gate for terminal WebSocket upgrades ─────────────────
			if (validateUpgradeSession !== undefined && !validateUpgradeSession(request.headers.cookie)) {
				(socket as Socket).write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
				(socket as Socket).destroy();
				return;
			}
			// ── End passcode gate ─────────────────────────────────────────────
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
			const clientId = getTerminalClientId(url);
			targetServer.handleUpgrade(request, socket, head, (ws: WebSocket) => {
				targetServer.emit("connection", ws, { taskId, workspaceId, clientId, terminalManager });
			});
		} catch {
			socket.destroy();
		}
	});

	ioServer.on("connection", (ws: WebSocket, context: unknown) => {
		const taskId = (context as TerminalWebSocketConnectionContext).taskId;
		const workspaceId = (context as TerminalWebSocketConnectionContext).workspaceId;
		const clientId = (context as TerminalWebSocketConnectionContext).clientId;
		const terminalManager = (context as TerminalWebSocketConnectionContext).terminalManager;
		const connectionKey = buildConnectionKey(workspaceId, taskId);
		terminalManager.recoverStaleSession(taskId);
		const streamState = getOrCreateTerminalStreamState(connectionKey);
		const viewerState = getOrCreateViewerState(streamState, clientId);
		const previousIoSocket = viewerState.ioSocket;
		viewerState.ioState?.dispose();
		viewerState.ioState = createIoOutputState(ws, streamState, clientId, taskId, terminalManager, () =>
			reRestoreViewer(streamState, viewerState, taskId, terminalManager),
		);
		viewerState.ioSocket = ws;
		viewerState.flushPendingOutput();
		ensureOutputListener(streamState, taskId, terminalManager);
		if (previousIoSocket && previousIoSocket !== ws) {
			previousIoSocket.close(1000, "Replaced by newer terminal stream.");
		}

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
			if (viewerState.ioSocket !== ws) {
				return;
			}
			viewerState.ioSocket = null;
			viewerState.ioState?.dispose();
			viewerState.ioState = null;
			cleanupViewerStateIfUnused(connectionKey, streamState, viewerState);
		});
	});

	controlServer.on("connection", (ws: WebSocket, context: unknown) => {
		const taskId = (context as TerminalWebSocketConnectionContext).taskId;
		const workspaceId = (context as TerminalWebSocketConnectionContext).workspaceId;
		const clientId = (context as TerminalWebSocketConnectionContext).clientId;
		const terminalManager = (context as TerminalWebSocketConnectionContext).terminalManager;
		const connectionKey = buildConnectionKey(workspaceId, taskId);
		terminalManager.recoverStaleSession(taskId);
		const streamState = getOrCreateTerminalStreamState(connectionKey);
		const viewerState = getOrCreateViewerState(streamState, clientId);
		const previousControlSocket = viewerState.controlSocket;
		viewerState.restoreComplete = false;
		viewerState.pendingOutputChunks = [];
		viewerState.pendingOutputBytes = 0;
		viewerState.forcedRestoreCount = 0;
		viewerState.controlSocket = ws;
		ensureOutputListener(streamState, taskId, terminalManager);
		viewerState.detachControlListener?.();
		viewerState.detachControlListener = terminalManager.attach(taskId, {
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
		if (previousControlSocket && previousControlSocket !== ws) {
			previousControlSocket.close(1000, "Replaced by newer terminal control connection.");
		}

		sendRestoreToViewer(viewerState, taskId, terminalManager, false);

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
				terminalManager.resize(taskId, message.cols, message.rows, message.pixelWidth, message.pixelHeight);
				return;
			}

			if (message.type === "stop") {
				terminalManager.stopTaskSession(taskId);
				return;
			}

			if (message.type === "output_ack") {
				viewerState.ioState?.acknowledgeOutput(message.bytes);
				return;
			}

			if (message.type === "restore_complete") {
				viewerState.restoreComplete = true;
				// A completed restore is genuine progress: the viewer recovered, so a
				// much later unrelated overflow must not count against earlier ones.
				viewerState.forcedRestoreCount = 0;
				viewerState.flushPendingOutput();
			}
		});

		ws.on("close", () => {
			if (viewerState.controlSocket !== ws) {
				return;
			}
			viewerState.controlSocket = null;
			viewerState.detachControlListener?.();
			viewerState.detachControlListener = null;
			cleanupViewerStateIfUnused(connectionKey, streamState, viewerState);
		});
	});

	return {
		close: async () => {
			stopIoHeartbeat();
			stopControlHeartbeat();
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
