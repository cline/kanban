import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the descriptor module before importing the module under test.
const mockReadRuntimeDescriptor = vi.fn();
const mockIsDescriptorStale = vi.fn();

vi.mock("../../../src/core/runtime-descriptor", () => ({
	readRuntimeDescriptor: mockReadRuntimeDescriptor,
	isDescriptorStale: mockIsDescriptorStale,
}));

// Mock fetch globally.
const mockFetch = vi.fn();

describe("resolveRuntimeConnection", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.resetModules();
		mockReadRuntimeDescriptor.mockReset();
		mockIsDescriptorStale.mockReset();
		mockFetch.mockReset();

		// Clean env
		delete process.env.KANBAN_RUNTIME_HOST;
		delete process.env.KANBAN_RUNTIME_PORT;
		delete process.env.KANBAN_AUTH_TOKEN;
		delete process.env.KANBAN_RUNTIME_HTTPS;
		delete process.env.KANBAN_RUNTIME_TLS_CA;

		// Install mock fetch
		vi.stubGlobal("fetch", mockFetch);
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		vi.unstubAllGlobals();
	});

	async function loadModule() {
		return await import("../../../src/core/runtime-endpoint");
	}

	it("env override wins over everything", async () => {
		process.env.KANBAN_RUNTIME_HOST = "10.0.0.5";
		process.env.KANBAN_RUNTIME_PORT = "9999";
		process.env.KANBAN_AUTH_TOKEN = "env-token";

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("env");
		expect(result.origin).toBe("http://10.0.0.5:9999");
		expect(result.authToken).toBe("env-token");

		// Descriptor should NOT be consulted.
		expect(mockReadRuntimeDescriptor).not.toHaveBeenCalled();
		// Fetch should NOT be called (no health check for env).
		expect(mockFetch).not.toHaveBeenCalled();
	});

	it("healthy descriptor wins over reachable default port", async () => {
		// Descriptor points to a non-default port.
		mockReadRuntimeDescriptor.mockResolvedValue({
			url: "http://127.0.0.1:52341",
			authToken: "desc-token",
			pid: 12345,
			updatedAt: new Date().toISOString(),
			source: "cli",
		});
		mockIsDescriptorStale.mockReturnValue(false);

		// Both descriptor runtime and default port respond.
		mockFetch.mockImplementation((_url: string) => {
			return Promise.resolve({ status: 200 });
		});

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("descriptor");
		expect(result.origin).toBe("http://127.0.0.1:52341");
		expect(result.authToken).toBe("desc-token");

		// Should have health-checked the descriptor URL, NOT the default.
		const fetchCalls = mockFetch.mock.calls.map((c) => c[0] as string);
		expect(fetchCalls[0]).toContain("127.0.0.1:52341");
	});

	it("stale descriptor is ignored — falls through to default port", async () => {
		mockReadRuntimeDescriptor.mockResolvedValue({
			url: "http://127.0.0.1:52341",
			authToken: "desc-token",
			pid: 99999,
			updatedAt: "2020-01-01T00:00:00.000Z",
			source: "cli",
		});
		mockIsDescriptorStale.mockReturnValue(true);

		// Default port responds.
		mockFetch.mockResolvedValue({ status: 200 });

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("default");
		expect(result.origin).toBe("http://127.0.0.1:3484");
	});

	it("no descriptor — default port is used when reachable", async () => {
		mockReadRuntimeDescriptor.mockResolvedValue(null);

		// Default port responds.
		mockFetch.mockResolvedValue({ status: 200 });

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("default");
		expect(result.origin).toBe("http://127.0.0.1:3484");
	});

	it("descriptor runtime unreachable — falls through to default port", async () => {
		mockReadRuntimeDescriptor.mockResolvedValue({
			url: "http://127.0.0.1:52341",
			authToken: "desc-token",
			pid: 12345,
			updatedAt: new Date().toISOString(),
			source: "cli",
		});
		mockIsDescriptorStale.mockReturnValue(false);

		// Descriptor runtime unreachable, default port responds.
		mockFetch.mockImplementation((url: string) => {
			if (url.includes("52341")) {
				return Promise.reject(new Error("ECONNREFUSED"));
			}
			return Promise.resolve({ status: 200 });
		});

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("default");
		expect(result.origin).toBe("http://127.0.0.1:3484");
	});

	it("nothing reachable — returns default origin for clear error", async () => {
		mockReadRuntimeDescriptor.mockResolvedValue(null);
		mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("default");
		expect(result.origin).toBe("http://127.0.0.1:3484");
		expect(result.authToken).toBeNull();
	});

	it("descriptor URL with workspace path — origin strips path", async () => {
		// Desktop may write a URL like "http://127.0.0.1:62929/cline" that
		// includes a workspace path.  The resolver must strip the path so
		// TRPC calls don't get routed to /cline/api/trpc/…
		mockReadRuntimeDescriptor.mockResolvedValue({
			url: "http://127.0.0.1:62929/cline",
			authToken: "desc-token",
			pid: 12345,
			updatedAt: new Date().toISOString(),
			source: "desktop",
		});
		mockIsDescriptorStale.mockReturnValue(false);
		mockFetch.mockResolvedValue({ status: 200 });

		const { resolveRuntimeConnection } = await loadModule();
		const result = await resolveRuntimeConnection();

		expect(result.source).toBe("descriptor");
		// Must be origin only — no /cline path.
		expect(result.origin).toBe("http://127.0.0.1:62929");
		expect(result.authToken).toBe("desc-token");
	});
});

describe("descriptorOriginFromUrl", () => {
	it("strips path from descriptor URL", async () => {
		const { descriptorOriginFromUrl } = await import("../../../src/core/runtime-endpoint");
		expect(descriptorOriginFromUrl("http://127.0.0.1:62929/cline")).toBe("http://127.0.0.1:62929");
		expect(descriptorOriginFromUrl("http://127.0.0.1:3484")).toBe("http://127.0.0.1:3484");
		expect(descriptorOriginFromUrl("https://10.0.0.5:9999/workspace/deep")).toBe("https://10.0.0.5:9999");
	});
});
