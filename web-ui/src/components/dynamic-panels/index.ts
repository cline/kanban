// ── Barrel exports for the dynamic panels system ──

// Drag
export type { DragPayload, DragState, DropTarget, DropZone, TabBarInsertTarget } from "./DragContext";
export { DragProvider, INITIAL_DRAG_STATE, useDragContext } from "./DragContext";
export { DropOverlay, hitTestDropZone } from "./DropOverlay";
// Context
export type { LayoutContextValue } from "./LayoutContext";
export { LayoutProvider, useLayoutContext, useLayoutDispatch } from "./LayoutContext";
// Components
export { LayoutNodeView } from "./LayoutNodeView";
// Helpers
export {
	cleanupTree,
	collectPanels,
	createPanel,
	createSplit,
	createTab,
	findNode,
	findPanelWithTab,
	findParent,
	generateId,
	isPanelNode,
	isSplitNode,
	normalizeSizes,
	reorder,
	updateNode,
	updatePanel,
} from "./layoutHelpers";
// Reducer
export type { LayoutAction } from "./layoutReducer";
export { layoutReducer } from "./layoutReducer";
// Types
export type { LayoutNode, LayoutState, PanelNode, SplitNode, TabData } from "./layoutTypes";
export { HANDLE_SIZE, MIN_SIZE_PERCENT } from "./layoutTypes";
export { PanelView } from "./PanelView";
export { ResizeHandle } from "./ResizeHandle";
export { SplitView } from "./SplitView";
export { TabContextMenu } from "./TabContextMenu";

// Hooks
export { useKeyboardNavigation } from "./useKeyboardNavigation";
export { clearPersistedLayout, loadPersistedLayout, usePersistLayout } from "./useLayoutPersistence";
