import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TerminalWriteData = string | Uint8Array;
type TerminalWriteCallback = () => void;

interface MockTerminalOptions {
	cols?: number;
	rows?: number;
}

interface MockTerminalBuffer {
	active: {
		baseY: number;
		viewportY: number;
	};
}

interface MockAddon {
	dispose?: () => void;
}

type MockKeyEventHandler = (event: KeyboardEvent) => boolean;

const terminalMocks = vi.hoisted(() => {
	class MockTerminal {
		readonly buffer: MockTerminalBuffer = {
			active: {
				baseY: 0,
				viewportY: 0,
			},
		};
		readonly unicode = {
			activeVersion: "",
		};
		cols: number;
		rows: number;
		onWrite: ((data: TerminalWriteData) => void) | null = null;
		options: { theme?: Record<string, string> } = {};
		customKeyEventHandler: MockKeyEventHandler | null = null;
		readonly attachCustomKeyEventHandler = vi.fn((handler: MockKeyEventHandler) => {
			this.customKeyEventHandler = handler;
		});
		readonly clear = vi.fn();
		readonly dispose = vi.fn();
		readonly focus = vi.fn();
		readonly getSelection = vi.fn(() => "");
		readonly hasSelection = vi.fn(() => false);
		readonly input = vi.fn();
		readonly loadAddon = vi.fn((_addon: MockAddon) => {});
		readonly onBinary = vi.fn();
		readonly onData = vi.fn();
		readonly open = vi.fn();
		deferWriteCallback = false;
		pendingWriteCallback: TerminalWriteCallback | null = null;
		readonly paste = vi.fn();
		readonly reset = vi.fn(() => {
			this.buffer.active.baseY = 0;
			this.buffer.active.viewportY = 0;
		});
		readonly resize = vi.fn((cols: number, rows: number) => {
			this.cols = cols;
			this.rows = rows;
		});
		readonly scrollToBottom = vi.fn(() => {
			this.buffer.active.viewportY = this.buffer.active.baseY;
		});
		readonly scrollToLine = vi.fn((line: number) => {
			this.buffer.active.viewportY = line;
		});
		readonly write = vi.fn((data: TerminalWriteData, callback?: TerminalWriteCallback) => {
			this.onWrite?.(data);
			if (this.deferWriteCallback) {
				this.pendingWriteCallback = callback ?? null;
				return;
			}
			callback?.();
		});

		constructor(options: MockTerminalOptions) {
			this.cols = options.cols ?? 0;
			this.rows = options.rows ?? 0;
			instances.push(this);
		}

		flushPendingWrite(): void {
			const callback = this.pendingWriteCallback;
			this.pendingWriteCallback = null;
			callback?.();
		}
	}

	const instances: MockTerminal[] = [];
	return {
		instances,
		MockTerminal,
	};
});

const fitAddonMocks = vi.hoisted(() => {
	class MockFitAddon {
		onFit: (() => void) | null = null;
		readonly fit = vi.fn(() => {
			this.onFit?.();
		});
	}

	const instances: MockFitAddon[] = [];
	const FitAddon = class extends MockFitAddon {
		constructor() {
			super();
			instances.push(this);
		}
	};

	return {
		FitAddon,
		instances,
	};
});

const addonMocks = vi.hoisted(() => {
	class MockWebglAddon {
		readonly dispose = vi.fn();
		readonly onContextLoss = vi.fn();
	}

	return {
		ClipboardAddon: class {},
		Unicode11Addon: class {},
		WebLinksAddon: class {},
		WebglAddon: MockWebglAddon,
	};
});

const geometryMocks = vi.hoisted(() => ({
	clearTerminalGeometry: vi.fn(),
	reportTerminalGeometry: vi.fn(),
}));

const trpcMocks = vi.hoisted(() => ({
	getRuntimeTrpcClient: vi.fn(() => ({
		runtime: {
			stopTaskSession: {
				mutate: vi.fn(async () => {}),
			},
		},
	})),
}));

