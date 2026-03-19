import { describe, expect, it } from "vitest";

import {
	appendTerminalHeuristicText,
	hasInterruptAcknowledgement,
	hasLikelyShellPrompt,
	sanitizeTerminalHeuristicText,
} from "@/terminal/terminal-prompt-heuristics";

describe("terminal prompt heuristics", () => {
	it("detects common prompt shapes", () => {
		expect(hasLikelyShellPrompt("user@host ~/repo $ ")).toBe(true);
		expect(hasLikelyShellPrompt("PS C:\\Users\\saoud> ")).toBe(true);
		expect(hasLikelyShellPrompt("C:\\Users\\saoud> ")).toBe(true);
		expect(hasLikelyShellPrompt("~/repo ❯ ")).toBe(true);
	});

	it("detects interrupt acknowledgements", () => {
		expect(hasInterruptAcknowledgement("^C")).toBe(true);
		expect(hasInterruptAcknowledgement("KeyboardInterrupt\n")).toBe(true);
		expect(hasInterruptAcknowledgement("terminated\n")).toBe(true);
		expect(hasInterruptAcknowledgement("normal output\n")).toBe(false);
	});

	it("strips ansi sequences before prompt detection", () => {
		const sanitized = sanitizeTerminalHeuristicText("\u001b[32muser@host ~/repo $ \u001b[0m");
		expect(sanitized).toBe("user@host ~/repo $ ");
		expect(hasLikelyShellPrompt(sanitized)).toBe(true);
	});

	it("keeps only the recent tail of heuristic text", () => {
		const largePrefix = "x".repeat(5000);
		const buffer = appendTerminalHeuristicText(largePrefix, "PS C:\\repo> ");
		expect(buffer.length).toBeLessThanOrEqual(4000);
		expect(buffer.endsWith("PS C:\\repo> ")).toBe(true);
	});
});
