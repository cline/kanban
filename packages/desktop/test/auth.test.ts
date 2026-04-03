import { describe, expect, it } from "vitest";
import { generateAuthToken } from "../src/auth.js";

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
