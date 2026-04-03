import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const CSP_HEADER_VALUE = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"connect-src 'self' ws: wss:",
	"img-src 'self' data:",
].join("; ");

export interface AuthMiddlewareDependencies {
	authToken?: string;
	version: string;
}

export interface AuthMiddleware {
	/**
	 * Validate an HTTP request. Returns true if the request should proceed,
	 * false if it has been rejected (response already sent with 401).
	 */
	handleHttpRequest: (req: IncomingMessage, res: ServerResponse) => boolean;

	/**
	 * Validate a WebSocket upgrade request. Returns true if the upgrade
	 * should proceed, false if it should be rejected.
	 */
	handleWsUpgrade: (req: IncomingMessage) => boolean;
}

function extractBearerToken(req: IncomingMessage): string | null {
	const header = req.headers.authorization;
	if (typeof header !== "string") {
		return null;
	}
	const parts = header.split(" ");
	if (parts.length !== 2 || parts[0] !== "Bearer") {
		return null;
	}
	return parts[1] ?? null;
}

function constantTimeEqual(a: string, b: string): boolean {
	const bufA = Buffer.from(a, "utf8");
	const bufB = Buffer.from(b, "utf8");
	if (bufA.length !== bufB.length) {
		return false;
	}
	return timingSafeEqual(bufA, bufB);
}

function isStaticAssetPath(pathname: string): boolean {
	return !pathname.startsWith("/api/");
}

function isHealthEndpoint(pathname: string): boolean {
	return pathname === "/api/health";
}

function isHtmlContentType(contentType: string | undefined): boolean {
	if (!contentType) {
		return false;
	}
	return contentType.includes("text/html");
}

function getPathname(req: IncomingMessage): string {
	const rawUrl = req.url ?? "/";
	try {
		const parsed = new URL(rawUrl, "http://localhost");
		return parsed.pathname;
	} catch {
		return rawUrl.split("?")[0] ?? rawUrl;
	}
}

function resolveHeadersFromArgs(args: unknown[]): Record<string, string | string[] | number | undefined> | undefined {
	// writeHead(statusCode, headers)
	if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
		return args[0] as Record<string, string | string[] | number | undefined>;
	}
	// writeHead(statusCode, statusMessage, headers)
	if (args.length === 2 && typeof args[0] === "string" && typeof args[1] === "object" && args[1] !== null) {
		return args[1] as Record<string, string | string[] | number | undefined>;
	}
	return undefined;
}

function patchWriteHeadForCsp(res: ServerResponse): void {
	const originalWriteHead = res.writeHead;
	function patchedWriteHead(statusCode: number, ...rest: unknown[]): ServerResponse {
		const headers = resolveHeadersFromArgs(rest);
		if (headers) {
			const contentType = headers["Content-Type"];
			const contentTypeStr = Array.isArray(contentType)
				? contentType[0]
				: typeof contentType === "string"
					? contentType
					: undefined;
			if (isHtmlContentType(contentTypeStr)) {
				headers["Content-Security-Policy"] = CSP_HEADER_VALUE;
			}
		}
		return originalWriteHead.apply(res, [statusCode, ...rest] as Parameters<typeof originalWriteHead>);
	}
	res.writeHead = patchedWriteHead as typeof res.writeHead;
}

export function createAuthMiddleware(deps: AuthMiddlewareDependencies): AuthMiddleware {
	const { authToken, version } = deps;

	const handleHttpRequest = (req: IncomingMessage, res: ServerResponse): boolean => {
		const pathname = getPathname(req);

		// /api/health is always exempt from auth
		if (isHealthEndpoint(pathname)) {
			res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: true, version }));
			return false; // Response already sent — caller should not continue routing
		}

		// Add CSP headers to the response for HTML responses.
		// We patch writeHead to inspect the headers argument and inject the CSP
		// header when the Content-Type indicates HTML.
		patchWriteHeadForCsp(res);

		// Static assets are exempt from auth (the web UI needs to load before it can send tokens)
		if (isStaticAssetPath(pathname)) {
			return true;
		}

		// When no authToken is configured (local CLI mode), skip validation
		if (!authToken) {
			return true;
		}

		const token = extractBearerToken(req);
		if (!token || !constantTimeEqual(token, authToken)) {
			res.writeHead(401, { "Content-Type": "application/json; charset=utf-8" });
			res.end('{"error":"Unauthorized"}');
			return false;
		}

		return true;
	};

	const handleWsUpgrade = (req: IncomingMessage): boolean => {
		// When no authToken is configured (local CLI mode), skip validation
		if (!authToken) {
			return true;
		}

		// WS auth is header-only. No query param fallback. Ever.
		const token = extractBearerToken(req);
		if (!token || !constantTimeEqual(token, authToken)) {
			return false;
		}

		return true;
	};

	return {
		handleHttpRequest,
		handleWsUpgrade,
	};
}
