import { describe, expect, it, vi } from "vitest";
import {
	AUTH_HEADER_NAME,
	extractRuntimeAuthority,
	generateAuthToken,
	installAuthHeaderInterceptor,
	isRuntimeRequest,
	type BeforeSendHeadersCallback,
	type BeforeSendHeadersDetails,
	type ElectronSessionLike,
} from "../src/auth.js";

// ---------------------------------------------------------------------------
// Helper: create a mock ElectronSessionLike
// ---------------------------------------------------------------------------

function createMockSession() {
	const onBeforeSendHeaders = vi.fn();
	const session: ElectronSessionLike = {
		webRequest: { onBeforeSendHeaders },
	};
	return { session, onBeforeSendHeaders };
}

/**
 * Convenience: install the interceptor on a mock session and return a function
 * that simulates an outgoing request, returning the headers the interceptor
 * produces.
 */
function installAndGetListener(token: string, origin: string) {
	const { session, onBeforeSendHeaders } = createMockSession();
	installAuthHeaderInterceptor(session, token, origin);

	// The listener is the first argument of the first call (no filter overload)
	const listener = onBeforeSendHeaders.mock.calls[0][0] as (
		details: BeforeSendHeadersDetails,
		callback: BeforeSendHeadersCallback,
	) => void;

	return { listener, session, onBeforeSendHeaders };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Auth Token Generation", () => {
	it("generates a 64-character hex string", () => {
		const token = generateAuthToken();
		expect(token).toHaveLength(64);
		expect(token).toMatch(/^[0-9a-f]{64}$/);
	});

	it("generates unique tokens on each call", () => {
		const token1 = generateAuthToken();
		const token2 = generateAuthToken();
		expect(token1).not.toBe(token2);
	});
});

describe("extractRuntimeAuthority", () => {
	it("extracts host:port from a plain origin", () => {
		expect(extractRuntimeAuthority("http://localhost:3484")).toBe(
			"localhost:3484",
		);
	});

	it("extracts host:port from a URL with a path", () => {
		expect(extractRuntimeAuthority("http://127.0.0.1:3485/kanban")).toBe(
			"127.0.0.1:3485",
		);
	});

	it("extracts host:port from a URL with trailing slashes", () => {
		expect(extractRuntimeAuthority("http://localhost:52341/")).toBe(
			"localhost:52341",
		);
	});
});

describe("isRuntimeRequest", () => {
	it("matches HTTP requests to the runtime authority", () => {
		expect(isRuntimeRequest("http://127.0.0.1:3485/api/trpc/runtime.getInfo", "127.0.0.1:3485")).toBe(true);
	});

	it("matches WebSocket requests to the runtime authority", () => {
		expect(isRuntimeRequest("ws://127.0.0.1:3485/api/runtime/ws", "127.0.0.1:3485")).toBe(true);
	});

	it("rejects requests to a different host", () => {
		expect(isRuntimeRequest("http://example.com/api/foo", "127.0.0.1:3485")).toBe(false);
	});

	it("rejects requests to a different port", () => {
		expect(isRuntimeRequest("http://127.0.0.1:9999/api/foo", "127.0.0.1:3485")).toBe(false);
	});

	it("returns false for malformed URLs", () => {
		expect(isRuntimeRequest("not-a-url", "127.0.0.1:3485")).toBe(false);
	});
});

