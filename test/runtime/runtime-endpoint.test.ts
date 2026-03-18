import { afterEach, describe, expect, it } from "vitest";

import {
	buildKanbanRuntimeUrl,
	buildKanbanRuntimeWsUrl,
	DEFAULT_KANBAN_RUNTIME_PORT,
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	parseRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
} from "../../src/core/runtime-endpoint.js";

const originalRuntimePort = getKanbanRuntimePort();
const originalRuntimeHost = getKanbanRuntimeHost();
const originalEnvPort = process.env.KANBAN_RUNTIME_PORT;
const originalEnvHost = process.env.KANBAN_RUNTIME_HOST;

afterEach(() => {
	setKanbanRuntimePort(originalRuntimePort);
	setKanbanRuntimeHost(originalRuntimeHost);
	if (originalEnvPort === undefined) {
		delete process.env.KANBAN_RUNTIME_PORT;
	} else {
		process.env.KANBAN_RUNTIME_PORT = originalEnvPort;
	}
	if (originalEnvHost === undefined) {
		delete process.env.KANBAN_RUNTIME_HOST;
	} else {
		process.env.KANBAN_RUNTIME_HOST = originalEnvHost;
	}
});

describe("runtime-endpoint", () => {
	it("parses default port when env value is missing", () => {
		expect(parseRuntimePort(undefined)).toBe(DEFAULT_KANBAN_RUNTIME_PORT);
	});

	it("throws for invalid ports", () => {
		expect(() => parseRuntimePort("0")).toThrow(/Invalid KANBAN_RUNTIME_PORT value/);
		expect(() => parseRuntimePort("70000")).toThrow(/Invalid KANBAN_RUNTIME_PORT value/);
		expect(() => parseRuntimePort("abc")).toThrow(/Invalid KANBAN_RUNTIME_PORT value/);
	});

	it("updates runtime url builders when port changes", () => {
		setKanbanRuntimePort(4567);
		expect(getKanbanRuntimePort()).toBe(4567);
		expect(process.env.KANBAN_RUNTIME_PORT).toBe("4567");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("http://127.0.0.1:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("ws://127.0.0.1:4567/api/terminal/ws");
	});

	it("updates runtime url builders when host changes", () => {
		setKanbanRuntimeHost("100.64.0.1");
		setKanbanRuntimePort(4567);
		expect(getKanbanRuntimeHost()).toBe("100.64.0.1");
		expect(process.env.KANBAN_RUNTIME_HOST).toBe("100.64.0.1");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("http://100.64.0.1:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("ws://100.64.0.1:4567/api/terminal/ws");
	});

	it("defaults host to 127.0.0.1", () => {
		expect(getKanbanRuntimeHost()).toBe("127.0.0.1");
	});
});
