import type { ITerminalOptions } from "@xterm/xterm";

import type { Theme } from "@/hooks/use-theme";
import { getTerminalThemeColors } from "@/terminal/theme-colors";

interface CreateKanbanTerminalOptionsInput {
	cursorColor: string;
	isMacPlatform: boolean;
	terminalBackgroundColor: string;
	theme: Theme;
}

const TERMINAL_WORD_SEPARATOR = " ()[]{}',\"`";
const TERMINAL_FONT_FAMILY =
	"'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace";

export function createKanbanTerminalOptions({
	cursorColor,
	isMacPlatform,
	terminalBackgroundColor,
	theme,
}: CreateKanbanTerminalOptionsInput): ITerminalOptions {
	const colors = getTerminalThemeColors(theme);

	return {
		allowProposedApi: true,
		allowTransparency: false,
		convertEol: false,
		cursorBlink: true,
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
		scrollback: 10_000,
		smoothScrollDuration: 0,
		theme: {
			background: terminalBackgroundColor,
			cursor: cursorColor,
			cursorAccent: terminalBackgroundColor,
			foreground: colors.textPrimary,
			selectionBackground: colors.selectionBackground,
			selectionForeground: colors.selectionForeground,
			selectionInactiveBackground: colors.selectionInactiveBackground,
		},
		windowOptions: {
			getCellSizePixels: true,
			getWinSizeChars: true,
			getWinSizePixels: true,
		},
		wordSeparator: TERMINAL_WORD_SEPARATOR,
	};
}
