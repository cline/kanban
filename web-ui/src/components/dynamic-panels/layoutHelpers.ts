// ── Pure helper functions for traversing and updating the layout tree ──

import type { LayoutNode, PanelNode, SplitNode, TabData } from "./layoutTypes";

// ── ID generation ──

let nextId = 1;

export function generateId(prefix = "node"): string {
	return `${prefix}-${nextId++}-${Date.now().toString(36)}`;
}

// ── Type guards ──

export function isPanelNode(node: LayoutNode): node is PanelNode {
	return node.type === "panel";
}

export function isSplitNode(node: LayoutNode): node is SplitNode {
	return node.type === "split";
}

// ── Tree traversal ──

/** Find a node anywhere in the tree by its ID. */
export function findNode(root: LayoutNode, id: string): LayoutNode | null {
	if (root.id === id) return root;
	if (isSplitNode(root)) {
		for (const child of root.children) {
			const found = findNode(child, id);
			if (found) return found;
		}
	}
	return null;
}

/** Find the parent SplitNode containing the node with the given ID. */
export function findParent(root: LayoutNode, nodeId: string): { parent: SplitNode; index: number } | null {
	if (isSplitNode(root)) {
		for (let i = 0; i < root.children.length; i++) {
			const child = root.children[i]!;
			if (child.id === nodeId) {
				return { parent: root, index: i };
			}
			const found = findParent(child, nodeId);
			if (found) return found;
		}
	}
	return null;
}

/** Find the panel that contains a specific tab by tab ID. */
export function findPanelWithTab(root: LayoutNode, tabId: string): PanelNode | null {
	if (isPanelNode(root)) {
		return root.tabs.some((t) => t.id === tabId) ? root : null;
	}
	for (const child of root.children) {
		const found = findPanelWithTab(child, tabId);
		if (found) return found;
	}
	return null;
}

/** Collect all PanelNode leaves in the tree. */
export function collectPanels(root: LayoutNode): PanelNode[] {
	if (isPanelNode(root)) return [root];
	return root.children.flatMap(collectPanels);
}

// ── Immutable tree updates ──

/**
 * Replace a node in the tree identified by `id`.
 * Returns the same reference if nothing changed (structural sharing).
 */
export function updateNode(root: LayoutNode, id: string, updater: (node: LayoutNode) => LayoutNode): LayoutNode {
	if (root.id === id) return updater(root);
	if (isSplitNode(root)) {
		let changed = false;
		const newChildren = root.children.map((child) => {
			const updated = updateNode(child, id, updater);
			if (updated !== child) changed = true;
			return updated;
		});
		return changed ? { ...root, children: newChildren } : root;
	}
	return root;
}

/** Convenience wrapper: update a PanelNode by ID. */
export function updatePanel(root: LayoutNode, panelId: string, updater: (panel: PanelNode) => PanelNode): LayoutNode {
	return updateNode(root, panelId, (node) => {
		if (!isPanelNode(node)) return node;
		return updater(node);
	});
}

// ── Array helpers ──

/** Immutably move an item from one index to another within an array. */
export function reorder<T>(list: T[], fromIndex: number, toIndex: number): T[] {
	const result = [...list];
	const [removed] = result.splice(fromIndex, 1);
	if (removed !== undefined) {
		result.splice(toIndex, 0, removed);
	}
	return result;
}

/** Normalize sizes so they always sum to exactly 100. */
export function normalizeSizes(sizes: number[]): number[] {
	const total = sizes.reduce((a, b) => a + b, 0);
	if (total === 0) return sizes.map(() => 100 / sizes.length);
	return sizes.map((s) => (s / total) * 100);
}

// ── Factory helpers ──

export function createTab(title: string, overrides?: Partial<TabData>): TabData {
	return {
		id: generateId("tab"),
		title,
		closable: true,
		...overrides,
	};
}

export function createPanel(tabs: TabData[] = [], overrides?: Partial<PanelNode>): PanelNode {
	return {
		type: "panel",
		id: generateId("panel"),
		tabs,
		activeTabId: tabs[0]?.id ?? null,
		...overrides,
	};
}

export function createSplit(direction: "horizontal" | "vertical", children: LayoutNode[], sizes?: number[]): SplitNode {
	const equalSize = 100 / children.length;
	return {
		type: "split",
		id: generateId("split"),
		direction,
		children,
		sizes: sizes ?? children.map(() => equalSize),
	};
}

// ── Tree cleanup ──

/**
 * Post-reducer cleanup pass:
 * 1. Remove empty panels (0 tabs) from split nodes
 * 2. Flatten single-child splits (replace with child)
 * 3. Never remove the root if it's the last panel
 */
export function cleanupTree(root: LayoutNode): LayoutNode {
	// Base case: a panel is a leaf — only remove it at the split level
	if (isPanelNode(root)) return root;

	// Recurse into children first
	let children = root.children.map(cleanupTree);

	// Remove empty panels (panels with 0 tabs)
	const beforeLen = children.length;
	const filteredChildren: LayoutNode[] = [];
	const filteredSizes: number[] = [];
	for (let i = 0; i < children.length; i++) {
		const child = children[i]!;
		const isEmpty = isPanelNode(child) && child.tabs.length === 0;
		if (!isEmpty) {
			filteredChildren.push(child);
			filteredSizes.push(root.sizes[i] ?? 0);
		}
	}

	// If all children were removed, keep at least one empty panel
	if (filteredChildren.length === 0) {
		return createPanel();
	}

	children = filteredChildren;
	let sizes = filteredSizes;

	// Re-normalize sizes if children were removed
	if (children.length !== beforeLen) {
		sizes = normalizeSizes(sizes);
	}

	// Flatten: if only one child remains, promote it
	if (children.length === 1) {
		return children[0]!;
	}

	// Return updated split if anything changed
	if (children !== root.children || sizes !== root.sizes) {
		return { ...root, children, sizes };
	}

	return root;
}
