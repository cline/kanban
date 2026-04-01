// ── React context for distributing layout dispatch and render callbacks ──

import type { Dispatch } from "react";
import { createContext, useContext } from "react";
import type { LayoutAction } from "./layoutReducer";
import type { TabData } from "./layoutTypes";

export interface LayoutContextValue {
	dispatch: Dispatch<LayoutAction>;
	/** Optional render function for tab content. Falls back to a placeholder. */
	renderTabContent?: (tab: TabData, panelId: string) => React.ReactNode;
}

const LayoutContext = createContext<LayoutContextValue | null>(null);

export const LayoutProvider = LayoutContext.Provider;

export function useLayoutDispatch(): Dispatch<LayoutAction> {
	const ctx = useContext(LayoutContext);
	if (!ctx) throw new Error("useLayoutDispatch must be used within a LayoutProvider");
	return ctx.dispatch;
}

export function useLayoutContext(): LayoutContextValue {
	const ctx = useContext(LayoutContext);
	if (!ctx) throw new Error("useLayoutContext must be used within a LayoutProvider");
	return ctx;
}
