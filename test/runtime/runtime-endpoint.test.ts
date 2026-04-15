import { afterEach, describe, expect, it } from "vitest";

import {
	buildKanbanRuntimeUrl,
	buildKanbanRuntimeWsUrl,
	clearKanbanRuntimeTls,
	DEFAULT_KANBAN_RUNTIME_PORT,
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	getRuntimeFetch,
	isKanbanRuntimeHttps,
	parseRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
	setKanbanRuntimeTls,
} from "../../src/core/runtime-endpoint";

const originalRuntimePort = getKanbanRuntimePort();
const originalRuntimeHost = getKanbanRuntimeHost();
const originalEnvPort = process.env.KANBAN_RUNTIME_PORT;
const originalEnvHost = process.env.KANBAN_RUNTIME_HOST;
const originalEnvHttps = process.env.KANBAN_RUNTIME_HTTPS;
const originalEnvTlsCa = process.env.KANBAN_RUNTIME_TLS_CA;

afterEach(() => {
	setKanbanRuntimePort(originalRuntimePort);
	setKanbanRuntimeHost(originalRuntimeHost);
	clearKanbanRuntimeTls();
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
	if (originalEnvHttps === undefined) {
		delete process.env.KANBAN_RUNTIME_HTTPS;
	} else {
		process.env.KANBAN_RUNTIME_HTTPS = originalEnvHttps;
	}
	if (originalEnvTlsCa === undefined) {
		delete process.env.KANBAN_RUNTIME_TLS_CA;
	} else {
		process.env.KANBAN_RUNTIME_TLS_CA = originalEnvTlsCa;
	}
});

describe("runtime-endpoint", () => {
	it("parses default port when env value is missing", () => {
		expect(parseRuntimePort(undefined)).toBe(DEFAULT_KANBAN_RUNTIME_PORT);
	});

	it("throws for invalid ports", () => {
		expect(parseRuntimePort("0")).toBe(0);
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

	it("switches runtime url builders to https and wss when tls is enabled", () => {
		setKanbanRuntimeHost("localhost");
		setKanbanRuntimePort(4567);
		setKanbanRuntimeTls({
			cert: "test-cert",
			key: "test-key",
			ca: "test-cert",
		});
		expect(isKanbanRuntimeHttps()).toBe(true);
		expect(process.env.KANBAN_RUNTIME_HTTPS).toBe("1");
		expect(process.env.KANBAN_RUNTIME_TLS_CA).toBe("test-cert");
		expect(buildKanbanRuntimeUrl("/api/trpc")).toBe("https://localhost:4567/api/trpc");
		expect(buildKanbanRuntimeWsUrl("api/terminal/ws")).toBe("wss://localhost:4567/api/terminal/ws");
	});

	it("creates a pinned runtime fetch only when a tls ca is configured", async () => {
		expect(await getRuntimeFetch()).toBe(globalThis.fetch);
		setKanbanRuntimeTls({
			cert: "test-cert",
			key: "test-key",
			ca: "test-cert",
		});
		expect(await getRuntimeFetch()).not.toBe(globalThis.fetch);
	});
});
