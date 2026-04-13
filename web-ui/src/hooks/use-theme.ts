import { useCallback, useSyncExternalStore } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

export type ThemeId =
	| "default"
	| "graphite"
	| "midnight"
	| "pitch"
	| "solarized-dark"
	| "light"
	| "overcast"
	| "solarized-light"
	| "latte"
	| "high-contrast-dark"
	| "high-contrast-light";

export type ThemeGroup = "dark" | "light" | "high-contrast";

export interface ThemeDefinition {
	readonly id: ThemeId;
	readonly label: string;
	readonly group: ThemeGroup;
	/** Primary accent color shown in the theme swatch. */
	readonly accent: string;
	/** Secondary accent color for visual variety. */
	readonly accent2: string;
	/** Darkest surface color shown as the swatch background. */
	readonly surface: string;
	/** Text color to use on top of accent backgrounds (ensures contrast). */
	readonly accentFg: string;
	/** Text color to use on top of accent-2 backgrounds (ensures contrast). */
	readonly accent2Fg: string;
}

export const THEMES: readonly ThemeDefinition[] = [
	/* Dark */
	{
		id: "default",
		label: "Default",
		group: "dark",
		accent: "#0084FF",
		accent2: "#7C5CFF",
		surface: "#1F2428",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "graphite",
		label: "Graphite",
		group: "dark",
		accent: "#D4915C",
		accent2: "#7A8F9C",
		surface: "#1E1E1E",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "midnight",
		label: "Midnight",
		group: "dark",
		accent: "#6366F1",
		accent2: "#EC4899",
		surface: "#121214",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "pitch",
		label: "Pitch",
		group: "dark",
		accent: "#2DD4BF",
		accent2: "#6B7280",
		surface: "#000000",
		accentFg: "#000000",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "solarized-dark",
		label: "Solarized Dark",
		group: "dark",
		accent: "#268BD2",
		accent2: "#2AA198",
		surface: "#002B36",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	/* Light */
	{
		id: "light",
		label: "Light",
		group: "light",
		accent: "#0084FF",
		accent2: "#7C5CFF",
		surface: "#FFFFFF",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "overcast",
		label: "Overcast",
		group: "light",
		accent: "#0D9488",
		accent2: "#D97706",
		surface: "#EEF0F3",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		group: "light",
		accent: "#4A7C96",
		accent2: "#D33682",
		surface: "#FDF6E3",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "latte",
		label: "Latte",
		group: "light",
		accent: "#9C8878",
		accent2: "#7A8F9C",
		surface: "#FFFFFF",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
	/* High contrast */
	{
		id: "high-contrast-dark",
		label: "High Contrast Dark",
		group: "high-contrast",
		accent: "#FFFFFF",
		accent2: "#FF4081",
		surface: "#000000",
		accentFg: "#000000",
		accent2Fg: "#FFFFFF",
	},
	{
		id: "high-contrast-light",
		label: "High Contrast Light",
		group: "high-contrast",
		accent: "#0050A0",
		accent2: "#B91C1C",
		surface: "#FFFFFF",
		accentFg: "#FFFFFF",
		accent2Fg: "#FFFFFF",
	},
] as const;

export const THEME_GROUPS: readonly { key: ThemeGroup; label: string }[] = [
	{ key: "dark", label: "Dark" },
	{ key: "light", label: "Light" },
	{ key: "high-contrast", label: "High Contrast" },
];

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));
const themeStoreListeners = new Set<() => void>();
let storageSyncInstalled = false;
let currentThemeId: ThemeId = readStoredThemeId();

// ---------------------------------------------------------------------------
// Terminal color lookup per theme
// ---------------------------------------------------------------------------

export interface ThemeTerminalColors {
	readonly textPrimary: string;
	readonly surfacePrimary: string;
	readonly surfaceRaised: string;
	readonly selectionBackground: string;
	readonly selectionForeground: string;
	readonly selectionInactiveBackground: string;
	/** Whether the theme has a light background (affects ANSI color palette). */
	readonly isLightBackground: boolean;
}