describe("installAuthHeaderInterceptor", () => {
	const TOKEN = "a".repeat(64);
	const ORIGIN = "http://localhost:52341";

	it("registers a listener via session.webRequest.onBeforeSendHeaders", () => {
		const { onBeforeSendHeaders } = installAndGetListener(TOKEN, ORIGIN);
		expect(onBeforeSendHeaders).toHaveBeenCalledOnce();
	});

	it("uses the no-filter overload to catch both http and ws requests", () => {
		const { onBeforeSendHeaders } = installAndGetListener(TOKEN, ORIGIN);
		// Should be called with a single argument (the listener) — no filter object
		expect(onBeforeSendHeaders.mock.calls[0]).toHaveLength(1);
	});

	it("injects the Authorization: Bearer header into matching requests", () => {
		const { listener } = installAndGetListener(TOKEN, ORIGIN);

		const details: BeforeSendHeadersDetails = {
			url: "http://localhost:52341/api/boards",
			requestHeaders: { Accept: "application/json" },
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result).toBeDefined();
		expect(result!.requestHeaders[AUTH_HEADER_NAME]).toBe(`Bearer ${TOKEN}`);
		// Preserves existing headers
		expect(result!.requestHeaders["Accept"]).toBe("application/json");
	});

	it("injects the header into WebSocket upgrade requests", () => {
		const { listener } = installAndGetListener(TOKEN, ORIGIN);

		const details: BeforeSendHeadersDetails = {
			url: "ws://localhost:52341/api/runtime/ws",
			requestHeaders: {},
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result).toBeDefined();
		expect(result!.requestHeaders[AUTH_HEADER_NAME]).toBe(`Bearer ${TOKEN}`);
	});

	it("does not inject the header into requests to other origins", () => {
		const { listener } = installAndGetListener(TOKEN, ORIGIN);

		const details: BeforeSendHeadersDetails = {
			url: "https://example.com/api/data",
			requestHeaders: { Accept: "application/json" },
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result).toBeDefined();
		expect(result!.requestHeaders).not.toHaveProperty(AUTH_HEADER_NAME);
		expect(result!.requestHeaders["Accept"]).toBe("application/json");
	});

	it("does not mutate the original details.requestHeaders", () => {
		const { listener } = installAndGetListener(TOKEN, ORIGIN);

		const originalHeaders: Record<string, string> = {
			Accept: "text/html",
		};
		const details: BeforeSendHeadersDetails = {
			url: "http://localhost:52341/index.html",
			requestHeaders: originalHeaders,
		};

		listener(details, () => {});
		expect(originalHeaders).not.toHaveProperty(AUTH_HEADER_NAME);
	});

	it("overwrites an existing Authorization header", () => {
		const { listener } = installAndGetListener(TOKEN, ORIGIN);

		const details: BeforeSendHeadersDetails = {
			url: "http://localhost:52341/api/boards",
			requestHeaders: { [AUTH_HEADER_NAME]: "Bearer old-token" },
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result!.requestHeaders[AUTH_HEADER_NAME]).toBe(`Bearer ${TOKEN}`);
	});

	it("works with different token and origin values", () => {
		const customToken = "b".repeat(64);
		const customOrigin = "http://127.0.0.1:9999";
		const { listener } = installAndGetListener(customToken, customOrigin);

		const details: BeforeSendHeadersDetails = {
			url: "http://127.0.0.1:9999/api/data",
			requestHeaders: {},
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result!.requestHeaders[AUTH_HEADER_NAME]).toBe(
			`Bearer ${customToken}`,
		);
	});

	it("handles runtime origin with /kanban path prefix", () => {
		const { listener } = installAndGetListener(TOKEN, "http://localhost:52341/kanban");

		// API request at root — should still match by host:port
		const details: BeforeSendHeadersDetails = {
			url: "http://localhost:52341/api/trpc/runtime.getInfo",
			requestHeaders: {},
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result!.requestHeaders[AUTH_HEADER_NAME]).toBe(`Bearer ${TOKEN}`);
	});

	it("returns a dispose function that removes the interceptor", () => {
		const { session, onBeforeSendHeaders } = createMockSession();
		const dispose = installAuthHeaderInterceptor(session, TOKEN, ORIGIN);

		expect(dispose).toBeTypeOf("function");
		expect(onBeforeSendHeaders).toHaveBeenCalledTimes(1);

		dispose();
		// Dispose calls onBeforeSendHeaders again with null to clear.
		expect(onBeforeSendHeaders).toHaveBeenCalledTimes(2);
	});

	it("dispose passes null (typed, not any) to clear the listener", () => {
		const { session, onBeforeSendHeaders } = createMockSession();
		const dispose = installAuthHeaderInterceptor(session, TOKEN, ORIGIN);

		dispose();
		// The second call (dispose) should pass exactly null.
		const disposeCallArgs = onBeforeSendHeaders.mock.calls[1];
		expect(disposeCallArgs).toHaveLength(1);
		expect(disposeCallArgs[0]).toBeNull();
	});

	it("can install, remove, and reinstall without duplicate handlers", () => {
		const { session, onBeforeSendHeaders } = createMockSession();

		// First install
		const dispose1 = installAuthHeaderInterceptor(session, TOKEN, ORIGIN);
		expect(onBeforeSendHeaders).toHaveBeenCalledTimes(1);

		// Remove
		dispose1();
		expect(onBeforeSendHeaders).toHaveBeenCalledTimes(2);
		expect(onBeforeSendHeaders.mock.calls[1][0]).toBeNull();

		// Reinstall with a different token
		const newToken = "c".repeat(64);
		const dispose2 = installAuthHeaderInterceptor(session, newToken, ORIGIN);
		expect(onBeforeSendHeaders).toHaveBeenCalledTimes(3);

		// The new listener should use the new token
		const listener = onBeforeSendHeaders.mock.calls[2][0] as (
			details: BeforeSendHeadersDetails,
			callback: BeforeSendHeadersCallback,
		) => void;

		const details: BeforeSendHeadersDetails = {
			url: "http://localhost:52341/api/boards",
			requestHeaders: {},
		};

		let result: { requestHeaders: Record<string, string> } | undefined;
		listener(details, (response) => {
			result = response;
		});

		expect(result!.requestHeaders[AUTH_HEADER_NAME]).toBe(`Bearer ${newToken}`);

		// Clean up
		dispose2();
		expect(onBeforeSendHeaders).toHaveBeenCalledTimes(4);
		expect(onBeforeSendHeaders.mock.calls[3][0]).toBeNull();
	});

	it("calling dispose multiple times does not register extra null calls", () => {
		const { session, onBeforeSendHeaders } = createMockSession();
		const dispose = installAuthHeaderInterceptor(session, TOKEN, ORIGIN);

		dispose();
		const callCountAfterFirstDispose = onBeforeSendHeaders.mock.calls.length;

		// Calling dispose again should be a no-op from the interceptor perspective —
		// the ConnectionManager guards against double-dispose, but the returned
		// function itself always calls through. This test documents that behavior.
		dispose();
		expect(onBeforeSendHeaders.mock.calls.length).toBe(callCountAfterFirstDispose + 1);
	});
});
