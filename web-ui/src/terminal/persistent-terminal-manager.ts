import { AttachAddon } from "@xterm/addon-attach";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { estimateTaskSessionGeometry } from "@/runtime/task-session-geometry";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeTaskSessionSummary,
	RuntimeTerminalWsClientMessage,
	RuntimeTerminalWsServerMessage,
} from "@/runtime/types";
import { clearTerminalGeometry, reportTerminalGeometry } from "@/terminal/terminal-geometry-registry";
import { createKanbanTerminalOptions } from "@/terminal/terminal-options";

const SHIFT_ENTER_SEQUENCE = "\n";
const RESIZE_DEBOUNCE_MS = 50;
const PARKING_ROOT_ID = "kb-persistent-terminal-parking-root";
const isMacPlatform =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

interface PersistentTerminalAppearance {
	cursorColor: string;
	terminalBackgroundColor: string;
}

interface PersistentTerminalSubscriber {
	onConnectionReady?: (taskId: string) => void;
	onLastError?: (message: string | null) => void;
	onSummary?: (summary: RuntimeTaskSessionSummary) => void;
}

interface MountPersistentTerminalOptions {
	autoFocus?: boolean;
	isVisible?: boolean;
}

interface EnsurePersistentTerminalInput extends PersistentTerminalAppearance {
	taskId: string;
	workspaceId: string;
}

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

function getParkingRoot(): HTMLDivElement {
	const existingRoot = document.getElementById(PARKING_ROOT_ID);
	if (existingRoot instanceof HTMLDivElement) {
		return existingRoot;
	}
	const root = document.createElement("div");
	root.id = PARKING_ROOT_ID;
	root.setAttribute("aria-hidden", "true");
	Object.assign(root.style, {
		position: "fixed",
		left: "-10000px",
		top: "-10000px",
		width: "1px",
		height: "1px",
		overflow: "hidden",
		opacity: "0",
		pointerEvents: "none",
	});
	document.body.appendChild(root);
	return root;
}

function buildKey(workspaceId: string, taskId: string): string {
	return `${workspaceId}:${taskId}`;
}

class PersistentTerminal {
	private readonly terminal: Terminal;
	private readonly fitAddon = new FitAddon();
	private readonly hostElement: HTMLDivElement;
	private readonly subscribers = new Set<PersistentTerminalSubscriber>();
	private readonly parkingRoot: HTMLDivElement;
	private readonly unicode11Addon = new Unicode11Addon();
	private appearance: PersistentTerminalAppearance;
	private latestSummary: RuntimeTaskSessionSummary | null = null;
	private lastError: string | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private resizeTimer: ReturnType<typeof setTimeout> | null = null;
	private visibleContainer: HTMLDivElement | null = null;
	private ioSocket: WebSocket | null = null;
	private controlSocket: WebSocket | null = null;
	private attachAddon: AttachAddon | null = null;
	private connectionReady = false;
	private disposed = false;

	constructor(
		private readonly taskId: string,
		private readonly workspaceId: string,
		appearance: PersistentTerminalAppearance,
	) {
		this.appearance = appearance;
		this.parkingRoot = getParkingRoot();
		this.hostElement = document.createElement("div");
		Object.assign(this.hostElement.style, {
			width: "100%",
			height: "100%",
		});
		this.parkingRoot.appendChild(this.hostElement);
		const initialGeometry = estimateTaskSessionGeometry(window.innerWidth, window.innerHeight);

		this.terminal = new Terminal({
			...createKanbanTerminalOptions({
				cursorColor: this.appearance.cursorColor,
				isMacPlatform,
				terminalBackgroundColor: this.appearance.terminalBackgroundColor,
			}),
			cols: initialGeometry.cols,
			rows: initialGeometry.rows,
		});
		this.terminal.loadAddon(this.fitAddon);
		this.terminal.loadAddon(new ClipboardAddon());
		this.terminal.loadAddon(new WebLinksAddon());
		this.terminal.loadAddon(this.unicode11Addon);
		this.terminal.unicode.activeVersion = "11";
		this.terminal.open(this.hostElement);
		this.terminal.attachCustomKeyEventHandler((event) => {
			if (event.key === "Enter" && event.shiftKey) {
				if (event.type === "keydown") {
					this.terminal.input(SHIFT_ENTER_SEQUENCE);
				}
				return false;
			}
			if (isCopyShortcut(event) && this.terminal.hasSelection()) {
				void navigator.clipboard.writeText(this.terminal.getSelection()).catch(() => {
					// Ignore clipboard failures.
				});
				return false;
			}
			return true;
		});

		try {
			const webglAddon = new WebglAddon();
			webglAddon.onContextLoss(() => {
				webglAddon.dispose();
			});
			this.terminal.loadAddon(webglAddon);
		} catch {
			// Fall back to the default renderer when WebGL is unavailable.
		}

		this.ensureConnected();
	}