/** Terminal hex colors keyed by theme id. */
const TERMINAL_COLORS_BY_THEME: Record<ThemeId, ThemeTerminalColors> = {
	default: {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#1F2428",
		surfaceRaised: "#24292E",
		selectionBackground: "#0084FF4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
		isLightBackground: false,
	},
	graphite: {
		textPrimary: "#E0E0E0",
		surfacePrimary: "#1E1E1E",
		surfaceRaised: "#252526",
		selectionBackground: "#D4915C4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D2D2D66",
		isLightBackground: false,
	},
	midnight: {
		textPrimary: "#E4E4E7",
		surfacePrimary: "#121214",
		surfaceRaised: "#18181B",
		selectionBackground: "#6366F14D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#1F1F2366",
		isLightBackground: false,
	},
	pitch: {
		textPrimary: "#E4E4E4",
		surfacePrimary: "#000000",
		surfaceRaised: "#0A0A0A",
		selectionBackground: "#2DD4BF4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#14141466",
		isLightBackground: false,
	},
	"solarized-dark": {
		textPrimary: "#FDF6E3",
		surfacePrimary: "#002B36",
		surfaceRaised: "#073642",
		selectionBackground: "#268BD24D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#0E3E4A66",
		isLightBackground: false,
	},
	light: {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#000000",
		surfaceRaised: "#000000",
		selectionBackground: "#0084FF4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
		isLightBackground: false,
	},
	overcast: {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#000000",
		surfaceRaised: "#000000",
		selectionBackground: "#0D948844",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
		isLightBackground: false,
	},
	"solarized-light": {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#000000",
		surfaceRaised: "#000000",
		selectionBackground: "#4A7C964D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
		isLightBackground: false,
	},
	latte: {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#000000",
		surfaceRaised: "#000000",
		selectionBackground: "#9C887844",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
		isLightBackground: false,
	},
	"high-contrast-dark": {
		textPrimary: "#FFFFFF",
		surfacePrimary: "#000000",
		surfaceRaised: "#0A0A0A",
		selectionBackground: "#FFFFFF4D",
		selectionForeground: "#000000",
		selectionInactiveBackground: "#1A1A1A66",
		isLightBackground: false,
	},
	"high-contrast-light": {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#000000",
		surfaceRaised: "#000000",
		selectionBackground: "#0050A04D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
		isLightBackground: false,
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isThemeId(value: string | null): value is ThemeId {
	return value !== null && THEME_IDS.has(value);
}

function notifyThemeStoreListeners(): void {
	for (const listener of themeStoreListeners) {
		listener();
	}
}

function readThemeSnapshot(): ThemeId {
	return currentThemeId;
}

function subscribeThemeStore(listener: () => void): () => void {
	installStorageSyncListener();
	themeStoreListeners.add(listener);
	return () => {
		themeStoreListeners.delete(listener);
	};
}

function installStorageSyncListener(): void {
	if (storageSyncInstalled || typeof window === "undefined") {
		return;
	}
	storageSyncInstalled = true;
	window.addEventListener("storage", (event) => {
		if (event.key !== null && event.key !== LocalStorageKey.Theme) {
			return;
		}
		const nextThemeId = readStoredThemeId();
		if (nextThemeId === currentThemeId) {
			return;
		}
		currentThemeId = nextThemeId;
		applyThemeToDocument(nextThemeId);
		notifyThemeStoreListeners();
	});
}

function applyThemeChange(themeId: ThemeId): void {
	if (themeId === currentThemeId) {
		return;
	}
	currentThemeId = themeId;
	applyThemeToDocument(themeId);
	notifyThemeStoreListeners();
}

export function readStoredThemeId(): ThemeId {
	const stored = readLocalStorageItem(LocalStorageKey.Theme);
	return isThemeId(stored) ? stored : "default";
}

export function applyThemeToDocument(themeId: ThemeId): void {
	if (typeof document === "undefined") {
		return;
	}
	if (themeId === "default") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", themeId);
	}
}

export function previewThemeId(themeId: ThemeId): void {
	applyThemeChange(themeId);
}

export function saveThemeId(themeId: ThemeId): void {
	writeLocalStorageItem(LocalStorageKey.Theme, themeId);
	applyThemeChange(themeId);
}

/** Get terminal colors for the given theme (or the currently active theme). */
export function getTerminalThemeColors(themeId?: ThemeId): ThemeTerminalColors {
	const id = themeId ?? readThemeSnapshot();
	return TERMINAL_COLORS_BY_THEME[id];
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseThemeResult {
	themeId: ThemeId;
	setThemeId: (id: ThemeId) => void;
}

export function useTheme(): UseThemeResult {
	const themeId = useSyncExternalStore(subscribeThemeStore, readThemeSnapshot, readThemeSnapshot);

	const setThemeId = useCallback((id: ThemeId) => {
		saveThemeId(id);
	}, []);

	return { themeId, setThemeId };
}
