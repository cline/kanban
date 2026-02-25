import { describe, expect, it } from "vitest";

import { extractLastActivityLine } from "../../../src/runtime/terminal/output-utils.js";

describe("extractLastActivityLine", () => {
	it("ignores codex input composer rows", () => {
		const buffer = [
			"https://",
			"developers.openai.com/",
			"codex/cli",
			"",
			"› nope i think i have a great idae",
			"  so all these CLIs have",
		].join("\n");
		const preview = extractLastActivityLine(buffer, "codex", 120, 40);
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
		const preview = extractLastActivityLine(buffer, "claude", 120, 40);
		expect(preview).toContain("hi! what can I help you with?");
		expect(preview).not.toContain("❯");
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
		const preview = extractLastActivityLine(buffer, "gemini", 120, 40);
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
		const preview = extractLastActivityLine(buffer, "opencode", 120, 40);
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
		const preview = extractLastActivityLine(buffer, "cline", 120, 40);
		expect(preview).toContain("runtime hook ingest endpoint");
		expect(preview).not.toContain("What can I do for you");
	});
});
