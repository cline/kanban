import { afterEach, describe, expect, it, vi } from "vitest";

import { isLocalhostAccess } from "@/utils/localhost-detection";

function setHostname(hostname: string): void {
	Object.defineProperty(window, "location", {
		value: { hostname },
		writable: true,
		configurable: true,
	});
}

describe("isLocalhostAccess", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns true for 'localhost'", () => {
		setHostname("localhost");
		expect(isLocalhostAccess()).toBe(true);
	});

	it("returns true for '127.0.0.1'", () => {
		setHostname("127.0.0.1");
		expect(isLocalhostAccess()).toBe(true);
	});

	it("returns true for '::1' (IPv6 loopback)", () => {
		setHostname("::1");
		expect(isLocalhostAccess()).toBe(true);
	});

	it("returns false for a remote hostname", () => {
		setHostname("my-server.example.com");
		expect(isLocalhostAccess()).toBe(false);
	});

	it("returns false for a LAN IP address", () => {
		setHostname("192.168.1.100");
		expect(isLocalhostAccess()).toBe(false);
	});

	it("returns false when window is undefined", () => {
		const original = globalThis.window;
		// @ts-expect-error — intentionally removing window for SSR simulation
		delete globalThis.window;
		expect(isLocalhostAccess()).toBe(false);
		globalThis.window = original;
	});
});
