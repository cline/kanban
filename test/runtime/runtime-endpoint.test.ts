import { afterEach, describe, expect, it } from "vitest";

import {
	buildKanbanRuntimeUrl,
	buildKanbanRuntimeWsUrl,
	DEFAULT_KANBAN_RUNTIME_PORT,
	getKanbanRuntimePort,
	parseRuntimePort,
	setKanbanRuntimePort,
} from "../../src/core/runtime-endpoint.js";

const originalRuntimePort = getKanbanRuntimePort();
const originalEnvPort = process.env.KANBAN_RUNTIME_PORT;

afterEach(() => {
	setKanbanRuntimePort(originalRuntimePort);
	if (originalEnvPort === undefined) {
		delete process.env.KANBAN_RUNTIME_PORT;
		return;
	}
	process.env.KANBAN_RUNTIME_PORT = originalEnvPort;
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
});
