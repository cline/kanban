import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

export enum Theme {
	Dark = "dark",
	Light = "light",
}

const THEME_STORAGE_KEY = "kanban-theme";

function getSystemPreference(): Theme {
	return window.matchMedia("(prefers-color-scheme: light)").matches ? Theme.Light : Theme.Dark;
}

function getStoredTheme(): Theme | null {
	const stored = localStorage.getItem(THEME_STORAGE_KEY);
	if (stored === Theme.Dark || stored === Theme.Light) return stored as Theme;
	return null;
}

function applyTheme(theme: Theme) {
	if (theme === Theme.Light) {
		document.documentElement.setAttribute("data-theme", "light");
	} else {
		document.documentElement.removeAttribute("data-theme");
	}
}

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
	const [theme, setThemeState] = useState<Theme>(() => {
		return getStoredTheme() ?? getSystemPreference();
	});

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	// Track system preference changes
	useEffect(() => {
		const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
		const handler = () => {
			if (!getStoredTheme()) {
				setThemeState(getSystemPreference());
			}
		};
		mediaQuery.addEventListener("change", handler);
		return () => mediaQuery.removeEventListener("change", handler);
	}, []);

	const setTheme = useCallback((newTheme: Theme) => {
		localStorage.setItem(THEME_STORAGE_KEY, newTheme);
		setThemeState(newTheme);
	}, []);

	const toggleTheme = useCallback(() => {
		setThemeState((current) => {
			const next = current === Theme.Dark ? Theme.Light : Theme.Dark;
			localStorage.setItem(THEME_STORAGE_KEY, next);
			return next;
		});
	}, []);

	const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within a ThemeProvider");
	}
	return context;
}
