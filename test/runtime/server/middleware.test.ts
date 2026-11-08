import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	getKanbanRuntimeHost,
	getKanbanRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
} from "../../../src/core/runtime-endpoint";
import { evaluateCors, evaluateHost, getAllowedHostHeaders, handleSocketUpgrade } from "../../../src/server/middleware";

const ALLOWED_ORIGIN = "http://127.0.0.1:3484";
const ALLOWED_HOSTS = new Set(["localhost:3484", "127.0.0.1:3484"]);

const originalRuntimePort = getKanbanRuntimePort();
const originalRuntimeHost = getKanbanRuntimeHost();

afterEach(() => {
	setKanbanRuntimePort(originalRuntimePort);
	setKanbanRuntimeHost(originalRuntimeHost);
});

function makeFakeRequest(headers: Partial<IncomingMessage["headers"]>, method = "GET"): IncomingMessage {
	return { method, headers } as IncomingMessage;
}

describe("evaluateCors", () => {
	it("allows requests with no Origin header", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: undefined,
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "allow", origin: null });
	});

	it("allows requests with an empty Origin header", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: "",
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "allow", origin: null });
	});

	it("allows requests whose Origin matches the runtime origin", () => {
		const decision = evaluateCors({
			method: "POST",
			originHeader: ALLOWED_ORIGIN,
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "allow", origin: ALLOWED_ORIGIN });
	});

	it("rejects requests from a different origin", () => {
		const decision = evaluateCors({
			method: "POST",
			originHeader: "http://evil.example.com",
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "reject", origin: "http://evil.example.com" });
	});

	it("rejects requests from the same host but a different port", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: "http://127.0.0.1:9999",
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "reject", origin: "http://127.0.0.1:9999" });
	});

	it("rejects requests from the same host but a different scheme", () => {
		const decision = evaluateCors({
			method: "GET",
			originHeader: "https://127.0.0.1:3484",
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "reject", origin: "https://127.0.0.1:3484" });
	});

	it("returns a preflight decision for OPTIONS from the allowed origin", () => {
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: ALLOWED_ORIGIN,
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "preflight", origin: ALLOWED_ORIGIN });
	});

	it("rejects preflight from a disallowed origin", () => {
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: "http://evil.example.com",
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "reject", origin: "http://evil.example.com" });
	});

	it("allows OPTIONS without an Origin header (not a CORS preflight)", () => {
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: undefined,
			allowedOrigin: ALLOWED_ORIGIN,
		});
		expect(decision).toEqual({ kind: "allow", origin: null });
	});
});

describe("evaluateHost", () => {
	it("rejects requests with no Host header", () => {
		expect(evaluateHost({ hostHeader: undefined, allowedHosts: ALLOWED_HOSTS })).toEqual({
			kind: "reject",
			host: null,
		});
	});

	it("rejects requests with an empty Host header", () => {
		expect(evaluateHost({ hostHeader: "", allowedHosts: ALLOWED_HOSTS })).toEqual({ kind: "reject", host: null });
	});

	it("allows requests whose Host is in the allowlist", () => {
		expect(evaluateHost({ hostHeader: "127.0.0.1:3484", allowedHosts: ALLOWED_HOSTS })).toEqual({ kind: "allow" });
		expect(evaluateHost({ hostHeader: "localhost:3484", allowedHosts: ALLOWED_HOSTS })).toEqual({ kind: "allow" });
	});

	it("normalises Host header casing before comparing", () => {
		expect(evaluateHost({ hostHeader: "LocalHost:3484", allowedHosts: ALLOWED_HOSTS })).toEqual({ kind: "allow" });
	});

	it("rejects DNS rebinding attempts via a foreign Host header", () => {
		expect(evaluateHost({ hostHeader: "attacker.example.com:3484", allowedHosts: ALLOWED_HOSTS })).toEqual({
			kind: "reject",
			host: "attacker.example.com:3484",
		});
	});

	it("rejects when the port doesn't match", () => {
		expect(evaluateHost({ hostHeader: "localhost:9999", allowedHosts: ALLOWED_HOSTS })).toEqual({
			kind: "reject",
			host: "localhost:9999",
		});
	});

	it("when wildcard-bound (0.0.0.0), allows any Host header", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const decision = evaluateHost({ hostHeader: "attacker.com:3484", allowedHosts: new Set() });
		expect(decision).toEqual({ kind: "allow" });
	});

	it("when wildcard-bound (::), allows any Host header", () => {
		setKanbanRuntimeHost("::");
		setKanbanRuntimePort(3484);
		const decision = evaluateHost({ hostHeader: "evil.host:3484", allowedHosts: new Set() });
		expect(decision).toEqual({ kind: "allow" });
	});

	it("when wildcard-bound, allows Host header with an external IP", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const decision = evaluateHost({ hostHeader: "192.168.1.3:3484", allowedHosts: new Set() });
		expect(decision).toEqual({ kind: "allow" });
	});
});

