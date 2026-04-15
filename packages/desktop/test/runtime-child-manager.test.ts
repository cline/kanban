import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChildToParentMessage } from "../src/ipc-protocol.js";
import {
	RuntimeChildManager,
	buildFilteredEnv,
	resolveChildScriptPath,
} from "../src/runtime-child.js";

// ---------------------------------------------------------------------------
// Mock ChildProcess factory
// ---------------------------------------------------------------------------

interface MockChild extends EventEmitter {
	pid: number;
	connected: boolean;
	killed: boolean;
	send: ReturnType<typeof vi.fn>;
	kill: ReturnType<typeof vi.fn>;
	/** Simulate receiving an IPC message from the child. */
	simulateMessage(msg: ChildToParentMessage): void;
	/** Simulate the child process exiting. */
	simulateExit(code: number | null, signal: string | null): void;
}

function createMockChild(pid = 12345): MockChild {
	const child = new EventEmitter() as MockChild;
	child.pid = pid;
	child.connected = true;
	child.killed = false;
	child.send = vi.fn();
	child.kill = vi.fn(() => { child.killed = true; child.connected = false; });
	child.simulateMessage = (msg) => child.emit("message", msg);
	child.simulateExit = (code, signal) => {
		child.connected = false;
		child.emit("exit", code, signal);
	};
	return child;
}

/** Creates a forkFn mock that returns the given mock child. */
function createForkFn(child: MockChild) {
	return vi.fn(() => child) as unknown as typeof fork;
}

// ---------------------------------------------------------------------------
// Default test config
// ---------------------------------------------------------------------------

const TEST_CONFIG = {
	host: "127.0.0.1" as const,
	port: "auto" as const,
	authToken: "test-token-abc",
};

const SCRIPT_PATH = "/path/to/runtime-child.js";

// ---------------------------------------------------------------------------
// buildFilteredEnv
// ---------------------------------------------------------------------------

describe("buildFilteredEnv", () => {
	it("includes only allowed environment variables", () => {
		const original = { ...process.env };
		try {
			process.env.PATH = "/usr/bin";
			process.env.HOME = "/home/user";
			process.env.KANBAN_RUNTIME_PORT = "3484";
			process.env.SECRET_KEY = "should-not-appear";
			process.env.OCA_API_KEY = "oca-provider-key";
			process.env.ELECTRON_RUN_AS_NODE = "1";

			const env = buildFilteredEnv();
			const pathEntries = env.PATH?.split(":") ?? [];
			expect(pathEntries).toContain("/usr/bin");
			if (process.platform === "darwin") {
				expect(pathEntries).toEqual(
					expect.arrayContaining([
						"/opt/homebrew/bin",
						"/opt/homebrew/sbin",
						"/usr/local/bin",
						"/usr/local/sbin",
					]),
				);
			}
			if (process.platform === "linux") {
				expect(pathEntries).toEqual(
					expect.arrayContaining(["/usr/local/bin", "/snap/bin"]),
				);
			}
			expect(env.HOME).toBe("/home/user");
			expect(env.KANBAN_RUNTIME_PORT).toBe("3484");
			expect(env.OCA_API_KEY).toBe("oca-provider-key");
			expect(env.SECRET_KEY).toBeUndefined();
			expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
		} finally {
			process.env = original;
		}
	});

	it("omits keys that are not set in process.env", () => {
		const original = { ...process.env };
		try {
			delete process.env.XDG_RUNTIME_DIR;
			const env = buildFilteredEnv();
			expect(env.XDG_RUNTIME_DIR).toBeUndefined();
		} finally {
			process.env = original;
		}
	});
});

// ---------------------------------------------------------------------------
// resolveChildScriptPath
// ---------------------------------------------------------------------------

