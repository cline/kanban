// ── Reducer-driven state management for the layout tree ──

import {
	cleanupTree,
	createPanel,
	createSplit,
	createTab,
	findPanelWithTab,
	isPanelNode,
	isSplitNode,
	normalizeSizes,
	reorder,
	updateNode,
	updatePanel,
} from "./layoutHelpers";
import type { LayoutNode, LayoutState, PanelNode, TabData } from "./layoutTypes";

// ── Action types ──

export type EdgePosition = "top" | "bottom" | "left" | "right";

export type LayoutAction =
	| { type: "SET_ACTIVE_TAB"; panelId: string; tabId: string }
	| { type: "ADD_TAB"; panelId: string; tab: TabData; index?: number }
	| { type: "REMOVE_TAB"; panelId: string; tabId: string }
	| { type: "REORDER_TABS"; panelId: string; fromIndex: number; toIndex: number }
	| {
			type: "MOVE_TAB";
			tabId: string;
			fromPanelId: string;
			toPanelId: string;
			toIndex?: number;
	  }
	| { type: "RESIZE"; splitId: string; sizes: number[] }
	| {
			type: "SPLIT_PANEL";
			panelId: string;
			direction: "horizontal" | "vertical";
			/** Tab to move from this panel into the new sibling. */
			tabToMove?: TabData;
			/** Tab data to place in the new sibling (from an external panel). */
			newTabData?: TabData;
			/** Place new panel before or after the original. Default: "after". */
			position?: "before" | "after";
	  }
	| { type: "SWAP_PANELS"; panelIdA: string; panelIdB: string }
	| {
			type: "MOVE_TAB_TO_EDGE";
			tabId: string;
			fromPanelId: string;
			edge: EdgePosition;
	  };

// ── Tab removal helper ──

function removeTabFromPanel(panel: PanelNode, tabId: string): PanelNode {
	const tabs = panel.tabs.filter((t) => t.id !== tabId);
	let { activeTabId } = panel;
	if (activeTabId === tabId) {
		const oldIdx = panel.tabs.findIndex((t) => t.id === tabId);
		activeTabId = tabs[oldIdx]?.id ?? tabs[oldIdx - 1]?.id ?? null;
	}
	return { ...panel, tabs, activeTabId };
}

// ── Reducer ──

function reduceAction(state: LayoutState, action: LayoutAction): LayoutState {
	switch (action.type) {
		case "SET_ACTIVE_TAB":
			return {
				root: updatePanel(state.root, action.panelId, (p) => ({
					...p,
					activeTabId: action.tabId,
				})),
			};

		case "ADD_TAB": {
			return {
				root: updatePanel(state.root, action.panelId, (p) => {
					const tabs = [...p.tabs];
					tabs.splice(action.index ?? tabs.length, 0, action.tab);
					return { ...p, tabs, activeTabId: action.tab.id };
				}),
			};
		}

		case "REMOVE_TAB":
			return {
				root: updatePanel(state.root, action.panelId, (p) => removeTabFromPanel(p, action.tabId)),
			};

		case "REORDER_TABS":
			return {
				root: updatePanel(state.root, action.panelId, (p) => ({
					...p,
					tabs: reorder(p.tabs, action.fromIndex, action.toIndex),
				})),
			};

		case "MOVE_TAB": {
			const sourcePanel = findPanelWithTab(state.root, action.tabId);
			const tab = sourcePanel?.tabs.find((t) => t.id === action.tabId);
			if (!tab) return state;

			let root: LayoutNode = updatePanel(state.root, action.fromPanelId, (p) => removeTabFromPanel(p, action.tabId));

			root = updatePanel(root, action.toPanelId, (p) => {
				const tabs = [...p.tabs];
				tabs.splice(action.toIndex ?? tabs.length, 0, tab);
				return { ...p, tabs, activeTabId: tab.id };
			});

			return { root };
		}

		case "RESIZE":
			return {
				root: updateNode(state.root, action.splitId, (node) => {
					if (!isSplitNode(node)) return node;
					return { ...node, sizes: normalizeSizes(action.sizes) };
				}),
			};

		case "SPLIT_PANEL": {
			return {
				root: updateNode(state.root, action.panelId, (node) => {
					if (!isPanelNode(node)) return node;

					// Build the new sibling panel
					const tabForNew = action.newTabData ?? action.tabToMove;
					const newPanel = createPanel(tabForNew ? [tabForNew] : [createTab("New Tab")]);

					// Optionally remove the moved tab from the original
					let original = node;
					if (action.tabToMove) {
						const tabs = node.tabs.filter((t) => t.id !== action.tabToMove!.id);
						original = {
							...node,
							tabs,
							activeTabId: node.activeTabId === action.tabToMove.id ? (tabs[0]?.id ?? null) : node.activeTabId,
						};
					}

					const before = action.position === "before";
					const children = before ? [newPanel, original] : [original, newPanel];
					return createSplit(action.direction, children, [50, 50]);
				}),
			};
		}

		case "SWAP_PANELS": {
			const findPanel = (n: LayoutNode, id: string): PanelNode | null => {
				if (isPanelNode(n) && n.id === id) return n;
				if (isSplitNode(n)) {
					for (const c of n.children) {
						const found = findPanel(c, id);
						if (found) return found;
					}
				}
				return null;
			};

			const panelA = findPanel(state.root, action.panelIdA);
			const panelB = findPanel(state.root, action.panelIdB);
			if (!panelA || !panelB) return state;

			let root: LayoutNode = updatePanel(state.root, action.panelIdA, () => ({
				...panelB,
				id: action.panelIdA,
			}));
			root = updatePanel(root, action.panelIdB, () => ({
				...panelA,
				id: action.panelIdB,
			}));

			return { root };
		}

		case "MOVE_TAB_TO_EDGE": {
			const edgeSource = findPanelWithTab(state.root, action.tabId);
			const edgeTab = edgeSource?.tabs.find((t) => t.id === action.tabId);
			if (!edgeTab) return state;

			let edgeRoot: LayoutNode = updatePanel(state.root, action.fromPanelId, (p) =>
				removeTabFromPanel(p, action.tabId),
			);

			const edgePanel = createPanel([edgeTab]);
			const dir: "horizontal" | "vertical" =
				action.edge === "left" || action.edge === "right" ? "horizontal" : "vertical";
			const newFirst = action.edge === "left" || action.edge === "top";

			edgeRoot = createSplit(dir, newFirst ? [edgePanel, edgeRoot] : [edgeRoot, edgePanel], [50, 50]);

			return { root: edgeRoot };
		}

		default:
			return state;
	}
}

/** Public reducer: applies the action then cleans up empty panels / single-child splits. */
export function layoutReducer(state: LayoutState, action: LayoutAction): LayoutState {
	const next = reduceAction(state, action);
	if (next === state) return state;
	const cleaned = cleanupTree(next.root);
	return cleaned === next.root ? next : { root: cleaned };
}
