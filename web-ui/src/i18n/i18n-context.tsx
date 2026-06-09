import type { ReactElement, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";
import {
	type AppLanguage,
	DEFAULT_LANGUAGE,
	isAppLanguage,
	type TranslationKey,
	type TranslationValues,
	translate,
} from "./translations";

interface I18nContextValue {
	language: AppLanguage;
	setLanguage: (language: AppLanguage) => void;
	t: (key: TranslationKey, values?: TranslationValues) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const fallbackI18nContextValue: I18nContextValue = {
	language: DEFAULT_LANGUAGE,
	setLanguage: () => {},
	t: (key, values) => translate(DEFAULT_LANGUAGE, key, values),
};

function readStoredLanguage(): AppLanguage {
	const storedLanguage = readLocalStorageItem(LocalStorageKey.Language);
	return isAppLanguage(storedLanguage) ? storedLanguage : DEFAULT_LANGUAGE;
}

export function I18nProvider({ children }: { children: ReactNode }): ReactElement {
	const [language, setLanguageState] = useState<AppLanguage>(readStoredLanguage);

	useEffect(() => {
		document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
		writeLocalStorageItem(LocalStorageKey.Language, language);
	}, [language]);

	const setLanguage = useCallback((nextLanguage: AppLanguage) => {
		setLanguageState(nextLanguage);
	}, []);

	const t = useCallback(
		(key: TranslationKey, values?: TranslationValues) => translate(language, key, values),
		[language],
	);

	const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const value = useContext(I18nContext);
	return value ?? fallbackI18nContextValue;
}