describe("handleSocketUpgrade", () => {
	it("passes through upgrades whose Host and Origin are both allowed", () => {
		const socket = new PassThrough();
		const request = makeFakeRequest({ host: "127.0.0.1:3484", origin: ALLOWED_ORIGIN });
		const result = handleSocketUpgrade(request, socket);
		expect(result).toEqual({ end: false });
		expect(socket.destroyed).toBe(false);
	});

	it("rejects upgrades from a disallowed origin with a 403 status line", () => {
		const socket = new PassThrough();
		const written: Buffer[] = [];
		socket.on("data", (chunk) => {
			written.push(chunk as Buffer);
		});
		const request = makeFakeRequest({ host: "127.0.0.1:3484", origin: "http://evil.example.com" });
		const result = handleSocketUpgrade(request, socket);
		expect(result).toEqual({ end: true });
		expect(socket.destroyed).toBe(true);
		expect(Buffer.concat(written).toString("utf8")).toContain("HTTP/1.1 403 Forbidden");
	});

	it("rejects upgrades whose Host header doesn't match the allowlist", () => {
		const socket = new PassThrough();
		const request = makeFakeRequest({ host: "attacker.example.com:3484", origin: ALLOWED_ORIGIN });
		const result = handleSocketUpgrade(request, socket);
		expect(result).toEqual({ end: true });
		expect(socket.destroyed).toBe(true);
	});

	it("rejects upgrades with a missing Host header", () => {
		const socket = new PassThrough();
		const request = makeFakeRequest({});
		const result = handleSocketUpgrade(request, socket);
		expect(result).toEqual({ end: true });
		expect(socket.destroyed).toBe(true);
	});

	it("when wildcard-bound, passes through upgrades from any host and origin", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const socket = new PassThrough();
		const request = makeFakeRequest({ host: "192.168.1.3:3484", origin: "http://192.168.1.3:3484" });
		const result = handleSocketUpgrade(request, socket);
		expect(result).toEqual({ end: false });
		expect(socket.destroyed).toBe(false);
	});
});

describe("getAllowedHostHeaders", () => {
	it("includes localhost entries for default (localhost) binding", () => {
		setKanbanRuntimeHost("127.0.0.1");
		setKanbanRuntimePort(3484);
		const allowed = getAllowedHostHeaders();
		expect(allowed.has("localhost:3484")).toBe(true);
		expect(allowed.has("127.0.0.1:3484")).toBe(true);
	});

	it("includes only the remote host for remote binding", () => {
		setKanbanRuntimeHost("192.168.1.100");
		setKanbanRuntimePort(3484);
		const allowed = getAllowedHostHeaders();
		expect(allowed.has("192.168.1.100:3484")).toBe(true);
		expect(allowed.has("localhost:3484")).toBe(false);
		expect(allowed.has("127.0.0.1:3484")).toBe(false);
	});

	it("returns empty set for wildcard binding", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const allowed = getAllowedHostHeaders();
		expect(allowed.size).toBe(0);
	});
});

describe("evaluateCors (wildcard bound)", () => {
	it("when wildcard-bound, allows any origin", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const decision = evaluateCors({
			method: "GET",
			originHeader: "http://evil.example.com:3484",
			allowedOrigin: "http://0.0.0.0:3484",
		});
		expect(decision).toEqual({ kind: "allow", origin: "http://evil.example.com:3484" });
	});

	it("when wildcard-bound, allows preflight from any origin", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const decision = evaluateCors({
			method: "OPTIONS",
			originHeader: "http://evil.example.com:3484",
			allowedOrigin: "http://0.0.0.0:3484",
		});
		expect(decision).toEqual({ kind: "preflight", origin: "http://evil.example.com:3484" });
	});

	it("when wildcard-bound, allows origin from an external host", () => {
		setKanbanRuntimeHost("0.0.0.0");
		setKanbanRuntimePort(3484);
		const decision = evaluateCors({
			method: "GET",
			originHeader: "http://192.168.1.3:3484",
			allowedOrigin: "http://0.0.0.0:3484",
		});
		expect(decision).toEqual({ kind: "allow", origin: "http://192.168.1.3:3484" });
	});
});
