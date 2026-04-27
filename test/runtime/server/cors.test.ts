import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { evaluateCors, handleCorsSocket } from "../../../src/server/cors";

const ALLOWED = "http://127.0.0.1:3484";

function makeFakeRequest(headers: Partial<IncomingMessage["headers"]>, method = "GET"): IncomingMessage {
	return { method, headers } as IncomingMessage;
}

describe("evaluateCors", () => {
	it("allows requests with no Origin header", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: undefined,
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "allow", origin: null });
	});

	it("allows requests with an empty Origin header", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: "",
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "allow", origin: null });
	});

	it("allows requests whose Origin matches the runtime origin", () => {
		const decision = evaluateCors({
			method: "POST",
			originHeader: ALLOWED,
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "allow", origin: ALLOWED });
	});

	it("rejects requests from a different origin", () => {
		const decision = evaluateCors({
			method: "POST",
			originHeader: "http://evil.example.com",
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "reject", origin: "http://evil.example.com" });
	});

	it("rejects requests from the same host but a different port", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: "http://127.0.0.1:9999",
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "reject", origin: "http://127.0.0.1:9999" });
	});

	it("rejects requests from the same host but a different scheme", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: "https://127.0.0.1:3484",
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "reject", origin: "https://127.0.0.1:3484" });
	});

	it("returns a preflight decision for OPTIONS from the allowed origin", () => {
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: ALLOWED,
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "preflight", origin: ALLOWED });
	});

	it("rejects preflight from a disallowed origin", () => {
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: "http://evil.example.com",
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "reject", origin: "http://evil.example.com" });
	});

	it("allows OPTIONS without an Origin header (not a CORS preflight)", () => {
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: undefined,
			allowedOrigin: ALLOWED,
		});
		expect(decision).toEqual({ kind: "allow", origin: null });
	});
});

describe("handleCorsSocket", () => {
	it("passes through upgrades with no Origin header", () => {
		const socket = new PassThrough();
		const result = handleCorsSocket(makeFakeRequest({}), socket);
		expect(result).toEqual({ end: false });
		expect(socket.destroyed).toBe(false);
	});

	it("passes through upgrades whose Origin matches the runtime origin", () => {
		const socket = new PassThrough();
		const result = handleCorsSocket(makeFakeRequest({ origin: ALLOWED }), socket);
		expect(result).toEqual({ end: false });
		expect(socket.destroyed).toBe(false);
	});

	it("rejects upgrades from a disallowed origin and writes a 403 status line", () => {
		const socket = new PassThrough();
		const written: Buffer[] = [];
		socket.on("data", (chunk) => {
			written.push(chunk as Buffer);
		});
		const result = handleCorsSocket(makeFakeRequest({ origin: "http://evil.example.com" }), socket);
		expect(result).toEqual({ end: true });
		expect(socket.destroyed).toBe(true);
		expect(Buffer.concat(written).toString("utf8")).toContain("HTTP/1.1 403 Forbidden");
	});
});
