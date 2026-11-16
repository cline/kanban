import type { ITerminalOptions } from "@xterm/xterm";

import type { ThemeTerminalColors } from "@/hooks/use-theme";

interface CreateKanbanTerminalOptionsInput {
	cursorColor: string;
	isMacPlatform: boolean;
	terminalBackgroundColor: string;
	themeColors: ThemeTerminalColors;
}

const TERMINAL_WORD_SEPARATOR = " ()[]{}',\"`";
const TERMINAL_FONT_FAMILY =
	"'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace";

/**
 * Browser display cap for the last 1,000 lines.
 *
 * This is the room the client needs to hold a full 1k restore snapshot.
 * It is not a second restore-size cap, and it does not have to match the
 * server buffer in order to shrink the payload. Restore is a cached full
 * serialize applied in 16 KiB writes; warm reconnects can skip reset.
 */
const TERMINAL_SCROLLBACK = 1_000;

export function createKanbanTerminalOptions({
	cursorColor,
	isMacPlatform,
	terminalBackgroundColor,
	themeColors,
}: CreateKanbanTerminalOptionsInput): ITerminalOptions {
	return {
		allowProposedApi: true,
		allowTransparency: false,
		convertEol: false,
		cursorBlink: false,
		cursorInactiveStyle: "outline",
		cursorStyle: "block",
		disableStdin: false,
		fontFamily: TERMINAL_FONT_FAMILY,
		fontSize: 13,
		fontWeight: "normal",
		fontWeightBold: "bold",
		letterSpacing: 0,
		lineHeight: 1,
		macOptionClickForcesSelection: isMacPlatform,
		macOptionIsMeta: isMacPlatform,
		rightClickSelectsWord: false,
		scrollOnEraseInDisplay: true,
		scrollOnUserInput: true,
		scrollback: TERMINAL_SCROLLBACK,
		smoothScrollDuration: 0,
		theme: {
			background: terminalBackgroundColor,
			cursor: cursorColor,
			cursorAccent: terminalBackgroundColor,
			foreground: themeColors.textPrimary,
			selectionBackground: themeColors.selectionBackground,
			selectionForeground: themeColors.selectionForeground,
			selectionInactiveBackground: themeColors.selectionInactiveBackground,
		},
		windowOptions: {
			getCellSizePixels: true,
			getWinSizeChars: true,
			getWinSizePixels: true,
		},
		wordSeparator: TERMINAL_WORD_SEPARATOR,
	};
}
