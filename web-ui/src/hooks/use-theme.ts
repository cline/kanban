import { useCallback, useSyncExternalStore } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

export type ThemeId =
	| "default"
	| "midnight"
	| "forest"
	| "sunset"
	| "ocean"
	| "rose"
	| "lavender"
	| "slate"
	| "ember"
	| "nord";

export interface ThemeDefinition {
	readonly id: ThemeId;
	readonly label: string;
	/** Accent color shown in the theme swatch. */
	readonly accent: string;
	/** Darkest surface color shown as the swatch background. */
	readonly surface: string;
}

export const THEMES: readonly ThemeDefinition[] = [
	{ id: "default", label: "Default", accent: "#0084FF", surface: "#1F2428" },
	{ id: "midnight", label: "Midnight", accent: "#7C8AFF", surface: "#181B2E" },
	{ id: "forest", label: "Forest", accent: "#5DB85D", surface: "#1A2418" },
	{ id: "sunset", label: "Sunset", accent: "#E8943A", surface: "#261E18" },
	{ id: "ocean", label: "Ocean", accent: "#34B5C8", surface: "#162028" },
	{ id: "rose", label: "Rosé", accent: "#E05A8A", surface: "#261A22" },
	{ id: "lavender", label: "Lavender", accent: "#A07CDB", surface: "#201C28" },
	{ id: "slate", label: "Slate", accent: "#6094C0", surface: "#1C2028" },
	{ id: "ember", label: "Ember", accent: "#D05A4A", surface: "#261C1A" },
	{ id: "nord", label: "Nord", accent: "#88C0D0", surface: "#2E3440" },
] as const;

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
	},
	midnight: {
		textPrimary: "#E0E4F0",
		surfacePrimary: "#181B2E",
		surfaceRaised: "#1E2140",
		selectionBackground: "#7C8AFF4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#272B4A66",
	},
	forest: {
		textPrimary: "#DCE8D8",
		surfacePrimary: "#1A2418",
		surfaceRaised: "#1F2E1C",
		selectionBackground: "#5DB85D4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#26382366",
	},
	sunset: {
		textPrimary: "#F0E4D8",
		surfacePrimary: "#261E18",
		surfaceRaised: "#30251C",
		selectionBackground: "#E8943A4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#3A2E2266",
	},
	ocean: {
		textPrimary: "#D8ECF0",
		surfacePrimary: "#162028",
		surfaceRaised: "#1B2830",
		selectionBackground: "#34B5C84D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#22323A66",
	},
	rose: {
		textPrimary: "#F0DCE6",
		surfacePrimary: "#261A22",
		surfaceRaised: "#30202A",
		selectionBackground: "#E05A8A4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#3A283466",
	},
	lavender: {
		textPrimary: "#E6E0F0",
		surfacePrimary: "#201C28",
		surfaceRaised: "#282330",
		selectionBackground: "#A07CDB4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#312C3A66",
	},
	slate: {
		textPrimary: "#E0E6F0",
		surfacePrimary: "#1C2028",
		surfaceRaised: "#222830",
		selectionBackground: "#6094C04D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2A313A66",
	},
	ember: {
		textPrimary: "#F0DCD8",
		surfacePrimary: "#261C1A",
		surfaceRaised: "#302220",
		selectionBackground: "#D05A4A4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#3A2A2866",
	},
	nord: {
		textPrimary: "#ECEFF4",
		surfacePrimary: "#2E3440",
		surfaceRaised: "#3B4252",
		selectionBackground: "#88C0D04D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#434C5E66",
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
