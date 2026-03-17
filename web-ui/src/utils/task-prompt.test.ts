import { describe, expect, it } from "vitest";

import {
	clampTextWithInlineSuffix,
	parseMarkdownTaskPrompts,
	parseTaskListItems,
	splitPromptToTitleDescriptionByWidth,
	truncateTaskPromptLabel,
} from "@/utils/task-prompt";

describe("parseTaskListItems", () => {
	it("extracts numbered list items from prompt text", () => {
		expect(parseTaskListItems("1. First task\n2. Second task")).toEqual(["First task", "Second task"]);
	});

	it("returns an empty list for non-uniform content", () => {
		expect(parseTaskListItems("1. First task\nplain text")).toEqual([]);
	});
});

describe("parseMarkdownTaskPrompts", () => {
	it("imports ordered tasks from execution-like headings", () => {
		const prompts = parseMarkdownTaskPrompts(`# PRD\n\n## Planned work\n1. Build parser\n2. Add tests\n`);
		expect(prompts).toEqual(["Build parser", "Add tests"]);
	});

	it("imports unchecked checklists, strips simple markdown formatting, and appends the source path", () => {
		const prompts = parseMarkdownTaskPrompts(
			`# Strategy\n\n## Scope\n- [x] Finish discovery\n\n## Notes\n- [ ] Review [plan](docs/plan.md) and update \`parser\`\n- [ ] ~~Remove~~ keep _telemetry_ copy\n`,
			{ sourcePath: "docs/strategy.md" },
		);
		expect(prompts).toEqual([
			"Review plan and update parser @docs/strategy.md",
			"Remove keep telemetry copy @docs/strategy.md",
		]);
	});

	it("ignores non-execution bullets, nested items, and fenced code blocks", () => {
		const prompts = parseMarkdownTaskPrompts(`## Risks\n- Do not import this\n\n## Tasks\n- Ship importer\n    - Nested detail\n\n\`\`\`md\n## Tasks\n- Ignore code fence item\n\`\`\`\n`);
		expect(prompts).toEqual(["Ship importer"]);
	});

	it("deduplicates repeated normalized prompts", () => {
		const prompts = parseMarkdownTaskPrompts(`## Tasks\n- Build parser\n- **Build parser**\n- Add tests\n`);
		expect(prompts).toEqual(["Build parser", "Add tests"]);
	});

	it("preserves filenames and snake_case identifiers while unwrapping markdown emphasis", () => {
		const prompts = parseMarkdownTaskPrompts(`## Tasks\n- Update task_prompt.ts and _keep_ build_metadata intact\n`);
		expect(prompts).toEqual(["Update task_prompt.ts and keep build_metadata intact"]);
	});
});

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
