import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
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
const ALLOWED_ORIGIN = "http://127.0.0.1:3484";
const ALLOWED_ORIGINS = [ALLOWED_ORIGIN];

describe("CSRF Origin validation", () => {
	describe("HTTP requests — Origin present + mismatched → 403", () => {
		it("rejects API request with mismatched Origin header", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(403);
			expect(JSON.parse(mock.getBody())).toEqual({ error: "Forbidden" });
		});

		it("rejects API request with mismatched Origin even without auth token configured", () => {
			const middleware = createAuthMiddleware({
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { origin: "http://evil.example.com" },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(403);
		});

		it("rejects Origin with different port", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://127.0.0.1:9999",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(403);
		});

		it("rejects Origin with different scheme (https vs http)", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ["http://127.0.0.1:3484"],
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "https://127.0.0.1:3484",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(403);
		});
	});

	describe("HTTP requests — Origin absent → allow (non-browser clients)", () => {
		it("allows API request without Origin header", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { authorization: `Bearer ${TEST_TOKEN}` },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows API request with empty Origin header", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});
	});

	describe("HTTP requests — Origin present + matched → allow", () => {
		it("allows API request with matching Origin header", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: ALLOWED_ORIGIN,
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows API request matching any of multiple allowed origins", () => {
			const multipleOrigins = ["http://127.0.0.1:3484", "http://localhost:3484"];
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: multipleOrigins,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://localhost:3484",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});
	});

	describe("WebSocket upgrade — CSRF Origin validation", () => {
		it("rejects WS upgrade with mismatched Origin", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			expect(middleware.handleWsUpgrade(req)).toBe(false);
		});

		it("allows WS upgrade without Origin header (non-browser client)", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: { authorization: `Bearer ${TEST_TOKEN}` },
			});
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});

		it("allows WS upgrade with matching Origin", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: ALLOWED_ORIGIN,
				},
			});
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});

		it("rejects WS upgrade with mismatched Origin even without auth token", () => {
			const middleware = createAuthMiddleware({
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: { origin: "http://evil.example.com" },
			});
			expect(middleware.handleWsUpgrade(req)).toBe(false);
		});

		it("allows WS upgrade without Origin and without auth token", () => {
			const middleware = createAuthMiddleware({
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: {},
			});
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});
	});

	describe("static assets and health exempt from CSRF", () => {
		it("allows static asset with mismatched Origin (no CSRF check on statics)", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/index.html",
				headers: { origin: "http://evil.example.com" },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("/api/health responds normally regardless of Origin", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/health",
				headers: { origin: "http://evil.example.com" },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(200);
			expect(JSON.parse(mock.getBody())).toEqual({ ok: true, version: TEST_VERSION });
		});
	});

	describe("no allowedOrigins configured → skip CSRF", () => {
		it("allows API request with any Origin when allowedOrigins is undefined", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows API request with any Origin when allowedOrigins is empty", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: [],
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(true);
		});

		it("allows WS upgrade with any Origin when allowedOrigins is undefined", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});

		it("allows WS upgrade with any Origin when allowedOrigins is empty", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: [],
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/runtime/ws",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			expect(middleware.handleWsUpgrade(req)).toBe(true);
		});
	});

	describe("CSRF runs before token auth (defense-in-depth)", () => {
		it("returns 403 for mismatched Origin even with valid Bearer token", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: {
					authorization: `Bearer ${TEST_TOKEN}`,
					origin: "http://evil.example.com",
				},
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			expect(mock.getStatus()).toBe(403);
			expect(JSON.parse(mock.getBody())).toEqual({ error: "Forbidden" });
		});

		it("returns 403 (not 401) for mismatched Origin with missing Bearer token", () => {
			const middleware = createAuthMiddleware({
				authToken: TEST_TOKEN,
				allowedOrigins: ALLOWED_ORIGINS,
				version: TEST_VERSION,
			});
			const req = createMockRequest({
				url: "/api/trpc/some.procedure",
				headers: { origin: "http://evil.example.com" },
			});
			const mock = createMockResponse();
			const result = middleware.handleHttpRequest(req, mock.response);
			expect(result).toBe(false);
			// CSRF check fires first → 403, not 401
			expect(mock.getStatus()).toBe(403);
		});
	});
});
