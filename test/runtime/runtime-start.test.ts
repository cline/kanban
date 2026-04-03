import { afterEach, describe, expect, it } from "vitest";
import {
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
} from "../../src/core/runtime-endpoint";
import type { RuntimeHandle, RuntimeOptions } from "../../src/runtime-start";

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
	it("exports RuntimeOptions interface with expected optional fields", () => {
		const options: RuntimeOptions = {};
		expect(options.host).toBeUndefined();
		expect(options.port).toBeUndefined();
		expect(options.authToken).toBeUndefined();
		expect(options.cwd).toBeUndefined();
		expect(options.openInBrowser).toBeUndefined();
		expect(options.pickDirectory).toBeUndefined();
		expect(options.warn).toBeUndefined();
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

	it("RuntimeOptions.pickDirectory is async", async () => {
		const pickDirectory: NonNullable<RuntimeOptions["pickDirectory"]> = async () => "/tmp/test";
		const result = await pickDirectory();
		expect(result).toBe("/tmp/test");
	});

	it("RuntimeOptions.pickDirectory can return null", async () => {
		const pickDirectory: NonNullable<RuntimeOptions["pickDirectory"]> = async () => null;
		const result = await pickDirectory();
		expect(result).toBeNull();
	});

	it("RuntimeOptions.cwd accepts an explicit working directory", () => {
		const options: RuntimeOptions = { cwd: "/tmp/kanban-workspace" };
		expect(options.cwd).toBe("/tmp/kanban-workspace");
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
