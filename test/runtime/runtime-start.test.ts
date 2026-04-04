import { afterEach, describe, expect, it } from "vitest";
import {
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
} from "../../src/core/runtime-endpoint";
import type { RuntimeCallbacks, RuntimeHandle, RuntimeOptions, RuntimeStartOptions } from "../../src/runtime-start";

const originalHost = getKanbanRuntimeHost();
const originalPort = getKanbanRuntimePort();
const originalEnvHost = process.env.KANBAN_RUNTIME_HOST;
const originalEnvPort = process.env.KANBAN_RUNTIME_PORT;

afterEach(() => {
	setKanbanRuntimeHost(originalHost);
	setKanbanRuntimePort(originalPort);
	if (originalEnvHost === undefined) {
		delete process.env.KANBAN_RUNTIME_HOST;
	} else {
		process.env.KANBAN_RUNTIME_HOST = originalEnvHost;
	}
	if (originalEnvPort === undefined) {
		delete process.env.KANBAN_RUNTIME_PORT;
	} else {
		process.env.KANBAN_RUNTIME_PORT = originalEnvPort;
	}
});

describe("runtime-start types", () => {
	it("exports RuntimeStartOptions interface with expected optional fields", () => {
		const options: RuntimeStartOptions = {};
		expect(options.host).toBeUndefined();
		expect(options.port).toBeUndefined();
		expect(options.authToken).toBeUndefined();
		expect(options.cwd).toBeUndefined();
		expect(options.openInBrowser).toBeUndefined();
		expect(options.callbacks).toBeUndefined();
	});

	it("RuntimeStartOptions has callbacks as a nested object with pickDirectory and warn", () => {
		const options: RuntimeStartOptions = {
			callbacks: {
				pickDirectory: async () => "/tmp/test",
				warn: () => {},
			},
		};
		expect(options.callbacks).toBeDefined();
		expect(typeof options.callbacks?.pickDirectory).toBe("function");
		expect(typeof options.callbacks?.warn).toBe("function");
	});

	it("RuntimeCallbacks interface has expected shape", () => {
		const callbacks: RuntimeCallbacks = {};
		expect(callbacks.pickDirectory).toBeUndefined();
		expect(callbacks.warn).toBeUndefined();
	});

	it("RuntimeOptions is a deprecated alias for RuntimeStartOptions", () => {
		const options: RuntimeOptions = {};
		const startOptions: RuntimeStartOptions = options;
		expect(startOptions).toBe(options);
	});

	it("exports RuntimeHandle interface shape", () => {
		const handle: RuntimeHandle = {
			url: "http://127.0.0.1:3484",
			shutdown: async () => {},
		};
		expect(handle.url).toBe("http://127.0.0.1:3484");
		expect(typeof handle.shutdown).toBe("function");
	});

	it("RuntimeHandle does not expose close — only url and shutdown", () => {
		const handle: RuntimeHandle = {
			url: "http://127.0.0.1:3484",
			shutdown: async () => {},
		};
		expect(Object.keys(handle).sort()).toEqual(["shutdown", "url"]);
	});

	it("callbacks.pickDirectory is async", async () => {
		const pickDirectory: NonNullable<RuntimeCallbacks["pickDirectory"]> = async () => "/tmp/test";
		const result = await pickDirectory();
		expect(result).toBe("/tmp/test");
	});

	it("callbacks.pickDirectory can return null", async () => {
		const pickDirectory: NonNullable<RuntimeCallbacks["pickDirectory"]> = async () => null;
		const result = await pickDirectory();
		expect(result).toBeNull();
	});

	it("callbacks.warn receives a string message", () => {
		const messages: string[] = [];
		const warn: NonNullable<RuntimeCallbacks["warn"]> = (message) => {
			messages.push(message);
		};
		warn("test warning");
		expect(messages).toEqual(["test warning"]);
	});

	it("RuntimeStartOptions.cwd accepts an explicit working directory", () => {
		const options: RuntimeStartOptions = { cwd: "/tmp/kanban-workspace" };
		expect(options.cwd).toBe("/tmp/kanban-workspace");
	});

	it("startRuntime with no callbacks provided still compiles (callbacks is optional)", () => {
		const options: RuntimeStartOptions = {
			host: "127.0.0.1",
			port: 3484,
		};
		expect(options.callbacks).toBeUndefined();
	});

	it("startRuntime is exported as a function", async () => {
		const mod = await import("../../src/runtime-start");
		expect(typeof mod.startRuntime).toBe("function");
	});
});

describe("runScopedCommand", () => {
	it("is exported from core/scoped-command", async () => {
		const mod = await import("../../src/core/scoped-command");
		expect(typeof mod.runScopedCommand).toBe("function");
	});
});