	private notifyLastError(): void {
		for (const subscriber of this.subscribers) {
			subscriber.onLastError?.(this.lastError);
		}
	}

	private notifySummary(summary: RuntimeTaskSessionSummary): void {
		this.latestSummary = summary;
		for (const subscriber of this.subscribers) {
			subscriber.onSummary?.(summary);
		}
	}

	private notifyConnectionReady(): void {
		this.connectionReady = true;
		for (const subscriber of this.subscribers) {
			subscriber.onConnectionReady?.(this.taskId);
		}
	}

	private sendControlMessage(message: RuntimeTerminalWsClientMessage): void {
		if (!this.controlSocket || this.controlSocket.readyState !== WebSocket.OPEN) {
			return;
		}
		this.controlSocket.send(JSON.stringify(message));
	}

	private requestResize(): void {
		if (!this.visibleContainer) {
			return;
		}
		this.fitAddon.fit();
		const bounds = this.visibleContainer.getBoundingClientRect();
		const pixelWidth = Math.round(bounds.width);
		const pixelHeight = Math.round(bounds.height);
		reportTerminalGeometry(this.taskId, {
			cols: this.terminal.cols,
			rows: this.terminal.rows,
		});
		this.sendControlMessage({
			type: "resize",
			cols: this.terminal.cols,
			rows: this.terminal.rows,
			pixelWidth: pixelWidth > 0 ? pixelWidth : undefined,
			pixelHeight: pixelHeight > 0 ? pixelHeight : undefined,
		});
	}

	private connectIo(): void {
		const ioSocket = new WebSocket(getTerminalIoWebSocketUrl(this.taskId, this.workspaceId));
		this.ioSocket = ioSocket;
		ioSocket.onopen = () => {
			if (this.disposed || this.ioSocket !== ioSocket) {
				return;
			}
			const attachAddon = new AttachAddon(ioSocket);
			this.attachAddon = attachAddon;
			this.terminal.loadAddon(attachAddon);
			this.lastError = null;
			this.notifyLastError();
			this.notifyConnectionReady();
		};
		ioSocket.onerror = () => {
			if (this.disposed || this.ioSocket !== ioSocket) {
				return;
			}
			this.lastError = "Terminal stream failed.";
			this.notifyLastError();
		};
		ioSocket.onclose = () => {
			if (this.disposed || this.ioSocket !== ioSocket) {
				return;
			}
			this.ioSocket = null;
			if (this.attachAddon) {
				this.attachAddon.dispose();
				this.attachAddon = null;
			}
			this.connectionReady = false;
			this.lastError = "Terminal stream closed. Close and reopen to reconnect.";
			this.notifyLastError();
		};
	}

	private connectControl(): void {
		const controlSocket = new WebSocket(getTerminalControlWebSocketUrl(this.taskId, this.workspaceId));
		this.controlSocket = controlSocket;
		controlSocket.onopen = () => {
			if (this.disposed || this.controlSocket !== controlSocket) {
				return;
			}
			this.lastError = null;
			this.notifyLastError();
			if (this.visibleContainer) {
				this.requestResize();
			}
		};
		controlSocket.onmessage = (event) => {
			try {
				const payload = JSON.parse(String(event.data)) as RuntimeTerminalWsServerMessage;
				if (payload.type === "state") {
					this.notifySummary(payload.summary);
					return;
				}
				if (payload.type === "exit") {
					const label = payload.code == null ? "session exited" : `session exited with code ${payload.code}`;
					this.terminal.writeln(`\r\n[kanban] ${label}\r\n`);
					return;
				}
				if (payload.type === "error") {
					this.lastError = payload.message;
					this.notifyLastError();
					this.terminal.writeln(`\r\n[kanban] ${payload.message}\r\n`);
				}
			} catch {
				// Ignore malformed control frames.
			}
		};
		controlSocket.onerror = () => {
			if (this.disposed || this.controlSocket !== controlSocket) {
				return;
			}
			this.lastError = "Terminal control connection failed.";
			this.notifyLastError();
		};
		controlSocket.onclose = () => {
			if (this.disposed || this.controlSocket !== controlSocket) {
				return;
			}
			this.controlSocket = null;
			this.lastError = "Terminal control connection closed. Close and reopen to reconnect.";
			this.notifyLastError();
		};
	}

	private ensureConnected(): void {
		if (this.disposed) {
			return;
		}
		if (!this.ioSocket) {
			this.connectIo();
		}
		if (!this.controlSocket) {
			this.connectControl();
		}
	}

