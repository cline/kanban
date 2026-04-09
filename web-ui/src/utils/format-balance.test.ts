import { describe, expect, it } from "vitest";
import { formatBalance } from "./format-balance";

describe("formatBalance", () => {
	it("returns dash for null", () => {
		expect(formatBalance(null)).toBe("—");
	});

	it("returns dash for undefined", () => {
		expect(formatBalance(undefined)).toBe("—");
	});

	it("returns 0.00 for zero", () => {
		expect(formatBalance(0)).toBe("0.00");
	});

	it("converts micro-units to credits (1,000,000 = 1 credit)", () => {
		expect(formatBalance(1_000_000)).toBe("1.00");
	});

	it("converts real-world balance correctly", () => {
		expect(formatBalance(26_617_620)).toBe("26.62");
	});

	it("handles fractional credits", () => {
		expect(formatBalance(1_500_000)).toBe("1.50");
	});

	it("rounds to 2 decimal places", () => {
		expect(formatBalance(999_999)).toBe("1.00");
	});

	it("handles large values", () => {
		expect(formatBalance(10_000_000_000)).toBe("10000.00");
	});

	it("handles negative values", () => {
		expect(formatBalance(-1_000_000)).toBe("-1.00");
	});
});
