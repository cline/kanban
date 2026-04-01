// ── Renders a SplitNode: flex container with children separated by resize handles ──

import { Fragment, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { LayoutNodeView } from "./LayoutNodeView";
import type { LayoutNode, SplitNode } from "./layoutTypes";
import { ResizeHandle } from "./ResizeHandle";

interface SplitViewProps {
	node: SplitNode;
	layoutRoot?: LayoutNode;
}

export function SplitView({ node, layoutRoot }: SplitViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const { direction, children, sizes } = node;
	const isHorizontal = direction === "horizontal";

	return (
		<div
			ref={containerRef}
			className={cn("flex h-full w-full min-w-0 min-h-0 overflow-hidden", isHorizontal ? "flex-row" : "flex-col")}
		>
			{children.map((child, i) => (
				<Fragment key={child.id}>
					<div style={{ flex: `${sizes[i] ?? 1} 1 0%`, minWidth: 0, minHeight: 0 }} className="overflow-hidden">
						<LayoutNodeView node={child} parentDirection={direction} layoutRoot={layoutRoot} />
					</div>
					{i < children.length - 1 && (
						<ResizeHandle
							splitId={node.id}
							direction={direction}
							index={i}
							sizes={sizes}
							containerRef={containerRef}
						/>
					)}
				</Fragment>
			))}
		</div>
	);
}
