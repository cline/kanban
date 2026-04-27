import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";

export type CorsDecision =
	| { kind: "allow"; origin: string | null }
	| { kind: "preflight"; origin: string }
	| { kind: "reject"; origin: string };

export interface CorsGateInput {
	method: string | undefined;
	originHeader: string | undefined;
	allowedOrigin: string;
}

export function evaluateCors(input: CorsGateInput): CorsDecision {
	const origin = input.originHeader || null;
	const isPreflight = input.method === "OPTIONS";

	if (origin === null) {
		return { kind: "allow", origin: null };
	}

	if (origin !== input.allowedOrigin) {
		return { kind: "reject", origin };
	}

	if (isPreflight) {
		return { kind: "preflight", origin };
	}

	return { kind: "allow", origin };
}

const ALLOWED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].join(", ");
const ALLOWED_HEADERS = ["Authorization", "Content-Type", "X-Kanban-Workspace-Id"].join(", ");
const PREFLIGHT_MAX_AGE_SECONDS = "600";

function applyAllowedOriginHeaders(res: ServerResponse, origin: string): void {
	res.setHeader("Access-Control-Allow-Origin", origin);
	res.setHeader("Vary", "Origin");
	res.setHeader("Access-Control-Allow-Credentials", "true");
}

export function handleCorsRequest(req: IncomingMessage, res: ServerResponse): { end: boolean } {
	const decision = evaluateCors({
		method: req.method,
		originHeader: req.headers.origin,
		allowedOrigin: getKanbanRuntimeOrigin(),
	});

	switch (decision.kind) {
		case "allow": {
			if (decision.origin !== null) {
				applyAllowedOriginHeaders(res, decision.origin);
			}
			return { end: false };
		}
		case "preflight": {
			applyAllowedOriginHeaders(res, decision.origin);
			res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
			res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
			res.setHeader("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);
			res.writeHead(204);
			res.end();
			return { end: true };
		}
		case "reject": {
			res.writeHead(403, {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "no-store",
			});
			res.end(JSON.stringify({ error: "Origin not allowed." }));
			return { end: true };
		}
	}
}

export function handleCorsSocket(request: IncomingMessage, socket: Duplex): { end: boolean } {
	const decision = evaluateCors({
		method: request.method,
		originHeader: request.headers.origin,
		allowedOrigin: getKanbanRuntimeOrigin(),
	});

	if (decision.kind === "reject") {
		socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
		socket.destroy();
		return { end: true };
	}

	return { end: false };
}
