import { describe, expect, it } from "vitest";

import { consumeAg2ChatOutput } from "../../../src/terminal/ag2-chat-stream";

describe("consumeAg2ChatOutput", () => {
	it("parses complete AG2_CHAT lines and leaves other output for the PTY", () => {
		const result = consumeAg2ChatOutput(
			"",
			'hello\nAG2_CHAT {"id":"r1","role":"reasoning","content":"planning","createdAt":1}\nworld\n',
		);

		expect(result.messages).toEqual([
			{
				id: "r1",
				role: "reasoning",
				content: "planning",
				createdAt: 1,
				meta: null,
			},
		]);
		expect(result.passthrough).toBe("hello\nworld\n");
		expect(result.buffer).toBe("");
	});

	it("holds a partial trailing line in the buffer", () => {
		const first = consumeAg2ChatOutput("", 'AG2_CHAT {"id":"a1","role":"assistant","content":"ok"');
		expect(first.messages).toEqual([]);
		expect(first.passthrough).toBe("");

		const second = consumeAg2ChatOutput(first.buffer, ',"createdAt":2}\n');
		expect(second.messages).toEqual([
			{
				id: "a1",
				role: "assistant",
				content: "ok",
				createdAt: 2,
				meta: null,
			},
		]);
		expect(second.buffer).toBe("");
	});

	it("ignores malformed AG2_CHAT payloads", () => {
		const result = consumeAg2ChatOutput("", 'AG2_CHAT {not-json}\nAG2_CHAT {"role":"assistant"}\n');
		expect(result.messages).toEqual([]);
		expect(result.passthrough).toBe("");
	});

	it("drops AG2 CLI banners so the native chat panel is the only UI", () => {
		const result = consumeAg2ChatOutput(
			"",
			"[ag2] start role=supervisor\n[kanban-hook] to_in_progress\n[tool] list_dir .\nkeep this error\n",
		);
		expect(result.passthrough).toBe("keep this error\n");
		expect(result.messages).toEqual([]);
	});
});
