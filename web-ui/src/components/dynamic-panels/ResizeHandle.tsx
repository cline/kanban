// ── Draggable resize handle between split children ──

import { useCallback, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { useLayoutDispatch } from "./LayoutContext";
import { HANDLE_SIZE, MIN_SIZE_PERCENT } from "./layoutTypes";

interface ResizeHandleProps {
	splitId: string;
	direction: "horizontal" | "vertical";
	/** Index of the handle: sits between children[index] and children[index+1]. */
	index: number;
	sizes: number[];
	containerRef: React.RefObject<HTMLDivElement | null>;
}

export function ResizeHandle({ splitId, direction, index, sizes, containerRef }: ResizeHandleProps) {
	const dispatch = useLayoutDispatch();
	const dragging = useRef(false);
	const startPos = useRef(0);
	const startSizes = useRef<number[]>([]);

	const onPointerDown = useCallback(
		(e: React.PointerEvent) => {
			e.preventDefault();
			(e.target as HTMLElement).setPointerCapture(e.pointerId);
			dragging.current = true;
			startPos.current = direction === "horizontal" ? e.clientX : e.clientY;
			startSizes.current = [...sizes];

			document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";
			document.body.style.userSelect = "none";
		},
		[direction, sizes],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent) => {
			if (!dragging.current || !containerRef.current) return;

			const rect = containerRef.current.getBoundingClientRect();
			const containerSize = direction === "horizontal" ? rect.width : rect.height;
			if (containerSize === 0) return;

			const current = direction === "horizontal" ? e.clientX : e.clientY;
			const deltaPx = current - startPos.current;
			const deltaPct = (deltaPx / containerSize) * 100;

			const newSizes = [...startSizes.current];
			const sizeA = (newSizes[index] ?? 0) + deltaPct;
			const sizeB = (newSizes[index + 1] ?? 0) - deltaPct;

			if (sizeA < MIN_SIZE_PERCENT || sizeB < MIN_SIZE_PERCENT) return;

			newSizes[index] = sizeA;
			newSizes[index + 1] = sizeB;
			dispatch({ type: "RESIZE", splitId, sizes: newSizes });
		},
		[dispatch, splitId, direction, index, containerRef],
	);

	const onPointerUp = useCallback((e: React.PointerEvent) => {
		dragging.current = false;
		(e.target as HTMLElement).releasePointerCapture(e.pointerId);
		document.body.style.cursor = "";
		document.body.style.userSelect = "";
	}, []);

	return (
		<div
			role="separator"
			aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			className={cn(
				"relative flex-shrink-0 z-10",
				"bg-border transition-colors duration-100",
				"hover:bg-accent active:bg-accent",
				direction === "horizontal" ? "cursor-col-resize" : "cursor-row-resize",
			)}
			style={direction === "horizontal" ? { width: HANDLE_SIZE } : { height: HANDLE_SIZE }}
		/>
	);
}
