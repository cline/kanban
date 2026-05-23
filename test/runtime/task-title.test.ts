import { describe, expect, it } from "vitest";

import { deriveTaskTitleFromPrompt, resolveTaskTitle } from "../../src/core/task-title.js";

describe("task title helpers", () => {
	it("derives a title from the first non-empty prompt line", () => {
		expect(deriveTaskTitleFromPrompt("\n\nImplement editable task titles\nWith prompt details")).toBe(
			"Implement editable task titles",
		);
	});

	it("prefers the first sentence on the first non-empty line", () => {
		expect(deriveTaskTitleFromPrompt("Implement editable task titles. Also add a regenerate button.")).toBe(
			"Implement editable task titles.",
		);
	});

	it("prefers an explicit title when present", () => {
		expect(resolveTaskTitle("  Custom title  ", "Prompt body")).toBe("Custom title");
	});

	it("strips user_input wrapper tags from an explicit stored title", () => {
		expect(resolveTaskTitle('<user_input mode="act">Fix the login bug</user_input>', "Prompt body")).toBe(
			"Fix the login bug",
		);
	});

	it("strips a leading user_input tag from an explicit stored title", () => {
		expect(resolveTaskTitle('<user_input mode="act">Fix the login bug', "Prompt body")).toBe("Fix the login bug");
	});

	it("falls back to the prompt when explicit title only contains user_input wrapper tags", () => {
		expect(resolveTaskTitle('<user_input mode="act"></user_input>', "Prompt body")).toBe("Prompt body");
	});

	it("falls back to the prompt when the title is blank", () => {
		expect(resolveTaskTitle("   ", "Prompt body")).toBe("Prompt body");
	});

	it("does not alter explicit titles that contain XML-like text in the middle", () => {
		expect(resolveTaskTitle("Investigate React <Component> rendering", "Prompt body")).toBe(
			"Investigate React <Component> rendering",
		);
	});

	it("strips a leading XML tag when deriving from a prompt", () => {
		expect(deriveTaskTitleFromPrompt('<user_input mode="act">Fix the login bug\nWith extra details')).toBe(
			"Fix the login bug",
		);
	});

	it("strips both leading and trailing XML tags on a single-line prompt", () => {
		expect(deriveTaskTitleFromPrompt('<user_input mode="act">Fix the login bug</user_input>')).toBe(
			"Fix the login bug",
		);
	});

	it("handles a prompt that is only an XML tag", () => {
		expect(deriveTaskTitleFromPrompt("<user_input>")).toBe("");
	});
});
