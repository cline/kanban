import { describe, expect, it } from "vitest";

import {
	DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS,
	splitPromptToTitleDescription,
	splitPromptToTitleDescriptionByWidth,
} from "@/kanban/utils/task-prompt";

describe("splitPromptToTitleDescription", () => {
	it("uses the first line as title and keeps remaining lines as description", () => {
		expect(splitPromptToTitleDescription("title\nline one\nline two")).toEqual({
			title: "title",
			description: "line one\nline two",
		});
	});

	it("returns empty values for empty prompt", () => {
		expect(splitPromptToTitleDescription("   ")).toEqual({
			title: "",
			description: "",
		});
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

	it("keeps existing multiline description while adding first-line overflow", () => {
		const measured = splitPromptToTitleDescriptionByWidth("abcdefghij\nline two", {
			maxTitleWidthPx: 4,
			measureText: (value) => value.length,
		});
		expect(measured).toEqual({
			title: "abcd",
			description: "efghij\n\nline two",
		});
	});
});

describe("DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS", () => {
	it("still includes known disallowed slash commands", () => {
		expect(DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS).toContain("plan");
		expect(DISALLOWED_TASK_KICKOFF_SLASH_COMMANDS).toContain("mcp");
	});
});
