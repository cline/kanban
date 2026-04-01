// ── Persist and restore layout state to/from localStorage ──

import { useEffect, useRef } from "react";
import type { LayoutState } from "./layoutTypes";

const DEFAULT_STORAGE_KEY = "dynamic-panels-layout";
const DEBOUNCE_MS = 500;

/** Save layout state to localStorage (debounced). */
export function usePersistLayout(state: LayoutState, storageKey?: string): void {
	const key = storageKey ?? DEFAULT_STORAGE_KEY;
	const timerRef = useRef<ReturnType<typeof setTimeout>>();

	useEffect(() => {
		clearTimeout(timerRef.current);
		timerRef.current = setTimeout(() => {
			try {
				localStorage.setItem(key, JSON.stringify(state));
			} catch {
				// Storage full or unavailable — silently ignore
			}
		}, DEBOUNCE_MS);

		return () => clearTimeout(timerRef.current);
	}, [state, key]);
}

/** Load a previously persisted layout, or return null if none/invalid. */
export function loadPersistedLayout(storageKey?: string): LayoutState | null {
	const key = storageKey ?? DEFAULT_STORAGE_KEY;
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LayoutState;
		if (parsed && typeof parsed === "object" && "root" in parsed && parsed.root?.type) {
			return parsed;
		}
	} catch {
		// Corrupt data — ignore
	}
	return null;
}

/** Clear persisted layout. */
export function clearPersistedLayout(storageKey?: string): void {
	localStorage.removeItem(storageKey ?? DEFAULT_STORAGE_KEY);
}
