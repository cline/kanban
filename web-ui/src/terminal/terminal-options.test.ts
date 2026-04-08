import { describe, expect, it } from "vitest";

import { getTerminalThemeColors } from "@/hooks/use-theme";
import { createKanbanTerminalOptions } from "@/terminal/terminal-options";

describe("createKanbanTerminalOptions", () => {
	it("enables richer terminal capability reporting", () => {
		const options = createKanbanTerminalOptions({
			cursorColor: "#abcdef",
			isMacPlatform: true,
			terminalBackgroundColor: "#101112",
			themeColors: getTerminalThemeColors("default"),
		});

		expect(options.allowProposedApi).toBe(true);
		expect(options.cursorBlink).toBe(false);
		expect(options.cursorInactiveStyle).toBe("outline");
		expect(options.cursorStyle).toBe("block");
		expect(options.scrollback).toBe(10_000);
		expect(options.macOptionIsMeta).toBe(true);
		expect(options.windowOptions).toEqual({
			getCellSizePixels: true,
			getWinSizeChars: true,
			getWinSizePixels: true,
		});
		expect(options.theme?.background).toBe("#101112");
		expect(options.theme?.cursor).toBe("#abcdef");
	});
});
