import { Theme } from "@/hooks/use-theme";

export const TERMINAL_THEME_COLORS_DARK = {
	textPrimary: "#E6EDF3",
	surfacePrimary: "#1F2428",
	surfaceRaised: "#24292E",
	selectionBackground: "#0084FF4D",
	selectionForeground: "#ffffff",
	selectionInactiveBackground: "#2D333966",
} as const;

export const TERMINAL_THEME_COLORS_LIGHT = {
	textPrimary: "#1A1A2E",
	surfacePrimary: "#FFFFFF",
	surfaceRaised: "#F6F8FA",
	selectionBackground: "#0084FF4D",
	selectionForeground: "#ffffff",
	selectionInactiveBackground: "#E8ECF066",
} as const;

/**
 * @deprecated Use getTerminalThemeColors() instead. Kept for backward compatibility
 * with existing code that hasn't been migrated to theme-aware colors yet.
 */
export const TERMINAL_THEME_COLORS = TERMINAL_THEME_COLORS_DARK;

export function getTerminalThemeColors(theme: Theme) {
	return theme === Theme.Light ? TERMINAL_THEME_COLORS_LIGHT : TERMINAL_THEME_COLORS_DARK;
}
