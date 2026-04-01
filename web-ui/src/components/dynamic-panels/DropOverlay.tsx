// ── 4-zone split overlay shown when dragging a tab over a panel's content area ──
// Highlights the half where a new split panel would be created.

import { cn } from "@/components/ui/cn";
import type { DropZone } from "./DragContext";

interface DropOverlayProps {
	activeZone: DropZone | null;
}

export function DropOverlay({ activeZone }: DropOverlayProps) {
	if (!activeZone) return null;

	// Highlight the half of the panel where the new split would appear
	const zoneStyles: Record<DropZone, string> = {
		top: "top-0 left-0 right-0 h-1/2",
		bottom: "bottom-0 left-0 right-0 h-1/2",
		left: "top-0 bottom-0 left-0 w-1/2",
		right: "top-0 bottom-0 right-0 w-1/2",
	};

	return (
		<div className="absolute inset-0 z-30 pointer-events-none">
			<div className={cn("absolute bg-accent/15 transition-all duration-75", zoneStyles[activeZone])} />
		</div>
	);
}

/** Given a mouse position relative to a panel rect, determine which split zone. */
export function hitTestDropZone(clientX: number, clientY: number, rect: DOMRect): DropZone {
	const relX = (clientX - rect.left) / rect.width;
	const relY = (clientY - rect.top) / rect.height;

	// Determine the closest edge
	const distLeft = relX;
	const distRight = 1 - relX;
	const distTop = relY;
	const distBottom = 1 - relY;
	const min = Math.min(distLeft, distRight, distTop, distBottom);

	if (min === distTop) return "top";
	if (min === distBottom) return "bottom";
	if (min === distLeft) return "left";
	return "right";
}
