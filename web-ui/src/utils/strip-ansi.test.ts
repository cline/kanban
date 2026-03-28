import { describe, expect, it } from "vitest";

import { stripAnsi } from "@/utils/strip-ansi";

describe("stripAnsi", () => {
	it("returns plain text unchanged", () => {
		expect(stripAnsi("hello world")).toBe("hello world");
	});

	it("strips bold and color CSI sequences", () => {
		// \x1b[1m = bold, \x1b[46m = cyan bg, \x1b[49m = default bg, \x1b[22m = normal intensity
		expect(stripAnsi("\x1b[1m\x1b[46m RUN \x1b[49m\x1b[22m src/app.test.ts")).toBe(" RUN  src/app.test.ts");
	});

	it("strips foreground color codes", () => {
		expect(stripAnsi("\x1b[31mERROR\x1b[39m: something failed")).toBe("ERROR: something failed");
	});

	it("strips dim and yellow sequences", () => {
		expect(stripAnsi("\x1b[2m\x1b[33mwarning\x1b[39m\x1b[22m")).toBe("warning");
	});

	it("strips cyan text sequences", () => {
		expect(stripAnsi("\x1b[36mstdout\x1b[39m | test output")).toBe("stdout | test output");
	});

	it("strips OSC sequences terminated by BEL", () => {
		expect(stripAnsi("\x1b]0;title\x07visible text")).toBe("visible text");
	});

	it("strips OSC sequences terminated by ST", () => {
		expect(stripAnsi("\x1b]0;title\x1b\\visible text")).toBe("visible text");
	});

	it("strips single-character escape sequences", () => {
		// \x1b followed by a character in @-Z range is a two-byte escape; the state machine
		// consumes ESC + the next char and returns to text mode, so the byte after is kept.
		// \x1b(B is ESC ( B — ESC is consumed, ( triggers return to text, B is kept.
		expect(stripAnsi("\x1b(Bhello")).toBe("Bhello");
		// \x1bM (reverse index) — ESC consumed, M consumed (in @-Z range)
		expect(stripAnsi("\x1bMhello")).toBe("hello");
	});

	it("handles empty string", () => {
		expect(stripAnsi("")).toBe("");
	});

	it("handles string with only escape sequences", () => {
		expect(stripAnsi("\x1b[1m\x1b[22m\x1b[31m\x1b[39m")).toBe("");
	});

	it("handles multiline vitest-like output", () => {
		const input = [
			"\x1b[1m\x1b[46m RUN \x1b[49m\x1b[22m src/app.test.ts",
			"\x1b[32m ✓\x1b[39m should work \x1b[2m(5ms)\x1b[22m",
			"",
			"\x1b[1m\x1b[32m Tests \x1b[39m\x1b[22m 1 passed",
		].join("\n");

		const expected = [" RUN  src/app.test.ts", " ✓ should work (5ms)", "", " Tests  1 passed"].join("\n");

		expect(stripAnsi(input)).toBe(expected);
	});
});
