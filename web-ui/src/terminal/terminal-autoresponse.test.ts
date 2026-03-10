import { describe, expect, it } from "vitest";

import { isTerminalDeviceAttributesResponse } from "@/terminal/terminal-autoresponse";

describe("isTerminalDeviceAttributesResponse", () => {
	it("matches primary and secondary DA responses", () => {
		expect(isTerminalDeviceAttributesResponse("\u001b[?1;2c")).toBe(true);
		expect(isTerminalDeviceAttributesResponse("\u001b[>0;10;1c")).toBe(true);
	});

	it("rejects normal user input", () => {
		expect(isTerminalDeviceAttributesResponse("hello")).toBe(false);
		expect(isTerminalDeviceAttributesResponse("1;2c")).toBe(false);
		expect(isTerminalDeviceAttributesResponse("> read a random file")).toBe(false);
	});
});
