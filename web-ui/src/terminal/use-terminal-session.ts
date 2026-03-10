import { Colors } from "@blueprintjs/core";
import { AttachAddon } from "@xterm/addon-attach";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeTaskSessionSummary, RuntimeTerminalWsClientMessage, RuntimeTerminalWsServerMessage } from "@/runtime/types";
import { registerTerminalController } from "@/terminal/terminal-controller-registry";
import { clearTerminalGeometry, reportTerminalGeometry } from "@/terminal/terminal-geometry-registry";

const SHIFT_ENTER_SEQUENCE = "\n";
const RESIZE_DEBOUNCE_MS = 50;
const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

function getTerminalIoWebSocketUrl(taskId: string, workspaceId: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/terminal/io`);
	url.searchParams.set("taskId", taskId);
	url.searchParams.set("workspaceId", workspaceId);
	return url.toString();
}

function getTerminalControlWebSocketUrl(taskId: string, workspaceId: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/terminal/control`);
	url.searchParams.set("taskId", taskId);
	url.searchParams.set("workspaceId", workspaceId);
	return url.toString();
}

function isCopyShortcut(event: KeyboardEvent): boolean {
	return (
		event.type === "keydown" &&
		((isMacPlatform && event.metaKey && !event.shiftKey && event.key.toLowerCase() === "c") ||
			(!isMacPlatform && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c"))
	);
}

function isPasteShortcut(event: KeyboardEvent): boolean {
	return (
		event.type === "keydown" &&
		((isMacPlatform && event.metaKey && !event.shiftKey && event.key.toLowerCase() === "v") ||
			(!isMacPlatform &&
				((event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v") ||
					(event.shiftKey && event.key === "Insert"))))
	);
}

interface UseTerminalSessionInput {
	taskId: string;
	workspaceId: string | null;
	onSummary?: (summary: RuntimeTaskSessionSummary) => void;
	onConnectionReady?: (taskId: string) => void;
	autoFocus?: boolean;
	isVisible?: boolean;
	terminalBackgroundColor: string;
	cursorColor: string;
}

export interface UseTerminalSessionResult {
	containerRef: MutableRefObject<HTMLDivElement | null>;
	lastError: string | null;
	isStopping: boolean;
	clearTerminal: () => void;
	stopTerminal: () => Promise<void>;
}

export function useTerminalSession({
	taskId,
	workspaceId,
	onSummary,
	onConnectionReady,
	autoFocus = false,
	isVisible = true,
	terminalBackgroundColor,
	cursorColor,
}: UseTerminalSessionInput): UseTerminalSessionResult {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const controlSocketRef = useRef<WebSocket | null>(null);
	const ioSocketRef = useRef<WebSocket | null>(null);
	const attachAddonRef = useRef<AttachAddon | null>(null);
	const [lastError, setLastError] = useState<string | null>(null);
	const [isStopping, setIsStopping] = useState(false);

	const sendControlMessage = useCallback((message: RuntimeTerminalWsClientMessage) => {
		const socket = controlSocketRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return;
		}
		socket.send(JSON.stringify(message));
	}, []);

	const requestResize = useCallback(() => {
		const fitAddon = fitAddonRef.current;
		const terminal = terminalRef.current;
		if (!fitAddon || !terminal) {
			return;
		}
		fitAddon.fit();
		reportTerminalGeometry(taskId, {
			cols: terminal.cols,
			rows: terminal.rows,
		});
		sendControlMessage({
			type: "resize",
			cols: terminal.cols,
			rows: terminal.rows,
		});
	}, [sendControlMessage, taskId]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 12,
			fontFamily:
				'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			theme: {
				background: terminalBackgroundColor,
				foreground: Colors.LIGHT_GRAY5,
				cursor: cursorColor,
				selectionBackground: `${Colors.BLUE3}4D`,
			},
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new ClipboardAddon());
		terminal.loadAddon(new WebLinksAddon());
		terminal.open(container);

		try {
			const webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon.dispose();
			});
			terminal.loadAddon(webglAddon);
		} catch {
			// Fall back to the default renderer when WebGL is unavailable.
		}

		fitAddon.fit();
		reportTerminalGeometry(taskId, {
			cols: terminal.cols,
			rows: terminal.rows,
		});
		if (autoFocus) {
			window.requestAnimationFrame(() => {
				terminal.focus();
			});
		}

		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;
		terminal.attachCustomKeyEventHandler((event) => {
			if (event.key === "Enter" && event.shiftKey) {
				if (event.type === "keydown") {
					terminal.input(SHIFT_ENTER_SEQUENCE);
				}
				return false;
			}
			if (isCopyShortcut(event) && terminal.hasSelection()) {
				void navigator.clipboard.writeText(terminal.getSelection()).catch(() => {
					// Ignore clipboard write failures.
				});
				return false;
			}
			if (isPasteShortcut(event)) {
				void navigator.clipboard
					.readText()
					.then((text) => {
						if (text.length > 0) {
							terminal.paste(text);
						}
					})
					.catch(() => {
						// Ignore clipboard read failures.
					});
				return false;
			}
			return true;
		});

		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const resizeObserver = new ResizeObserver(() => {
			if (resizeTimer !== null) {
				clearTimeout(resizeTimer);
			}
			resizeTimer = setTimeout(() => {
				resizeTimer = null;
				requestResize();
			}, RESIZE_DEBOUNCE_MS);
		});
		resizeObserver.observe(container);

		return () => {
			resizeObserver.disconnect();
			if (resizeTimer !== null) {
				clearTimeout(resizeTimer);
			}
			clearTerminalGeometry(taskId);
			fitAddonRef.current = null;
			terminalRef.current = null;
			terminal.dispose();
		};
	}, [autoFocus, cursorColor, requestResize, taskId, terminalBackgroundColor]);

	useEffect(() => {
		if (!isVisible) {
			return;
		}
		const frame = window.requestAnimationFrame(() => {
			requestResize();
			if (autoFocus) {
				terminalRef.current?.focus();
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [autoFocus, isVisible, requestResize]);

	useEffect(() => {
		return registerTerminalController(taskId, {
			input: (text) => {
				const terminal = terminalRef.current;
				const ioSocket = ioSocketRef.current;
				if (!terminal || !ioSocket || ioSocket.readyState !== WebSocket.OPEN) {
					return false;
				}
				terminal.input(text);
				return true;
			},
			paste: (text) => {
				const terminal = terminalRef.current;
				const ioSocket = ioSocketRef.current;
				if (!terminal || !ioSocket || ioSocket.readyState !== WebSocket.OPEN) {
					return false;
				}
				terminal.paste(text);
				return true;
			},
		});
	}, [taskId]);

	useEffect(() => {
		const terminal = terminalRef.current;
		if (!terminal) {
			return;
		}
		terminal.reset();
		setIsStopping(false);
		setLastError(null);
	}, [taskId, workspaceId]);

	useEffect(() => {
		if (!workspaceId) {
			setLastError("No project selected.");
			return;
		}
		let disposed = false;
		const terminal = terminalRef.current;
		if (!terminal) {
			return;
		}
		const ioSocket = new WebSocket(getTerminalIoWebSocketUrl(taskId, workspaceId));
		ioSocketRef.current = ioSocket;
		setLastError(null);

		ioSocket.onopen = () => {
			if (disposed) {
				return;
			}
			const attachAddon = new AttachAddon(ioSocket);
			attachAddonRef.current = attachAddon;
			terminal.loadAddon(attachAddon);
			setLastError(null);
			onConnectionReady?.(taskId);
		};
		ioSocket.onerror = () => {
			if (disposed) {
				return;
			}
			setLastError("Terminal stream failed.");
		};
		ioSocket.onclose = () => {
			if (disposed) {
				return;
			}
			if (ioSocketRef.current === ioSocket) {
				ioSocketRef.current = null;
			}
			if (attachAddonRef.current) {
				attachAddonRef.current.dispose();
				attachAddonRef.current = null;
			}
			setLastError("Terminal stream closed. Close and reopen to reconnect.");
			setIsStopping(false);
		};

		return () => {
			disposed = true;
			if (attachAddonRef.current) {
				attachAddonRef.current.dispose();
				attachAddonRef.current = null;
			}
			if (ioSocketRef.current === ioSocket) {
				ioSocketRef.current = null;
			}
			ioSocket.close();
		};
	}, [onConnectionReady, taskId, workspaceId]);

	useEffect(() => {
		if (!workspaceId) {
			return;
		}
		let disposed = false;
		const controlSocket = new WebSocket(getTerminalControlWebSocketUrl(taskId, workspaceId));
		controlSocketRef.current = controlSocket;

		controlSocket.onopen = () => {
			if (disposed) {
				return;
			}
			setLastError(null);
			requestResize();
		};

		controlSocket.onmessage = (event) => {
			try {
				const payload = JSON.parse(String(event.data)) as RuntimeTerminalWsServerMessage;
				if (payload.type === "state") {
					onSummary?.(payload.summary);
					return;
				}
				if (payload.type === "exit") {
					const label = payload.code == null ? "session exited" : `session exited with code ${payload.code}`;
					terminalRef.current?.writeln(`\r\n[kanban] ${label}\r\n`);
					setIsStopping(false);
					return;
				}
				if (payload.type === "error") {
					setLastError(payload.message);
					terminalRef.current?.writeln(`\r\n[kanban] ${payload.message}\r\n`);
				}
			} catch {
				// Ignore malformed frames.
			}
		};

		controlSocket.onerror = () => {
			if (disposed) {
				return;
			}
			setLastError("Terminal control connection failed.");
		};

		controlSocket.onclose = () => {
			if (disposed) {
				return;
			}
			if (controlSocketRef.current === controlSocket) {
				controlSocketRef.current = null;
			}
			setLastError("Terminal control connection closed. Close and reopen to reconnect.");
			setIsStopping(false);
		};

		return () => {
			disposed = true;
			if (controlSocketRef.current === controlSocket) {
				controlSocketRef.current = null;
			}
			controlSocket.close();
		};
	}, [onSummary, requestResize, taskId, workspaceId]);

	const stopTerminal = useCallback(async () => {
		setIsStopping(true);
		sendControlMessage({ type: "stop" });
		try {
			if (workspaceId) {
				const trpcClient = getRuntimeTrpcClient(workspaceId);
				await trpcClient.runtime.stopTaskSession.mutate({ taskId });
			}
		} catch {
			// Keep terminal usable even if stop API fails.
		}
		setIsStopping(false);
	}, [sendControlMessage, taskId, workspaceId]);

	const clearTerminal = useCallback(() => {
		terminalRef.current?.clear();
	}, []);

	return {
		containerRef,
		lastError,
		isStopping,
		clearTerminal,
		stopTerminal,
	};
}
