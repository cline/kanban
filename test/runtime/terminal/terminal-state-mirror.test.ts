import { afterEach, describe, expect, it, vi } from "vitest";

import { TerminalStateMirror } from "../../../src/terminal/terminal-state-mirror";

const mirrors: TerminalStateMirror[] = [];

function createMirror(cols = 80, rows = 24): TerminalStateMirror {
	const mirror = new TerminalStateMirror(cols, rows);
	mirrors.push(mirror);
	return mirror;
}

afterEach(() => {
	while (mirrors.length > 0) {
		mirrors.pop()?.dispose();
	}
});

describe("TerminalStateMirror", () => {
	it("serializes inline terminal content and dimensions", async () => {
		const mirror = createMirror(100, 30);

		mirror.applyOutput(Buffer.from("hello\r\nworld", "utf8"));

		const snapshot = await mirror.getSnapshot();

		expect(snapshot.cols).toBe(100);
		expect(snapshot.rows).toBe(30);
		expect(snapshot.snapshot).toContain("hello");
		expect(snapshot.snapshot).toContain("world");
	});

	it("preserves alternate-screen state when the active buffer is alternate", async () => {
		const mirror = createMirror();

		mirror.applyOutput(Buffer.from("\u001b[?1049h\u001b[Hfullscreen", "utf8"));

		const snapshot = await mirror.getSnapshot();

		expect(snapshot.snapshot).toContain("\u001b[?1049h");
		expect(snapshot.snapshot).toContain("fullscreen");
	});

	it("returns current visible terminal text", async () => {
		const mirror = createMirror(20, 3);

		mirror.applyOutput(Buffer.from("line 1\r\nStarting MCP servers (1/1)\r\n› ", "utf8"));

		const visibleText = await mirror.getVisibleText();

		expect(visibleText).toContain("Starting MCP servers");
		expect(visibleText).toContain("›");
	});

	it("applies queued resizes before generating a snapshot", async () => {
		const mirror = createMirror(80, 24);

		mirror.applyOutput(Buffer.from("before resize", "utf8"));
		mirror.resize(120, 40);
		mirror.applyOutput(Buffer.from("\r\nafter resize", "utf8"));

		const snapshot = await mirror.getSnapshot();

		expect(snapshot.cols).toBe(120);
		expect(snapshot.rows).toBe(40);
		expect(snapshot.snapshot).toContain("after resize");
	});

	it("emits terminal query responses through the optional callback", async () => {
		const onInputResponse = vi.fn();
		const mirror = new TerminalStateMirror(80, 24, {
			onInputResponse,
		});
		mirrors.push(mirror);

		mirror.applyOutput(Buffer.from("\u001b[6n", "utf8"));
		await mirror.getSnapshot();

		expect(onInputResponse).toHaveBeenCalledWith("\u001b[1;1R");
	});
});
