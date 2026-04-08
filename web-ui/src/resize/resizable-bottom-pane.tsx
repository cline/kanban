import type { ReactElement, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useUnmount, useWindowEvent } from "@/utils/react-use";

const NAVBAR_HEIGHT_PX = 40;
const COLLAPSE_SCREEN_EDGE_THRESHOLD_PX = 16;

function getDefaultPaneHeight(minHeight: number): number {
	if (typeof window === "undefined") {
		return minHeight;
	}
	const candidate = Math.floor(window.innerHeight * 0.5 - NAVBAR_HEIGHT_PX);
	return Math.max(minHeight, candidate);
}

function getMaxPaneHeight(minHeight: number): number {
	if (typeof window === "undefined") {
		return minHeight;
	}
	return Math.max(minHeight, Math.floor(window.innerHeight - NAVBAR_HEIGHT_PX));
}

function clampHeight(value: number, minHeight: number): number {
	return Math.max(minHeight, Math.min(value, getMaxPaneHeight(minHeight)));
}

function shouldCollapsePane(rawNextHeight: number, minHeight: number, deltaY: number, pointerY: number): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	const hasReachedMinimumHeight = rawNextHeight <= minHeight;
	const isNearBottomScreenEdge = pointerY >= window.innerHeight - COLLAPSE_SCREEN_EDGE_THRESHOLD_PX;
	return deltaY > 0 && hasReachedMinimumHeight && isNearBottomScreenEdge;
}

export function ResizableBottomPane({
	children,
	minHeight = 220,
	initialHeight,
	onHeightChange,
	onCollapse,
}: {
	children: ReactNode;
	minHeight?: number;
	initialHeight?: number;
	onHeightChange?: (height: number) => void;
	onCollapse?: () => void;
}): ReactElement {
	const [height, setHeight] = useState<number>(() =>
		clampHeight(initialHeight ?? getDefaultPaneHeight(minHeight), minHeight),
	);
	const [isDragging, setIsDragging] = useState(false);
	const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		setIsDragging(false);
		const previousBodyStyle = previousBodyStyleRef.current;
		if (previousBodyStyle) {
			document.body.style.userSelect = previousBodyStyle.userSelect;
			document.body.style.cursor = previousBodyStyle.cursor;
			previousBodyStyleRef.current = null;
		}
		dragStateRef.current = null;
	}, []);

	useUnmount(() => {
		stopDrag();
	});

	const handleResize = useCallback(() => {
		setHeight((current) => clampHeight(current, minHeight));
	}, [minHeight]);
	useWindowEvent("resize", handleResize);

	useEffect(() => {
		if (typeof initialHeight === "number") {
			setHeight(clampHeight(initialHeight, minHeight));
			return;
		}
		setHeight(getDefaultPaneHeight(minHeight));
	}, [initialHeight, minHeight]);

	useEffect(() => {
		onHeightChange?.(height);
	}, [height, onHeightChange]);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!isDragging) {
				return;
			}
			const dragState = dragStateRef.current;
			if (!dragState) {
				return;
			}
			const deltaY = event.clientY - dragState.startY;
			const rawNextHeight = dragState.startHeight - deltaY;
			if (shouldCollapsePane(rawNextHeight, minHeight, deltaY, event.clientY)) {
				stopDrag();
				onCollapse?.();
				return;
			}
			const nextHeight = clampHeight(dragState.startHeight - deltaY, minHeight);
			setHeight(nextHeight);
		},
		[isDragging, minHeight, onCollapse, stopDrag],
	);

	const handleMouseUp = useCallback(
		(event: MouseEvent) => {
			if (!isDragging) {
				return;
			}
			const dragState = dragStateRef.current;
			if (dragState) {
				const deltaY = event.clientY - dragState.startY;
				const rawNextHeight = dragState.startHeight - deltaY;
				if (shouldCollapsePane(rawNextHeight, minHeight, deltaY, event.clientY)) {
					onCollapse?.();
				}
			}
			stopDrag();
		},
		[isDragging, minHeight, onCollapse, stopDrag],
	);
	useWindowEvent("mousemove", isDragging ? handleMouseMove : null);
	useWindowEvent("mouseup", isDragging ? handleMouseUp : null);

	const handleResizeMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (isDragging) {
				stopDrag();
			}
			const startY = event.clientY;
			const startHeight = height;
			dragStateRef.current = { startY, startHeight };
			setIsDragging(true);

			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ns-resize";
		},
		[height, isDragging, stopDrag],
	);

	return (
		<div
			style={{
				position: "relative",
				display: "flex",
				flex: `0 0 ${height}px`,
				minHeight,
				minWidth: 0,
				overflow: "visible",
				borderTop: "1px solid var(--color-divider)",
				background: "var(--color-surface-1)",
			}}
		>
			<div
				role="separator"
				aria-orientation="horizontal"
				aria-label="Resize terminal pane"
				onMouseDown={handleResizeMouseDown}
				style={{
					position: "absolute",
					top: 0,
					left: 0,
					right: 0,
					height: 10,
					cursor: "ns-resize",
					zIndex: 2,
				}}
			/>
			<div style={{ display: "flex", flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>{children}</div>
		</div>
	);
}
