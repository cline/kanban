import { useMemo } from "react";

import { getTerminalThemeColors, type ThemeTerminalColors, useTheme } from "@/hooks/use-theme";

/** Static default terminal colors — preserved for backward compatibility and tests. */
export const TERMINAL_THEME_COLORS = {
	textPrimary: "#E6EDF3",
	surfacePrimary: "#1F2428",
	surfaceRaised: "#24292E",
	selectionBackground: "#0084FF4D",
	selectionForeground: "#ffffff",
	selectionInactiveBackground: "#2D333966",
} as const;

/** React hook that returns terminal colors matching the active theme. */
export function useTerminalThemeColors(): ThemeTerminalColors {
	const { themeId } = useTheme();
	return useMemo(() => getTerminalThemeColors(themeId), [themeId]);
}
