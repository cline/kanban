// ── Shared drag state for the native HTML drag system ──
// Drop onto tab bar → merge (reorder / move).
// Drop onto content area → split (top / bottom / left / right).

import { createContext, useContext } from "react";

/** Which split direction the cursor is indicating over a panel's content area. */
export type DropZone = "top" | "bottom" | "left" | "right";

/** Info about the tab currently being dragged. */
export interface DragPayload {
	tabId: string;
	tabTitle: string;
	sourcePanelId: string;
}

/** Panel content-area split target. */
export interface DropTarget {
	panelId: string;
	zone: DropZone;
}

/** Tab bar insertion target. */
export interface TabBarInsertTarget {
	panelId: string;
	index: number;
}

export interface DragState {
	/** The tab currently being dragged, or null. */
	payload: DragPayload | null;
	/** The panel split zone the cursor is over, or null. */
	dropTarget: DropTarget | null;
	/** Tab bar insertion point, or null. */
	tabBarTarget: TabBarInsertTarget | null;
}

export const INITIAL_DRAG_STATE: DragState = {
	payload: null,
	dropTarget: null,
	tabBarTarget: null,
};

export interface DragContextValue {
	drag: DragState;
	setDrag: (updater: (prev: DragState) => DragState) => void;
}

const Ctx = createContext<DragContextValue | null>(null);

export const DragProvider = Ctx.Provider;

export function useDragContext(): DragContextValue {
	const ctx = useContext(Ctx);
	if (!ctx) throw new Error("useDragContext must be used within DragProvider");
	return ctx;
}
