import "@xterm/xterm/css/xterm.css";

import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { encodeTextToBase64, decodeBase64ToText } from "@/kanban/terminal/base64";
import type {
	RuntimeTaskSessionSummary,
	RuntimeTerminalWsClientMessage,
	RuntimeTerminalWsServerMessage,
} from "@/kanban/runtime/types";

function getWebSocketUrl(taskId: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/terminal/ws`);
	url.searchParams.set("taskId", taskId);
	return url.toString();
}

function describeState(summary: RuntimeTaskSessionSummary | null): string {
	if (!summary) {
		return "No session yet";
	}
	if (summary.state === "running") {
		return "Running";
	}
	if (summary.state === "awaiting_review") {
		return "Ready for review";
	}
	if (summary.state === "interrupted") {
		return "Interrupted";
	}
	if (summary.state === "failed") {
		return "Failed";
	}
	return "Idle";
}

export function AgentTerminalPanel({
	taskId,
	summary,
	onSummary,
	onMoveToTrash,
	showMoveToTrash,
}: {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
	onSummary?: (summary: RuntimeTaskSessionSummary) => void;
	onMoveToTrash?: () => void;
	showMoveToTrash?: boolean;
}): React.ReactElement {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const [lastError, setLastError] = useState<string | null>(null);
	const [isStopping, setIsStopping] = useState(false);

	const sendMessage = useCallback((message: RuntimeTerminalWsClientMessage) => {
		const socket = socketRef.current;
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
		sendMessage({
			type: "resize",
			cols: terminal.cols,
			rows: terminal.rows,
		});
	}, [sendMessage]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 12,
			fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			theme: {
				background: "#0D1117",
				foreground: "#c9d1d9",
				cursor: "#58a6ff",
			},
		});
		const fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());
		terminal.open(container);
		fitAddon.fit();

		terminalRef.current = terminal;
		fitAddonRef.current = fitAddon;

		const removeDataListener = terminal.onData((value) => {
			sendMessage({
				type: "input",
				data: encodeTextToBase64(value),
			});
		});

		const resizeObserver = new ResizeObserver(() => {
			requestResize();
		});
		resizeObserver.observe(container);

		return () => {
			removeDataListener.dispose();
			resizeObserver.disconnect();
			fitAddonRef.current = null;
			terminalRef.current = null;
			terminal.dispose();
		};
	}, [requestResize, sendMessage]);

	useEffect(() => {
		const ws = new WebSocket(getWebSocketUrl(taskId));
		socketRef.current = ws;
		setLastError(null);

		ws.onopen = () => {
			requestResize();
		};

		ws.onmessage = (event) => {
			try {
				const payload = JSON.parse(String(event.data)) as RuntimeTerminalWsServerMessage;
				if (payload.type === "output") {
					terminalRef.current?.write(decodeBase64ToText(payload.data));
					return;
				}
				if (payload.type === "state") {
					onSummary?.(payload.summary);
					return;
				}
				if (payload.type === "exit") {
					const label = payload.code == null ? "session exited" : `session exited with code ${payload.code}`;
					terminalRef.current?.writeln(`\r\n[kanbanana] ${label}\r\n`);
					setIsStopping(false);
					return;
				}
				if (payload.type === "error") {
					setLastError(payload.message);
					terminalRef.current?.writeln(`\r\n[kanbanana] ${payload.message}\r\n`);
				}
			} catch {
				// Ignore malformed frames.
			}
		};

		ws.onerror = () => {
			setLastError("Terminal connection failed.");
		};

		return () => {
			if (socketRef.current === ws) {
				socketRef.current = null;
			}
			ws.close();
		};
	}, [onSummary, requestResize, taskId]);

	const handleStop = useCallback(async () => {
		setIsStopping(true);
		sendMessage({ type: "stop" });
		try {
			await fetch("/api/runtime/task-session/stop", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ taskId }),
			});
		} catch {
			// Keep terminal usable even if stop API fails.
		}
		setIsStopping(false);
	}, [sendMessage, taskId]);

	const handleClear = useCallback(() => {
		terminalRef.current?.clear();
	}, []);

	const canStop = summary?.state === "running" || summary?.state === "awaiting_review";
	const statusLabel = useMemo(() => describeState(summary), [summary]);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border bg-background">
			{showMoveToTrash && onMoveToTrash ? (
				<div className="border-b border-border px-3 py-2">
					<Button type="button" variant="destructive" className="w-full" onClick={onMoveToTrash}>
						Move Card To Trash
					</Button>
				</div>
			) : null}
			<div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
				<div className="min-w-0 text-muted-foreground">
					<span className="text-foreground">{statusLabel}</span>
					{summary?.lastActivityLine ? <span className="ml-2 truncate">{summary.lastActivityLine}</span> : null}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button type="button" variant="outline" size="sm" onClick={handleClear}>
						Clear
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							void handleStop();
						}}
						disabled={!canStop || isStopping}
					>
						Stop
					</Button>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-hidden p-2">
				<div ref={containerRef} className="h-full w-full bg-background" />
			</div>
			{lastError ? <p className="border-t border-border px-3 py-2 text-xs text-red-300">{lastError}</p> : null}
		</div>
	);
}