interface MockMessageEvent {
	data: string | ArrayBuffer | Blob;
}

type MockMessageListener = (event: MockMessageEvent) => void;

class MockWebSocket {
	static readonly CLOSED = 3;
	static readonly OPEN = 1;

	binaryType: BinaryType = "blob";
	onclose: ((event: CloseEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	onmessage: ((event: MockMessageEvent) => void) | null = null;
	onopen: ((event: Event) => void) | null = null;
	readyState = MockWebSocket.OPEN;
	readonly send = vi.fn();
	private readonly messageListeners = new Set<MockMessageListener>();

	constructor(readonly url: string) {
		webSocketInstances.push(this);
	}

	addEventListener(type: "message", listener: MockMessageListener): void {
		if (type === "message") {
			this.messageListeners.add(listener);
		}
	}

	close(): void {
		this.readyState = MockWebSocket.CLOSED;
		this.onclose?.(new CloseEvent("close"));
	}

	emitMessage(data: string | ArrayBuffer | Blob): void {
		const event = { data };
		for (const listener of this.messageListeners) {
			listener(event);
		}
		this.onmessage?.(event);
	}
}

class MockResizeObserver implements ResizeObserver {
	readonly root = null;
	readonly rootMargin = "";
	readonly thresholds = [];

	constructor(readonly callback: ResizeObserverCallback) {}

	disconnect(): void {}

	observe(_target: Element): void {}

	takeRecords(): ResizeObserverEntry[] {
		return [];
	}

	unobserve(_target: Element): void {}
}

const webSocketInstances: MockWebSocket[] = [];

vi.mock("@xterm/xterm", () => ({
	Terminal: terminalMocks.MockTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: fitAddonMocks.FitAddon,
}));

vi.mock("@xterm/addon-clipboard", () => ({
	ClipboardAddon: addonMocks.ClipboardAddon,
}));

vi.mock("@xterm/addon-unicode11", () => ({
	Unicode11Addon: addonMocks.Unicode11Addon,
}));

vi.mock("@xterm/addon-web-links", () => ({
	WebLinksAddon: addonMocks.WebLinksAddon,
}));

vi.mock("@xterm/addon-webgl", () => ({
	WebglAddon: addonMocks.WebglAddon,
}));

vi.mock("@/runtime/trpc-client", () => ({
	getRuntimeTrpcClient: trpcMocks.getRuntimeTrpcClient,
}));

vi.mock("@/terminal/terminal-geometry-registry", () => ({
	clearTerminalGeometry: geometryMocks.clearTerminalGeometry,
	reportTerminalGeometry: geometryMocks.reportTerminalGeometry,
}));

import {
	disposeAllPersistentTerminalsForWorkspace,
	ensurePersistentTerminal,
} from "@/terminal/persistent-terminal-manager";

function createTerminal() {
	return ensurePersistentTerminal({
		cursorColor: "#ffffff",
		taskId: "task-1",
		terminalBackgroundColor: "#000000",
		workspaceId: "workspace-1",
	});
}

function getMockTerminal() {
	const terminal = terminalMocks.instances[0];
	if (!terminal) {
		throw new Error("Expected a terminal instance.");
	}
	return terminal;
}

function getFitAddon() {
	const fitAddon = fitAddonMocks.instances[0];
	if (!fitAddon) {
		throw new Error("Expected a fit addon instance.");
	}
	return fitAddon;
}

function getHostElement() {
	const hostElement = getMockTerminal().open.mock.calls[0]?.[0];
	if (!(hostElement instanceof HTMLDivElement)) {
		throw new Error("Expected terminal host element.");
	}
	return hostElement;
}

function getSocket(path: "control" | "io") {
	const socket = webSocketInstances.find((candidate) => candidate.url.includes(`/api/terminal/${path}`));
	if (!socket) {
		throw new Error(`Expected ${path} socket.`);
	}
	return socket;
}

describe("persistent terminal viewport preservation", () => {
	let previousResizeObserver: typeof globalThis.ResizeObserver | undefined;
	let previousWebSocket: typeof globalThis.WebSocket | undefined;
	let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		previousResizeObserver = globalThis.ResizeObserver;
		previousWebSocket = globalThis.WebSocket;
		terminalMocks.instances.length = 0;
		fitAddonMocks.instances.length = 0;
		webSocketInstances.length = 0;
		geometryMocks.clearTerminalGeometry.mockClear();
		geometryMocks.reportTerminalGeometry.mockClear();
		requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
			callback(0);
			return 0;
		});
		Object.defineProperty(globalThis, "ResizeObserver", {
			configurable: true,
			value: MockResizeObserver,
			writable: true,
		});
		Object.defineProperty(globalThis, "WebSocket", {
			configurable: true,
			value: MockWebSocket,
			writable: true,
		});
	});

	afterEach(() => {
		disposeAllPersistentTerminalsForWorkspace("workspace-1");
		requestAnimationFrameSpy.mockRestore();
		if (previousResizeObserver) {
			Object.defineProperty(globalThis, "ResizeObserver", {
				configurable: true,
				value: previousResizeObserver,
				writable: true,
			});
		} else {
			delete (globalThis as Partial<typeof globalThis>).ResizeObserver;
		}
		if (previousWebSocket) {
			Object.defineProperty(globalThis, "WebSocket", {
				configurable: true,
				value: previousWebSocket,
				writable: true,
			});
		} else {
			delete (globalThis as Partial<typeof globalThis>).WebSocket;
		}
		vi.restoreAllMocks();
	});

	it("preserves a scrolled-back viewport after terminal output", async () => {
		createTerminal();
		const terminal = getMockTerminal();
		terminal.buffer.active.viewportY = 24;
		terminal.buffer.active.baseY = 100;
		terminal.onWrite = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 101;
		};

		getSocket("io").emitMessage("agent output");

		await vi.waitFor(() => {
			expect(terminal.write).toHaveBeenCalledWith("agent output", expect.any(Function));
		});
		expect(terminal.scrollToLine).toHaveBeenCalledWith(24);
		expect(terminal.scrollToBottom).not.toHaveBeenCalled();
	});

	it("does not restore a stale output viewport after the user scrolls during an async write", async () => {
		createTerminal();
		const terminal = getMockTerminal();
		terminal.deferWriteCallback = true;
		terminal.buffer.active.viewportY = 24;
		terminal.buffer.active.baseY = 100;
		terminal.onWrite = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 101;
		};

		getSocket("io").emitMessage("agent output");

		await vi.waitFor(() => {
			expect(terminal.write).toHaveBeenCalledWith("agent output", expect.any(Function));
		});
		getHostElement().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
		terminal.buffer.active.viewportY = 55;
		terminal.flushPendingWrite();

		await vi.waitFor(() => {
			expect(terminal.pendingWriteCallback).toBeNull();
		});
		expect(terminal.scrollToLine).not.toHaveBeenCalled();
		expect(terminal.scrollToBottom).not.toHaveBeenCalled();
		expect(terminal.buffer.active.viewportY).toBe(55);
	});

	it("does not restore a stale output viewport after user input scrolls to bottom during an async write", async () => {
		createTerminal();
		const terminal = getMockTerminal();
		terminal.deferWriteCallback = true;
		terminal.buffer.active.viewportY = 24;
		terminal.buffer.active.baseY = 100;
		terminal.onWrite = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 101;
		};

		getSocket("io").emitMessage("agent output");

		await vi.waitFor(() => {
			expect(terminal.write).toHaveBeenCalledWith("agent output", expect.any(Function));
		});
		const handled = terminal.customKeyEventHandler?.(new KeyboardEvent("keydown", { key: "a" }));
		terminal.buffer.active.viewportY = 101;
		terminal.flushPendingWrite();

		await vi.waitFor(() => {
			expect(terminal.pendingWriteCallback).toBeNull();
		});
		expect(handled).toBe(true);
		expect(terminal.scrollToLine).not.toHaveBeenCalled();
		expect(terminal.scrollToBottom).not.toHaveBeenCalled();
		expect(terminal.buffer.active.viewportY).toBe(101);
	});

	it("keeps the terminal pinned to bottom after terminal output", async () => {
		createTerminal();
		const terminal = getMockTerminal();
		terminal.buffer.active.viewportY = 100;
		terminal.buffer.active.baseY = 100;
		terminal.onWrite = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 101;
		};

		getSocket("io").emitMessage("agent output");

		await vi.waitFor(() => {
			expect(terminal.write).toHaveBeenCalled();
		});
		expect(terminal.scrollToBottom).toHaveBeenCalledTimes(1);
		expect(terminal.scrollToLine).not.toHaveBeenCalled();
	});

	it("preserves a scrolled-back viewport after restore replay", async () => {
		createTerminal();
		const terminal = getMockTerminal();
		terminal.buffer.active.viewportY = 24;
		terminal.buffer.active.baseY = 100;
		terminal.onWrite = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 90;
		};

		getSocket("control").emitMessage(
			JSON.stringify({
				cols: 120,
				rows: 40,
				snapshot: "restored terminal snapshot",
				type: "restore",
			}),
		);

		await vi.waitFor(() => {
			expect(terminal.scrollToLine).toHaveBeenCalledWith(24);
		});
		expect(terminal.reset).toHaveBeenCalledTimes(1);
		expect(terminal.resize).toHaveBeenCalledWith(120, 40);
		expect(terminal.write).toHaveBeenCalledWith("restored terminal snapshot", expect.any(Function));
	});

	it("does not restore a stale restore viewport after the user scrolls during replay", async () => {
		createTerminal();
		const terminal = getMockTerminal();
		terminal.deferWriteCallback = true;
		terminal.buffer.active.viewportY = 24;
		terminal.buffer.active.baseY = 100;
		terminal.onWrite = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 90;
		};

		getSocket("control").emitMessage(
			JSON.stringify({
				cols: 120,
				rows: 40,
				snapshot: "restored terminal snapshot",
				type: "restore",
			}),
		);
		await vi.waitFor(() => {
			expect(terminal.write).toHaveBeenCalledWith("restored terminal snapshot", expect.any(Function));
		});
		getHostElement().dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
		terminal.buffer.active.viewportY = 55;
		terminal.flushPendingWrite();

		await vi.waitFor(() => {
			expect(terminal.pendingWriteCallback).toBeNull();
		});
		expect(terminal.scrollToLine).not.toHaveBeenCalled();
		expect(terminal.scrollToBottom).not.toHaveBeenCalled();
		expect(terminal.buffer.active.viewportY).toBe(55);
	});

	it("clamps a scrolled-back viewport after fit reduces the buffer", async () => {
		const persistentTerminal = createTerminal();
		const terminal = getMockTerminal();
		const fitAddon = getFitAddon();
		const container = document.createElement("div");
		terminal.buffer.active.viewportY = 80;
		terminal.buffer.active.baseY = 100;
		fitAddon.onFit = () => {
			terminal.buffer.active.viewportY = 0;
			terminal.buffer.active.baseY = 40;
		};

		persistentTerminal.mount(
			container,
			{
				cursorColor: "#ffffff",
				terminalBackgroundColor: "#000000",
			},
			{},
		);

		await vi.waitFor(() => {
			expect(fitAddon.fit).toHaveBeenCalled();
		});
		expect(terminal.scrollToLine).toHaveBeenCalledWith(40);
	});
});
