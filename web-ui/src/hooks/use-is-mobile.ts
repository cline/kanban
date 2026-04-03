import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = "(max-width: 768px)";

function subscribe(callback: () => void): () => void {
	const mql = window.matchMedia(MOBILE_BREAKPOINT);
	mql.addEventListener("change", callback);
	return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
	return window.matchMedia(MOBILE_BREAKPOINT).matches;
}

function getServerSnapshot(): boolean {
	return false;
}

export function useIsMobile(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
