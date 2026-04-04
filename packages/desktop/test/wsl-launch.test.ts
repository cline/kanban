import { describe, expect, it, vi } from "vitest";
import { EventEmitter, Readable } from "node:stream";
import {
	parseReadyLine,
	rewriteUrlForHost,
	WslLauncher,
} from "../src/wsl-launch.js";

// ---------------------------------------------------------------------------
// parseReadyLine
// ---------------------------------------------------------------------------

describe("parseReadyLine", () => {
	it("extracts URL from a valid ready JSON line", () => {
		const url = parseReadyLine('{"ready":true,"url":"http://0.0.0.0:54321"}');
		expect(url).toBe("http://0.0.0.0:54321");
	});

	it("returns null for non-JSON lines", () => {
		expect(parseReadyLine("Starting server...")).toBeNull();
		expect(parseReadyLine("")).toBeNull();
	});

	it("returns null for JSON without ready field", () => {
		expect(parseReadyLine('{"status":"ok"}')).toBeNull();
	});

	it("returns null for JSON where ready is false", () => {
		expect(parseReadyLine('{"ready":false,"url":"http://x"}')).toBeNull();
	});

	it("handles whitespace around the line", () => {
		const url = parseReadyLine('  {"ready":true,"url":"http://localhost:1234"}  ');
		expect(url).toBe("http://localhost:1234");
	});
});

// ---------------------------------------------------------------------------
// rewriteUrlForHost
// ---------------------------------------------------------------------------

describe("rewriteUrlForHost", () => {
	it("rewrites 0.0.0.0 to 127.0.0.1", () => {
		expect(rewriteUrlForHost("http://0.0.0.0:5000")).toBe("http://127.0.0.1:5000");
	});

	it("rewrites :: to 127.0.0.1", () => {
		expect(rewriteUrlForHost("http://[::]:5000")).toBe("http://127.0.0.1:5000");
	});

	it("leaves localhost unchanged", () => {
		expect(rewriteUrlForHost("http://localhost:5000")).toBe("http://localhost:5000");
	});

	it("leaves 127.0.0.1 unchanged", () => {
		expect(rewriteUrlForHost("http://127.0.0.1:5000")).toBe("http://127.0.0.1:5000");
	});

	it("returns the original string for invalid URLs", () => {
		expect(rewriteUrlForHost("not-a-url")).toBe("not-a-url");
	});

	it("strips trailing slash", () => {
		expect(rewriteUrlForHost("http://0.0.0.0:5000/")).toBe("http://127.0.0.1:5000");
	});
});

// ---------------------------------------------------------------------------
// WslLauncher
// ---------------------------------------------------------------------------

/** Helper to create a fake spawn that we can control. */
function createMockSpawn() {
	const child = new EventEmitter() as EventEmitter & {
		stdout: Readable; stderr: Readable;
		kill: ReturnType<typeof vi.fn>; pid: number;
	};
	child.stdout = new Readable({ read() {} });
	child.stderr = new Readable({ read() {} });
	child.kill = vi.fn();
	child.pid = 12345;
	const spawnFn = vi.fn().mockReturnValue(child);
	return { child, spawnFn };
}

describe("WslLauncher", () => {
	it("resolves with rewritten URL when child emits ready JSON", async () => {
		const { child, spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Ubuntu", authToken: "tok", readyTimeoutMs: 5000,
			spawnFn: spawnFn as any,
		});
		const p = launcher.start();
		child.stdout.push('{"ready":true,"url":"http://0.0.0.0:9999"}\n');
		const result = await p;
		expect(result.url).toBe("http://127.0.0.1:9999");
		expect(launcher.running).toBe(true);
	});

	it("passes correct args to wsl.exe", async () => {
		const { child, spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Debian", command: "npx",
			commandArgs: ["kanban", "--host", "0.0.0.0"],
			authToken: "mytoken", spawnFn: spawnFn as any,
		});
		const p = launcher.start();
		child.stdout.push('{"ready":true,"url":"http://0.0.0.0:1234"}\n');
		await p;
		const [file, args] = spawnFn.mock.calls[0]!;
		expect(file).toBe("wsl.exe");
		expect(args).toEqual([
			"-d", "Debian", "--", "npx", "kanban", "--host", "0.0.0.0",
			"--auth-token", "mytoken",
		]);
	});

	it("rejects when child exits before ready", async () => {
		const { child, spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Ubuntu", authToken: "tok", readyTimeoutMs: 5000,
			spawnFn: spawnFn as any,
		});
		const p = launcher.start();
		child.emit("exit", 1, null);
		await expect(p).rejects.toThrow("WSL child exited");
		expect(launcher.running).toBe(false);
	});

	it("rejects when child emits error", async () => {
		const { child, spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Ubuntu", authToken: "tok", readyTimeoutMs: 5000,
			spawnFn: spawnFn as any,
		});
		const p = launcher.start();
		child.emit("error", new Error("spawn failed"));
		await expect(p).rejects.toThrow("spawn failed");
	});

	it("rejects on ready timeout", async () => {
		const { spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Ubuntu", authToken: "tok", readyTimeoutMs: 50,
			spawnFn: spawnFn as any,
		});
		await expect(launcher.start()).rejects.toThrow("did not become ready");
	});

	it("throws if start is called twice", async () => {
		const { child, spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Ubuntu", authToken: "tok", spawnFn: spawnFn as any,
		});
		const p = launcher.start();
		child.stdout.push('{"ready":true,"url":"http://0.0.0.0:1234"}\n');
		await p;
		await expect(launcher.start()).rejects.toThrow("already running");
	});

	it("stop kills the child", async () => {
		const { child, spawnFn } = createMockSpawn();
		const launcher = new WslLauncher({
			distro: "Ubuntu", authToken: "tok", spawnFn: spawnFn as any,
		});
		const p = launcher.start();
		child.stdout.push('{"ready":true,"url":"http://0.0.0.0:1234"}\n');
		await p;
		launcher.stop();
		expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		expect(launcher.running).toBe(false);
	});
});