	private updateAppearance(appearance: PersistentTerminalAppearance): void {
		this.appearance = appearance;
		this.terminal.options.theme = {
			...this.terminal.options.theme,
			...createKanbanTerminalOptions({
				cursorColor: appearance.cursorColor,
				isMacPlatform,
				terminalBackgroundColor: appearance.terminalBackgroundColor,
			}).theme,
		};
	}

	setAppearance(appearance: PersistentTerminalAppearance): void {
		this.updateAppearance(appearance);
	}

	subscribe(subscriber: PersistentTerminalSubscriber): () => void {
		this.subscribers.add(subscriber);
		subscriber.onLastError?.(this.lastError);
		if (this.latestSummary) {
			subscriber.onSummary?.(this.latestSummary);
		}
		if (this.connectionReady) {
			subscriber.onConnectionReady?.(this.taskId);
		}
		return () => {
			this.subscribers.delete(subscriber);
		};
	}

	mount(
		container: HTMLDivElement,
		appearance: PersistentTerminalAppearance,
		options: MountPersistentTerminalOptions,
	): void {
		if (this.disposed) {
			return;
		}
		this.ensureConnected();
		this.updateAppearance(appearance);
		if (this.visibleContainer !== container) {
			this.visibleContainer = container;
			container.appendChild(this.hostElement);
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
		}
		this.resizeObserver = new ResizeObserver(() => {
			if (this.resizeTimer !== null) {
				clearTimeout(this.resizeTimer);
			}
			this.resizeTimer = setTimeout(() => {
				this.resizeTimer = null;
				this.requestResize();
			}, RESIZE_DEBOUNCE_MS);
		});
		this.resizeObserver.observe(container);
		if (options.isVisible !== false) {
			window.requestAnimationFrame(() => {
				this.requestResize();
				if (options.autoFocus) {
					this.terminal.focus();
				}
			});
		}
	}

	unmount(container: HTMLDivElement | null): void {
		if (this.disposed && this.visibleContainer === null) {
			return;
		}
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.resizeTimer !== null) {
			clearTimeout(this.resizeTimer);
			this.resizeTimer = null;
		}
		if (container && this.visibleContainer !== container) {
			return;
		}
		this.visibleContainer = null;
		clearTerminalGeometry(this.taskId);
		this.parkingRoot.appendChild(this.hostElement);
	}

	focus(): void {
		this.terminal.focus();
	}

	input(text: string): boolean {
		if (!this.ioSocket || this.ioSocket.readyState !== WebSocket.OPEN) {
			return false;
		}
		this.terminal.input(text);
		return true;
	}

	paste(text: string): boolean {
		if (!this.ioSocket || this.ioSocket.readyState !== WebSocket.OPEN) {
			return false;
		}
		this.terminal.paste(text);
		return true;
	}

	clear(): void {
		this.terminal.clear();
	}

	async stop(): Promise<void> {
		this.sendControlMessage({ type: "stop" });
		const trpcClient = getRuntimeTrpcClient(this.workspaceId);
		await trpcClient.runtime.stopTaskSession.mutate({ taskId: this.taskId });
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.unmount(this.visibleContainer);
		if (this.attachAddon) {
			this.attachAddon.dispose();
			this.attachAddon = null;
		}
		this.ioSocket?.close();
		this.controlSocket?.close();
		this.ioSocket = null;
		this.controlSocket = null;
		this.subscribers.clear();
		this.terminal.dispose();
		this.hostElement.remove();
	}
}

const terminals = new Map<string, PersistentTerminal>();

export function ensurePersistentTerminal(input: EnsurePersistentTerminalInput): PersistentTerminal {
	const key = buildKey(input.workspaceId, input.taskId);
	let terminal = terminals.get(key);
	if (!terminal) {
		terminal = new PersistentTerminal(input.taskId, input.workspaceId, {
			cursorColor: input.cursorColor,
			terminalBackgroundColor: input.terminalBackgroundColor,
		});
		terminals.set(key, terminal);
		return terminal;
	}
	terminal.setAppearance({
		cursorColor: input.cursorColor,
		terminalBackgroundColor: input.terminalBackgroundColor,
	});
	return terminal;
}

export function disposePersistentTerminal(workspaceId: string, taskId: string): void {
	const key = buildKey(workspaceId, taskId);
	const terminal = terminals.get(key);
	if (!terminal) {
		return;
	}
	terminal.dispose();
	terminals.delete(key);
}

export function disposeAllPersistentTerminalsForWorkspace(workspaceId: string): void {
	for (const [key, terminal] of terminals.entries()) {
		if (!key.startsWith(`${workspaceId}:`)) {
			continue;
		}
		terminal.dispose();
		terminals.delete(key);
	}
}
