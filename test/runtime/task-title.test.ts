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

	it("falls back to the prompt when the title is blank", () => {
		expect(resolveTaskTitle("   ", "Prompt body")).toBe("Prompt body");
	});
});