describe("resolveChildScriptPath", () => {
	it("replaces app.asar with app.asar.unpacked", () => {
		const input = `/foo${path.sep}app.asar${path.sep}dist${path.sep}runtime-child.js`;
		const result = resolveChildScriptPath(input);
		expect(result).toBe(
			`/foo${path.sep}app.asar.unpacked${path.sep}dist${path.sep}runtime-child.js`,
		);
	});

	it("returns path unchanged when app.asar is not present", () => {
		const input = "/foo/bar/dist/runtime-child.js";
		expect(resolveChildScriptPath(input)).toBe(input);
	});
});


// ---------------------------------------------------------------------------
// RuntimeChildManager — construction
// ---------------------------------------------------------------------------

describe("RuntimeChildManager", () => {
	let mockChild: MockChild;
	let manager: RuntimeChildManager;

	beforeEach(() => {
		vi.useFakeTimers();
		mockChild = createMockChild();
	});

	afterEach(async () => {
		// Ensure timers are cleared so vitest doesn't leak.
		vi.useRealTimers();
	});

	function createManager(overrides: Record<string, unknown> = {}) {
		return new RuntimeChildManager({
			childScriptPath: SCRIPT_PATH,
			forkFn: createForkFn(mockChild),
			heartbeatTimeoutMs: 15_000,
			shutdownTimeoutMs: 5_000,
			maxRestarts: 3,
			restartDecayMs: 300_000,
			...overrides,
		});
	}

	// -----------------------------------------------------------------------
	// Construction
	// -----------------------------------------------------------------------

	it("can be constructed with required options", () => {
		manager = createManager();
		expect(manager).toBeInstanceOf(RuntimeChildManager);
		expect(manager.running).toBe(false);
	});

	// -----------------------------------------------------------------------
	// start()
	// -----------------------------------------------------------------------

	describe("start()", () => {
		it("forks the child and resolves with URL on ready", async () => {
			manager = createManager();
			const startPromise = manager.start(TEST_CONFIG);

			// forkFn should have been called
			expect(mockChild.send).toHaveBeenCalledWith(
				expect.objectContaining({ type: "start", config: TEST_CONFIG }),
			);
			expect(manager.running).toBe(true);

			// Simulate the child reporting ready
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });

			const url = await startPromise;
			expect(url).toBe("http://localhost:3000");
		});

		it("emits 'ready' event with the URL", async () => {
			manager = createManager();
			const readyHandler = vi.fn();
			manager.on("ready", readyHandler);

			const startPromise = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:4000" });
			await startPromise;

			expect(readyHandler).toHaveBeenCalledWith("http://localhost:4000");
		});

		it("rejects when the child sends an error message", async () => {
			manager = createManager();
			// Must listen for "error" to prevent EventEmitter from throwing
			manager.on("error", () => {});
			const startPromise = manager.start(TEST_CONFIG);

			mockChild.simulateMessage({ type: "error", message: "port in use" });

			await expect(startPromise).rejects.toThrow("Runtime child error: port in use");
		});

		it("rejects when the child exits before ready", async () => {
			manager = createManager({ maxRestarts: 0 });
			// Absorb "error" from exceeded restart attempts
			manager.on("error", () => {});
			const startPromise = manager.start(TEST_CONFIG);

			mockChild.simulateExit(1, null);

			await expect(startPromise).rejects.toThrow("exited unexpectedly");
			expect(manager.running).toBe(false);
		});

		it("throws if already running", async () => {
			manager = createManager();
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			await expect(manager.start(TEST_CONFIG)).rejects.toThrow("already running");
		});

		it("throws if disposed", async () => {
			manager = createManager();
			await manager.dispose();
			await expect(manager.start(TEST_CONFIG)).rejects.toThrow("disposed");
		});
	});


	// -----------------------------------------------------------------------
	// shutdown()
	// -----------------------------------------------------------------------

	describe("shutdown()", () => {
		it("sends shutdown message and resolves on shutdown-complete", async () => {
			manager = createManager();
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			const shutdownPromise = manager.shutdown();

			expect(mockChild.send).toHaveBeenCalledWith(
				expect.objectContaining({ type: "shutdown" }),
			);

			// Simulate shutdown-complete from child
			manager.emit("shutdown-complete");

			await shutdownPromise;
		});

		it("resolves on child exit even without shutdown-complete", async () => {
			manager = createManager();
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			const shutdownPromise = manager.shutdown();
			mockChild.simulateExit(0, null);

			await shutdownPromise;
			expect(manager.running).toBe(false);
		});

		it("force-kills after timeout", async () => {
			manager = createManager({ shutdownTimeoutMs: 100 });
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			const shutdownPromise = manager.shutdown();

			// Advance past the timeout
			vi.advanceTimersByTime(150);

			await shutdownPromise;
			expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
		});

		it("is a no-op when no child is running", async () => {
			manager = createManager();
			await manager.shutdown(); // should not throw
		});
	});


	// -----------------------------------------------------------------------
	// Heartbeat
	// -----------------------------------------------------------------------

	describe("heartbeat", () => {
		it("replies with heartbeat-ack when child sends heartbeat", async () => {
			manager = createManager();
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			mockChild.send.mockClear();
			mockChild.simulateMessage({ type: "heartbeat" });

			expect(mockChild.send).toHaveBeenCalledWith(
				expect.objectContaining({ type: "heartbeat-ack" }),
			);
		});

		it("force-kills when heartbeat times out", async () => {
			manager = createManager({ heartbeatTimeoutMs: 200 });
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			// No heartbeat arrives — advance past the timeout
			vi.advanceTimersByTime(250);

			expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
		});

		it("resets the heartbeat timer on each heartbeat", async () => {
			manager = createManager({ heartbeatTimeoutMs: 200 });
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			// Send heartbeat at 150ms — should reset timer
			vi.advanceTimersByTime(150);
			mockChild.simulateMessage({ type: "heartbeat" });

			// Advance another 150ms (total 300ms from start, but only 150ms since
			// last heartbeat) — should NOT have killed yet
			vi.advanceTimersByTime(150);
			expect(mockChild.kill).not.toHaveBeenCalled();

			// Advance past the timeout from last heartbeat
			vi.advanceTimersByTime(100);
			expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
		});
	});


	// -----------------------------------------------------------------------
	// Auto-restart
	// -----------------------------------------------------------------------

	describe("auto-restart", () => {
		it("restarts after an unexpected crash", async () => {
			let spawnCount = 0;
			const children: MockChild[] = [];
			const forkFn = vi.fn(() => {
				const child = createMockChild(10000 + spawnCount);
				children.push(child);
				spawnCount++;
				return child;
			}) as unknown as typeof fork;

			manager = new RuntimeChildManager({
				childScriptPath: SCRIPT_PATH,
				forkFn,
				maxRestarts: 3,
				restartDecayMs: 300_000,
				heartbeatTimeoutMs: 60_000,
			});

			// Start — first child
			const p = manager.start(TEST_CONFIG);
			children[0].simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;
			expect(spawnCount).toBe(1);

			// Crash
			children[0].simulateExit(1, null);

			// The auto-restart uses setImmediate — flush it
			await vi.advanceTimersByTimeAsync(0);

			expect(spawnCount).toBe(2);
		});

		it("does not restart after graceful shutdown", async () => {
			let spawnCount = 0;
			const children: MockChild[] = [];
			const forkFn = vi.fn(() => {
				const child = createMockChild(10000 + spawnCount);
				children.push(child);
				spawnCount++;
				return child;
			}) as unknown as typeof fork;

			manager = new RuntimeChildManager({
				childScriptPath: SCRIPT_PATH,
				forkFn,
				maxRestarts: 3,
				heartbeatTimeoutMs: 60_000,
			});

			const p = manager.start(TEST_CONFIG);
			children[0].simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			const shutdownP = manager.shutdown();
			children[0].simulateExit(0, null);
			await shutdownP;

			await vi.advanceTimersByTimeAsync(0);
			expect(spawnCount).toBe(1); // No restart
		});

		it("gives up after maxRestarts consecutive crashes", async () => {
			let spawnCount = 0;
			const children: MockChild[] = [];
			const forkFn = vi.fn(() => {
				const child = createMockChild(10000 + spawnCount);
				children.push(child);
				spawnCount++;
				return child;
			}) as unknown as typeof fork;

			const errorHandler = vi.fn();
			manager = new RuntimeChildManager({
				childScriptPath: SCRIPT_PATH,
				forkFn,
				maxRestarts: 2,
				restartDecayMs: 300_000,
				heartbeatTimeoutMs: 60_000,
			});
			manager.on("error", errorHandler);

			// Start
			const p = manager.start(TEST_CONFIG);
			children[0].simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			// Crash 1 → restart
			children[0].simulateExit(1, null);
			await vi.advanceTimersByTimeAsync(0);
			expect(spawnCount).toBe(2);

			// Crash 2 → restart
			children[1].simulateExit(1, null);
			await vi.advanceTimersByTimeAsync(0);
			expect(spawnCount).toBe(3);

			// Crash 3 → exceeds maxRestarts (2), no more restarts
			children[2].simulateExit(1, null);
			await vi.advanceTimersByTimeAsync(0);
			expect(spawnCount).toBe(3); // unchanged

			expect(errorHandler).toHaveBeenCalledWith(
				expect.stringContaining("exceeded maximum restart attempts"),
			);
		});
	});


	// -----------------------------------------------------------------------
	// onMessage
	// -----------------------------------------------------------------------

	describe("onMessage()", () => {
		it("receives all child-to-parent messages", async () => {
			manager = createManager();
			const messages: ChildToParentMessage[] = [];
			manager.onMessage((msg) => messages.push(msg));

			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			mockChild.simulateMessage({ type: "heartbeat" });

			expect(messages).toEqual([
				{ type: "ready", url: "http://localhost:3000" },
				{ type: "heartbeat" },
			]);
		});
	});

	// -----------------------------------------------------------------------
	// IPC env filtering (fork options)
	// -----------------------------------------------------------------------

	describe("env filtering", () => {
		it("passes filtered env to fork", async () => {
			const forkSpy = vi.fn(() => mockChild) as unknown as typeof fork;
			manager = new RuntimeChildManager({
				childScriptPath: SCRIPT_PATH,
				forkFn: forkSpy,
				heartbeatTimeoutMs: 60_000,
			});

			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			const forkCall = (forkSpy as ReturnType<typeof vi.fn>).mock.calls[0];
			const options = forkCall[2] as { env: NodeJS.ProcessEnv };
			// Should not have random process env keys like ELECTRON_RUN_AS_NODE
			expect(options.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
			// Should have PATH
			expect(options.env.PATH).toBeDefined();
		});
	});

	// -----------------------------------------------------------------------
	// dispose()
	// -----------------------------------------------------------------------

	describe("dispose()", () => {
		it("kills child and prevents further start calls", async () => {
			manager = createManager();
			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			// Dispose — should trigger shutdown
			const disposePromise = manager.dispose();
			mockChild.simulateExit(0, null);
			await disposePromise;

			await expect(manager.start(TEST_CONFIG)).rejects.toThrow("disposed");
		});
	});

	// -----------------------------------------------------------------------
	// crashed event
	// -----------------------------------------------------------------------

	describe("crashed event", () => {
		it("emits crashed event on unexpected exit", async () => {
			manager = createManager({ maxRestarts: 0 });
			const crashedHandler = vi.fn();
			manager.on("crashed", crashedHandler);
			// Absorb the "error" event from exceeded restart attempts
			manager.on("error", () => {});

			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			mockChild.simulateExit(1, null);

			expect(crashedHandler).toHaveBeenCalledWith(1, null);
		});

		it("does not emit crashed event on graceful shutdown", async () => {
			manager = createManager();
			const crashedHandler = vi.fn();
			manager.on("crashed", crashedHandler);

			const p = manager.start(TEST_CONFIG);
			mockChild.simulateMessage({ type: "ready", url: "http://localhost:3000" });
			await p;

			const shutdownP = manager.shutdown();
			mockChild.simulateExit(0, null);
			await shutdownP;

			expect(crashedHandler).not.toHaveBeenCalled();
		});
	});
});
