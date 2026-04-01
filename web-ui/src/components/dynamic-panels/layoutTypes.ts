// ── Data model for a recursive split-panel layout tree ──

/** A single tab within a panel. */
export interface TabData {
	id: string;
	title: string;
	closable: boolean;
}

/** Leaf node: a panel containing an ordered list of tabs. */
export interface PanelNode {
	type: "panel";
	id: string;
	tabs: TabData[];
	activeTabId: string | null;
}

/**
 * Container node that splits space between children along an axis.
 * `sizes` are relative values summing to 100 (percentages).
 */
export interface SplitNode {
	type: "split";
	id: string;
	direction: "horizontal" | "vertical";
	children: LayoutNode[];
	sizes: number[];
}

/** Discriminated union of all layout tree node types. */
export type LayoutNode = PanelNode | SplitNode;

/** Top-level state managed by the layout reducer. */
export interface LayoutState {
	root: LayoutNode;
}

// ── Layout constants ──

/** Resize handle thickness in px. */
export const HANDLE_SIZE = 5;

/** Minimum panel percentage before it becomes too small. */
export const MIN_SIZE_PERCENT = 5;
