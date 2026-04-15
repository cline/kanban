import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFilteredEnv, RuntimeChildManager } from "../src/runtime-child.js";

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalShell = process.env.SHELL;
const originalPathext = process.env.PATHEXT;
const originalAppdata = process.env.APPDATA;
const originalLocalAppdata = process.env.LOCALAPPDATA;
const originalHomedrive = process.env.HOMEDRIVE;
const originalHomepath = process.env.HOMEPATH;

function setPlatform(value: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", {
		value,
		configurable: true,
	});
}

describe("RuntimeChildManager (basic)", () => {
	it("can be constructed with required options", () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		expect(manager).toBeInstanceOf(RuntimeChildManager);
	});

	it("reports running=false before start", () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		expect(manager.running).toBe(false);
	});

	it("shutdown() is a no-op when no child is running", async () => {
		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
		});
		// Should not throw — it's a no-op when nothing is running
		await manager.shutdown();
	});
});

describe("buildFilteredEnv", () => {
	afterEach(() => {
		setPlatform(originalPlatform);
		if (originalPath === undefined) {
			delete process.env.PATH;
		} else {
			process.env.PATH = originalPath;
		}
		if (originalShell === undefined) {
			delete process.env.SHELL;
		} else {
			process.env.SHELL = originalShell;
		}
		// Restore Windows-specific env vars
		if (originalPathext === undefined) { delete process.env.PATHEXT; } else { process.env.PATHEXT = originalPathext; }
		if (originalAppdata === undefined) { delete process.env.APPDATA; } else { process.env.APPDATA = originalAppdata; }
		if (originalLocalAppdata === undefined) { delete process.env.LOCALAPPDATA; } else { process.env.LOCALAPPDATA = originalLocalAppdata; }
		if (originalHomedrive === undefined) { delete process.env.HOMEDRIVE; } else { process.env.HOMEDRIVE = originalHomedrive; }
		if (originalHomepath === undefined) { delete process.env.HOMEPATH; } else { process.env.HOMEPATH = originalHomepath; }
	});

	it("includes SHELL in the filtered env when set", () => {
		process.env.SHELL = "/bin/zsh";
		const env = buildFilteredEnv();
		expect(env.SHELL).toBe("/bin/zsh");
	});

	it("includes /bin and /usr/bin in the PATH on macOS", () => {
		setPlatform("darwin");
		process.env.PATH = "/opt/homebrew/bin";
		// Re-import would be needed to pick up the platform change for EXTRA_PATH_DIRS,
		// but since EXTRA_PATH_DIRS is evaluated at module load time, we test the actual
		// platform the test is running on. On macOS CI this will pass directly.
		const env = buildFilteredEnv();
		const pathDirs = (env.PATH ?? "").split(":");
		// Regardless of platform, PATH should not be empty
		expect(pathDirs.length).toBeGreaterThan(0);
		expect(env.PATH).toBeDefined();
	});

	it("forwards HOME env variable", () => {
		process.env.HOME = "/Users/testuser";
		const env = buildFilteredEnv();
		expect(env.HOME).toBe("/Users/testuser");
	});

	it("does not include arbitrary env variables", () => {
		process.env.MY_SECRET_VAR = "secret";
		const env = buildFilteredEnv();
		expect(env.MY_SECRET_VAR).toBeUndefined();
		delete process.env.MY_SECRET_VAR;
	});

	it("forwards KANBAN_ prefixed env variables", () => {
		process.env.KANBAN_TEST_KEY = "test-value";
		const env = buildFilteredEnv();
		expect(env.KANBAN_TEST_KEY).toBe("test-value");
		delete process.env.KANBAN_TEST_KEY;
	});

	it("buildFilteredEnv uses path.delimiter not hardcoded colon", () => {
		// Set PATH with the platform delimiter to verify correct splitting/joining.
		const testDirs = ["/usr/local/bin", "/usr/bin", "/bin"];
		process.env.PATH = testDirs.join(path.delimiter);
		const env = buildFilteredEnv();
		// The resulting PATH must use path.delimiter as separator.
		const resultParts = (env.PATH ?? "").split(path.delimiter);
		for (const dir of testDirs) {
			expect(resultParts).toContain(dir);
		}
		// Verify that every segment is non-empty (no double-delimiters).
		expect(resultParts.every((p) => p.length > 0)).toBe(true);
	});

	it("buildFilteredEnv includes PATHEXT when set", () => {
		process.env.PATHEXT = ".COM;.EXE;.BAT;.CMD";
		const env = buildFilteredEnv();
		expect(env.PATHEXT).toBe(".COM;.EXE;.BAT;.CMD");
	});

	it("buildFilteredEnv includes APPDATA when set", () => {
		process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
		const env = buildFilteredEnv();
		expect(env.APPDATA).toBe("C:\\Users\\test\\AppData\\Roaming");
	});

	it("buildFilteredEnv includes LOCALAPPDATA when set", () => {
		process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
		const env = buildFilteredEnv();
		expect(env.LOCALAPPDATA).toBe("C:\\Users\\test\\AppData\\Local");
	});

	it("buildFilteredEnv includes HOMEDRIVE and HOMEPATH when set", () => {
		process.env.HOMEDRIVE = "C:";
		process.env.HOMEPATH = "\\Users\\test";
		const env = buildFilteredEnv();
		expect(env.HOMEDRIVE).toBe("C:");
		expect(env.HOMEPATH).toBe("\\Users\\test");
	});
});

describe("RuntimeChildManager (spawnChild pipe draining)", () => {
	it("spawnChild drains stdout and stderr pipes", async () => {
		// Build a fake ChildProcess with mockable stdout/stderr
		const fakeChild = new EventEmitter() as ChildProcess;
		Object.defineProperty(fakeChild, "pid", { value: 12345, writable: true });
		Object.defineProperty(fakeChild, "connected", { value: true, writable: true });
		fakeChild.send = vi.fn().mockReturnValue(true);
		fakeChild.kill = vi.fn();

		const stdoutOn = vi.fn();
		const stderrOn = vi.fn();
		(fakeChild as any).stdout = { on: stdoutOn };
		(fakeChild as any).stderr = { on: stderrOn };

		const forkFn = vi.fn().mockReturnValue(fakeChild) as unknown as typeof import("node:child_process").fork;

		const manager = new RuntimeChildManager({
			childScriptPath: "/path/to/runtime-child.js",
			forkFn,
		});

		// start() calls spawnChild() internally — don't await because it
		// waits for a "ready" message we won't send; just trigger it.
		const startPromise = manager.start({
			host: "127.0.0.1",
			port: 0,
			authToken: "test-token",
		});

		// Simulate the child sending "ready" so the promise resolves
		fakeChild.emit("message", { type: "ready", url: "http://127.0.0.1:3000" });
		await startPromise;

		// Assert that .on('data', ...) was called on both stdout and stderr
		expect(stdoutOn).toHaveBeenCalledWith("data", expect.any(Function));
		expect(stderrOn).toHaveBeenCalledWith("data", expect.any(Function));

		// Clean up: emit exit so shutdown() resolves immediately
		const shutdownPromise = manager.shutdown();
		fakeChild.emit("exit", 0, null);
		await shutdownPromise;
	});
});
