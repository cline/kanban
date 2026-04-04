import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createAuthMiddleware } from "../../src/server/auth-middleware";

function createMockRequest(overrides?: {
	url?: string;
	headers?: Record<string, string | string[] | undefined>;
}): IncomingMessage {
	return {
		url: overrides?.url ?? "/",
		headers: overrides?.headers ?? {},
	} as IncomingMessage;
}

interface MockResponse {
	response: ServerResponse;
	getStatus: () => number | undefined;
	getHeaders: () => Record<string, string | string[] | number | undefined>;
	getBody: () => string;
}

function createMockResponse(): MockResponse {
	let statusCode: number | undefined;
	let responseHeaders: Record<string, string | string[] | number | undefined> = {};
	let body = "";

	const res = {
		writeHead(status: number, ...rest: unknown[]): ServerResponse {
			statusCode = status;
			if (rest.length === 2) {
				responseHeaders = rest[1] as Record<string, string | string[] | number | undefined>;
			} else if (rest.length === 1 && typeof rest[0] === "object" && rest[0] !== null) {
				responseHeaders = rest[0] as Record<string, string | string[] | number | undefined>;
			}
			return res as unknown as ServerResponse;
		},
		end(data?: string) {
			if (data) {
				body = data;
			}
		},
	} as unknown as ServerResponse;

	return {
		response: res,
		getStatus: () => statusCode,
		getHeaders: () => responseHeaders,
		getBody: () => body,
	};
}

const TEST_TOKEN = "test-secret-token-abc123";
const TEST_VERSION = "1.2.3";

