import { describe, expect, it } from "vitest";

import { getToolSummary, parseToolMessageContent } from "@/components/detail-panels/cline-chat-message-utils";
import { getClineToolCallDisplay } from "@runtime-cline-tool-call-display";

describe("parseToolMessageContent", () => {
	it("parses tool name input output and duration", () => {
		const parsed = parseToolMessageContent(
			[
				"Tool: Read",
				"Input:",
				'{"file":"src/index.ts"}',
				"Output:",
				'{"ok":true}',
				"Duration: 21ms",
			].join("\n"),
		);

		expect(parsed.toolName).toBe("Read");
		expect(parsed.input).toBe('{"file":"src/index.ts"}');
		expect(parsed.output).toBe('{"ok":true}');
		expect(parsed.error).toBeNull();
		expect(parsed.durationMs).toBe(21);
	});

	it("parses tool errors", () => {
		const parsed = parseToolMessageContent(
			[
				"Tool: Execute",
				"Input:",
				"npm run test",
				"Error:",
				"Command failed",
			].join("\n"),
		);

		expect(parsed.toolName).toBe("Execute");
		expect(parsed.input).toBe("npm run test");
		expect(parsed.output).toBeNull();
		expect(parsed.error).toBe("Command failed");
		expect(parsed.durationMs).toBeNull();
	});
});

describe("getToolSummary", () => {
	it("parses structured tool calls through the shared runtime helper", () => {
		expect(
			getClineToolCallDisplay("fetch_web_content", {
				requests: [{ url: "https://example.com/a" }, { url: "https://example.com/b" }],
			}),
		).toEqual({
			toolName: "fetch_web_content",
			inputSummary: "https://example.com/a (+1 more)",
		});
	});
	it("shows the full read_files path list from object input", () => {
		expect(
			getToolSummary(
				"read_files",
				JSON.stringify({
					file_paths: ["/tmp/a.ts", "/tmp/b.ts"],
				}),
			),
		).toBe("/tmp/a.ts, /tmp/b.ts");
	});

	it("shows the full readfiles path list from top level array input", () => {
		expect(getToolSummary("readfiles", JSON.stringify(["/tmp/a.ts", "/tmp/b.ts"]))).toBe(
			"/tmp/a.ts, /tmp/b.ts",
		);
	});
});
