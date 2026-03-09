import { describe, expect, it } from "vitest";

import { createActivityPreviewTracker } from "../../../src/terminal/activity-preview.js";

function extractPreviewFromBuffer(
	buffer: string,
	agentId: "codex" | "claude" | "gemini" | "opencode" | "cline" | null,
): string | null {
	const tracker = createActivityPreviewTracker(120, 40);
	tracker.append(buffer);
	return tracker.extract(agentId);
}

describe("activity preview tracker", () => {
	it("ignores codex input composer rows", () => {
		const buffer = [
			"https://",
			"developers.openai.com/",
			"codex/cli",
			"",
			"› nope i think i have a great idae",
			"  so all these CLIs have",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "codex");
		expect(preview).toContain("codex/cli");
		expect(preview).not.toContain("nope i think");
	});

	it("ignores claude prompt rows", () => {
		const buffer = [
			"⏺ hi! what can I help you with?",
			"",
			"──────────────────────────── ↯ ─",
			"❯",
			"────────────────────────────────",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "claude");
		expect(preview).toContain("hi! what can I help you with?");
		expect(preview).not.toContain("❯");
	});

	it("ignores newer claude composer chrome rows", () => {
		const buffer = [
			"Finished refactoring the preview renderer.",
			"",
			"──────────────────────────────────────────────────────── ▪▪▪ · ↯ ─",
			"❯",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "claude");
		expect(preview).toContain("Finished refactoring the preview renderer.");
		expect(preview).not.toContain("▪▪▪");
		expect(preview).not.toContain("❯");
	});

	it("ignores claude composer rows when footer status lines follow the prompt", () => {
		const buffer = [
			"⏺ Here's Panels.tsx - a tabbed panel component for a VS Code-style UI library.",
			"  optional controlled activeTab prop, and renders Tab + View sub-components.",
			"",
			"──────────────────────────────────────────────────────── ▪▪▪ · ↯ ─",
			"❯  ",
			"──────────────────────────────────────────────────────────────────",
			"  vscrui () | Opus 4.6 (1M context) ████████ (23154) | $0.7101",
			"  ⏵⏵ bypass permissions on (shift+tab to cycle)",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "claude");
		expect(preview).toContain("Here's Panels.tsx");
		expect(preview).not.toContain("▪▪▪");
		expect(preview).not.toContain("vscrui ()");
		expect(preview).not.toContain("bypass permissions");
	});

	it("ignores gemini composer rows", () => {
		const buffer = [
			"help you with any specific",
			"Directive or Inquiry you have",
			"in mind.",
			"",
			" ? for shortcuts",
			"────────────────────────────────",
			" >   Type your message or",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "gemini");
		expect(preview).toContain("Directive or Inquiry");
		expect(preview).not.toContain("Type your message");
	});

	it("ignores opencode composer rows", () => {
		const buffer = [
			"Ran tests and fixed three failures in parser.ts",
			"",
			'┃  Ask anything... "Fix broken tests"',
			"ctrl+t variants  tab agents  ctrl+p commands",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "opencode");
		expect(preview).toContain("Ran tests and fixed");
		expect(preview).not.toContain("Ask anything");
	});

	it("ignores cline composer rows", () => {
		const buffer = [
			"Implemented the runtime hook ingest endpoint and tests.",
			"",
			"What can I do for you?",
			"/ for commands · @ for files",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "cline");
		expect(preview).toContain("runtime hook ingest endpoint");
		expect(preview).not.toContain("What can I do for you");
	});

	it("uses the latest cline task output instead of the startup logo", () => {
		const buffer = [
			"                    @@                ",
			"                  @@@@@@              ",
			"             @@@@@@@@@@@@@@@@         ",
			"           @@@@@@@@@@@@@@@@@@@@       ",
			"          @@@@@@@@@@@@@@@@@@@@@@      ",
			"          @@@@@    @@@@    @@@@@      ",
			"        @@@@@@     *@@@     @@@@@@    ",
			"        @@@@@@     *@@@     @@@@@@    ",
			"          @@@@@    @@@@.   @@@@@      ",
			"          @@@@@@@@@@@@@@@@@@@@@@      ",
			"           @@@@@@@@@@@@@@@@@@@@       ",
			"             @@@@@@@@@@@@@@@@.        ",
			"",
			"         What can I do for you?",
			"",
			"  > hi ",
			"",
			" ⏺ Hi there! How can I help you today?",
			"",
			" ⏺ Task completed",
			"   Hello! I'm Cline, your AI software engineer assistant.",
			"   I'm ready to help you with coding, file management,",
			"   system operations, or any other technical tasks.",
			"   Just let me know what you'd like to work on!",
			"",
			"  Start New Task (1)       Exit (2)      ",
			"╭───────────────────────────────────────╮",
			"│                                       │",
			"╰───────────────────────────────────────╯",
			" / for commands · @   ○ Plan ● Act (Tab)",
			" for files",
			" anthropic/claude-sonnet-4.6 ████████",
			" (7,794) | $0.031",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, "cline");
		expect(preview).toContain("I'm ready to help you with coding");
		expect(preview).toContain("system operations");
		expect(preview).not.toContain("What can I do for you");
		expect(preview).not.toContain("@@@@@");
		expect(preview).not.toContain("Start New Task");
	});

	it("strips empty lines and preserves multiple activity lines", () => {
		const buffer = [
			"first meaningful line",
			"",
			"  ",
			"second meaningful line",
			"",
			"\t",
			"third meaningful line",
		].join("\n");
		const preview = extractPreviewFromBuffer(buffer, null);
		expect(preview).toBe("first meaningful line\nsecond meaningful line\nthird meaningful line");
	});

	it("limits preview to the most recent five non-empty lines", () => {
		const buffer = ["line 1", "line 2", "line 3", "line 4", "line 5", "line 6"].join("\n");
		const preview = extractPreviewFromBuffer(buffer, null);
		expect(preview).toBe("line 2\nline 3\nline 4\nline 5\nline 6");
	});

	it("uses the latest appended screen state", () => {
		const tracker = createActivityPreviewTracker(120, 40);
		tracker.append("first line\nsecond line");
		expect(tracker.extract(null)).toBe("first line\nsecond line");
		tracker.append("\u001b[2J\u001b[Hfresh line");
		expect(tracker.extract(null)).toBe("fresh line");
	});
});
