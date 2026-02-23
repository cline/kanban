import "@xterm/xterm/css/xterm.css";

import { Button, Callout, Classes, Colors, Divider, Tag } from "@blueprintjs/core";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { panelSeparatorColor } from "@/kanban/data/column-colors";
import { encodeTextToBase64, decodeBase64ToText } from "@/kanban/terminal/base64";
import type {
	RuntimeTaskSessionSummary,
	RuntimeTerminalWsClientMessage,
	RuntimeTerminalWsServerMessage,
} from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";

function getWebSocketUrl(taskId: string, workspaceId: string): string {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const url = new URL(`${protocol}//${window.location.host}/api/terminal/ws`);
	url.searchParams.set("taskId", taskId);
	url.searchParams.set("workspaceId", workspaceId);
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

function getStateIntent(summary: RuntimeTaskSessionSummary | null): "none" | "success" | "warning" | "danger" {
	if (!summary) {
		return "none";
	}
	if (summary.state === "running") {
		return "success";
	}
	if (summary.state === "awaiting_review") {
		return "warning";
	}
	if (summary.state === "interrupted" || summary.state === "failed") {
		return "danger";
	}
	return "none";
}

export function AgentTerminalPanel({
	taskId,
	workspaceId,
	summary,
	onSummary,
	onMoveToTrash,
	showMoveToTrash,
}: {
	taskId: string;
	workspaceId: string | null;
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
				background: Colors.DARK_GRAY1,
				foreground: Colors.LIGHT_GRAY5,
				cursor: Colors.BLUE3,
				selectionBackground: `${Colors.BLUE3}4D`,
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
		if (!workspaceId) {
			setLastError("No project selected.");
			return;
		}
		const ws = new WebSocket(getWebSocketUrl(taskId, workspaceId));
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
	}, [onSummary, requestResize, taskId, workspaceId]);

	const handleStop = useCallback(async () => {
		setIsStopping(true);
		sendMessage({ type: "stop" });
			try {
				await workspaceFetch("/api/runtime/task-session/stop", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ taskId }),
					workspaceId,
				});
			} catch {
				// Keep terminal usable even if stop API fails.
			}
			setIsStopping(false);
		}, [sendMessage, taskId, workspaceId]);

	const handleClear = useCallback(() => {
		terminalRef.current?.clear();
	}, []);

	const canStop = summary?.state === "running" || summary?.state === "awaiting_review";
	const statusLabel = useMemo(() => describeState(summary), [summary]);
	const statusIntent = useMemo(() => getStateIntent(summary), [summary]);

	return (
		<div style={{ display: "flex", flex: "1 1 0", flexDirection: "column", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1, borderRight: `1px solid ${panelSeparatorColor}` }}>
			{showMoveToTrash && onMoveToTrash ? (
				<>
					<div style={{ padding: "8px 12px" }}>
						<Button intent="danger" text="Move Card To Trash" fill onClick={onMoveToTrash} />
					</div>
					<Divider />
				</>
			) : null}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px" }}>
				<div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
					<Tag intent={statusIntent} minimal>{statusLabel}</Tag>
					{summary?.lastActivityLine ? (
						<span className={`${Classes.TEXT_MUTED} ${Classes.TEXT_OVERFLOW_ELLIPSIS}`}>{summary.lastActivityLine}</span>
					) : null}
				</div>
				<div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
					<Button text="Clear" variant="outlined" size="small" onClick={handleClear} />
					<Button
						text="Stop"
						variant="outlined"
						size="small"
						onClick={() => { void handleStop(); }}
						disabled={!canStop || isStopping}
					/>
				</div>
			</div>
			<Divider />
			<div style={{ flex: "1 1 0", minHeight: 0, overflow: "hidden", padding: 4 }}>
				<div ref={containerRef} style={{ height: "100%", width: "100%" }} />
			</div>
			{lastError ? (
				<Callout intent="danger" compact style={{ borderRadius: 0 }}>
					{lastError}
				</Callout>
			) : null}
		</div>
	);
}