describe("auth-middleware", () => {
	describe("token validation with authToken configured", () => {
		it("allows request with valid Bearer token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { authorization: `Bearer ${TEST_TOKEN}` },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("rejects request with wrong token → 401", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { authorization: "Bearer wrong-token" },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(401);
			expect(JSON.parse(mock.getBody())).toEqual({ error: "Unauthorized" });
		});

		it("rejects request without Authorization header → 401", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/trpc/some.procedure", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(401);
		});

		it("rejects malformed Authorization header (no Bearer prefix)", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { authorization: TEST_TOKEN },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(401);
		});

		it("rejects empty Bearer token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { authorization: "Bearer " },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(401);
		});

		it("rejects extra spaces in Authorization header", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { authorization: `Bearer  ${TEST_TOKEN}` },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(401);
		});
	});

	describe("static assets exempt from auth", () => {
		it("allows static asset request without token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/index.html", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows JS asset request without token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/assets/main.js", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows CSS asset request without token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/assets/style.css", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows root path request without token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});
	});

	describe("/api/health endpoint", () => {
		it("returns { ok: true, version } without auth", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/health", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(200);
			expect(JSON.parse(mock.getBody())).toEqual({ ok: true, version: TEST_VERSION });
		});

		it("returns health even when no auth token is configured", () => {
			const middleware = createAuthMiddleware({ version: "0.0.1" });
			const req = createMockRequest({ url: "/api/health", headers: {} });
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(200);
			expect(JSON.parse(mock.getBody())).toEqual({ ok: true, version: "0.0.1" });
		});

		it("returns health response with Content-Type application/json", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/health" });
			const mock = createMockResponse();
			middleware.handleHttpRequest(req, mock.response);
			expect(mock.getHeaders()["Content-Type"]).toBe("application/json; charset=utf-8");
		});
	});

	describe("CSP headers on HTML responses", () => {
		it("adds Content-Security-Policy header when Content-Type is text/html", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = createMockRequest({ url: "/index.html" });
			const headers: Record<string, string | string[] | number | undefined> = {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			};
			const res = {
				writeHead: vi.fn((_s: number, _h: Record<string, string | string[] | number | undefined>) => res),
				end: vi.fn(),
			} as unknown as ServerResponse;
			middleware.handleHttpRequest(req, res);
			res.writeHead(200, headers);
			expect(headers["Content-Security-Policy"]).toBe(
				"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: https://*.ingest.us.sentry.io; img-src 'self' data:",
			);
		});

		it("does not add CSP header for non-HTML responses", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = createMockRequest({ url: "/assets/main.js" });
			const headers: Record<string, string | string[] | number | undefined> = {
				"Content-Type": "text/javascript; charset=utf-8",
			};
			const res = {
				writeHead: vi.fn((_s: number, _h: Record<string, string | string[] | number | undefined>) => res),
				end: vi.fn(),
			} as unknown as ServerResponse;
			middleware.handleHttpRequest(req, res);
			res.writeHead(200, headers);
			expect(headers["Content-Security-Policy"]).toBeUndefined();
		});

		it("adds CSP header with statusMessage + headers overload", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = createMockRequest({ url: "/" });
			const headers: Record<string, string | string[] | number | undefined> = {
				"Content-Type": "text/html; charset=utf-8",
			};
			const res = {
				writeHead: vi.fn(),
				end: vi.fn(),
			} as unknown as ServerResponse;
			middleware.handleHttpRequest(req, res);
			(
				res.writeHead as (
					...args: [number, string, Record<string, string | string[] | number | undefined>]
				) => unknown
			)(200, "OK", headers);
			expect(headers["Content-Security-Policy"]).toBe(
				"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss: https://*.ingest.us.sentry.io; img-src 'self' data:",
			);
		});
	});

	describe("WebSocket upgrade auth", () => {
		it("allows WS upgrade with valid Bearer token in header", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: { authorization: `Bearer ${TEST_TOKEN}` },
			});
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});

		it("rejects WS upgrade without Authorization header", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/runtime/ws", headers: {} });
			expect(middleware.handleWsUpgrade(req)).toBe(false);
		});

		it("rejects WS upgrade with wrong token", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: { authorization: "Bearer wrong-token" },
			});
			expect(middleware.handleWsUpgrade(req)).toBe(false);
		});

		it("rejects WS upgrade with token only in query param (no header)", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: `/api/runtime/ws?token=${TEST_TOKEN}`,
				headers: {},
			});
			expect(middleware.handleWsUpgrade(req)).toBe(false);
		});

		it("WS auth ignores query params — only checks headers", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({
				url: `/api/runtime/ws?token=${TEST_TOKEN}`,
				headers: { authorization: "Bearer wrong-token" },
			});
			expect(middleware.handleWsUpgrade(req)).toBe(false);
		});
	});

	describe("no authToken configured (local CLI mode)", () => {
		it("allows API request without token", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/trpc/some.procedure", headers: {} });
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(true);
		});

		it("allows WS upgrade without token", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/runtime/ws", headers: {} });
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});

		it("allows static assets", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = createMockRequest({ url: "/assets/style.css", headers: {} });
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(true);
		});
	});

	describe("constant-time comparison", () => {
		it("rejects token of different length", () => {
			const middleware = createAuthMiddleware({ authToken: "short", version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/x",
				headers: { authorization: "Bearer a-much-longer-token" },
			});
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(false);
			expect(mock.getStatus()).toBe(401);
		});

		it("rejects token of same length but different content", () => {
			const middleware = createAuthMiddleware({ authToken: "aaaa", version: TEST_VERSION });
			const req = createMockRequest({
				url: "/api/trpc/x",
				headers: { authorization: "Bearer bbbb" },
			});
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(false);
			expect(mock.getStatus()).toBe(401);
		});
	});

	describe("edge cases", () => {
		it("handles request with undefined url", () => {
			const middleware = createAuthMiddleware({ version: TEST_VERSION });
			const req = { url: undefined, headers: {} } as unknown as IncomingMessage;
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(true);
		});

		it("treats empty authToken string as no auth configured", () => {
			const middleware = createAuthMiddleware({ authToken: "", version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/trpc/x", headers: {} });
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(true);
		});

		it("handleHttpRequest returns false for /api/health (response already sent)", () => {
			const middleware = createAuthMiddleware({ authToken: TEST_TOKEN, version: TEST_VERSION });
			const req = createMockRequest({ url: "/api/health" });
			const mock = createMockResponse();
			expect(middleware.handleHttpRequest(req, mock.response)).toBe(false);
			expect(mock.getStatus()).toBe(200);
		});
	});
});
