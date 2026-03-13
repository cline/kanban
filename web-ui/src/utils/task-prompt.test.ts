import { describe, expect, it } from "vitest";

import { splitPromptToTitleDescriptionByWidth, truncateTaskPromptLabel } from "@/utils/task-prompt";

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
