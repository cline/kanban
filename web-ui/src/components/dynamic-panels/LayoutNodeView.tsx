// ── Recursive dispatcher: renders the correct component for each node type ──

import { isPanelNode } from "./layoutHelpers";
import type { LayoutNode } from "./layoutTypes";
import { PanelView } from "./PanelView";
import { SplitView } from "./SplitView";

interface LayoutNodeViewProps {
	node: LayoutNode;
	/** Unused by PanelView now but kept for SplitView child direction context. */
	parentDirection?: "horizontal" | "vertical";
	/** The full layout root, threaded down for cross-panel operations. */
	layoutRoot?: LayoutNode;
}

export function LayoutNodeView({ node, layoutRoot }: LayoutNodeViewProps) {
	const root = layoutRoot ?? node;
	if (isPanelNode(node)) {
		return <PanelView node={node} layoutRoot={root} />;
	}
	return <SplitView node={node} layoutRoot={root} />;
}
