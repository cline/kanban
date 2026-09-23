import { describe, expect, it } from "vitest";

import {
	clampTextWithInlineSuffix,
	getTaskPromptDescription,
	normalizePromptForDisplay,
	truncateTaskPromptLabel,
} from "@/utils/task-prompt";

describe("truncateTaskPromptLabel", () => {
	it("normalizes whitespace and truncates when needed", () => {
		expect(truncateTaskPromptLabel("hello\nworld", 20)).toBe("hello world");
		expect(truncateTaskPromptLabel("abcdefghijklmnopqrstuvwxyz", 5)).toBe("abcde…");
	});
});

describe("normalizePromptForDisplay", () => {
	it("collapses whitespace and trims", () => {
		expect(normalizePromptForDisplay("  hello\n\tworld  ")).toBe("hello world");
	});
});

describe("getTaskPromptDescription", () => {
	it("returns the suffix after a leading title", () => {
		expect(getTaskPromptDescription("Fix bugs: update tests", "Fix bugs")).toBe("update tests");
	});

	it("returns empty when prompt equals title", () => {
		expect(getTaskPromptDescription("Fix bugs", "Fix bugs")).toBe("");
	});

	it("strips XML wrapper tags from the prompt before comparing with the title", () => {
		expect(getTaskPromptDescription('<user_input mode="act">Fix the bug</user_input>', "Fix the bug")).toBe("");
	});
});

describe("clampTextWithInlineSuffix", () => {
	it.each([3, 10])("bounds text measurement for a large log with a %i-line preview", (maxLines) => {
		const prompt = "2026-09-20 INFO worker completed request successfully elapsed=12ms\n".repeat(1600);
		let measuredChars = 0;
		let longestMeasurement = 0;
		const measured = clampTextWithInlineSuffix(prompt, {
			maxWidthPx: 280,
			maxLines,
			suffix: "… See more",
			measureText: (value) => {
				measuredChars += value.length;
				longestMeasurement = Math.max(longestMeasurement, value.length);
				return value.length * 7;
			},
		});

		expect(measured.isTruncated).toBe(true);
		expect(measured.text.length).toBeLessThan(maxLines * 40);
		expect(normalizePromptForDisplay(prompt).startsWith(measured.text)).toBe(true);
		// Guard the expensive work, rather than relying on machine-dependent timing.
		expect(longestMeasurement).toBeLessThanOrEqual(64);
		expect(measuredChars).toBeLessThan(100_000);
	});

	it("wraps long text without spaces and reserves room for the suffix", () => {
		const measured = clampTextWithInlineSuffix("运行日志".repeat(10_000), {
			maxWidthPx: 20,
			maxLines: 3,
			suffix: "… More",
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({ text: `${"运行日志".repeat(13)}运行`, isTruncated: true });
	});

	it("retains text that exactly fills the line budget", () => {
		expect(
			clampTextWithInlineSuffix("abcdefghijkl", {
				maxWidthPx: 4,
				maxLines: 3,
				suffix: "…",
				measureText: (value) => value.length,
			}),
		).toEqual({ text: "abcdefghijkl", isTruncated: false });
	});

	it("makes progress when a single character is wider than the available width", () => {
		expect(
			clampTextWithInlineSuffix("abcd", {
				maxWidthPx: 1,
				maxLines: 3,
				suffix: "…",
				measureText: (value) => value.length * 10,
			}),
		).toEqual({ text: "ab", isTruncated: true });
	});

	it("returns the full text when it fits within the available lines", () => {
		const measured = clampTextWithInlineSuffix("short description", {
			maxWidthPx: 20,
			maxLines: 3,
			suffix: "… See more",
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({
			text: "short description",
			isTruncated: false,
		});
	});

	it("truncates text to leave room for the inline suffix", () => {
		const measured = clampTextWithInlineSuffix(
			"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron",
			{
				maxWidthPx: 18,
				maxLines: 3,
				suffix: "… See more",
				measureText: (value) => value.length,
			},
		);
		expect(measured).toEqual({
			text: "alpha beta gamma delta epsilon zeta",
			isTruncated: true,
		});
	});
});
