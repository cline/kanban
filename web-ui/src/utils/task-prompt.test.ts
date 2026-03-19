import { describe, expect, it } from "vitest";

import { clampTextWithInlineSuffix, splitPromptToTitleDescriptionByWidth, truncateTaskPromptLabel } from "@/utils/task-prompt";

describe("truncateTaskPromptLabel", () => {
	it("normalizes whitespace and truncates when needed", () => {
		expect(truncateTaskPromptLabel("hello\nworld", 20)).toBe("hello world");
		expect(truncateTaskPromptLabel("abcdefghijklmnopqrstuvwxyz", 5)).toBe("abcde…");
	});
});

describe("splitPromptToTitleDescriptionByWidth", () => {
	it("moves single-line overflow into description based on measured width", () => {
		const measured = splitPromptToTitleDescriptionByWidth("1234567890", {
			maxTitleWidthPx: 5,
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({
			title: "12345",
			description: "67890",
		});
	});

	it("prefers a word boundary when truncating", () => {
		const measured = splitPromptToTitleDescriptionByWidth("hello world again", {
			maxTitleWidthPx: 13,
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({
			title: "hello world",
			description: "again",
		});
	});

	it("normalizes multiline prompts before splitting", () => {
		const measured = splitPromptToTitleDescriptionByWidth("abcdefghij\nline two", {
			maxTitleWidthPx: 4,
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({
			title: "abcd",
			description: "efghij line two",
		});
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
