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
