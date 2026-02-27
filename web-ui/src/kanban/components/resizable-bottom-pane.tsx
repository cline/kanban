import { Colors } from "@blueprintjs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from "react";

const NAVBAR_HEIGHT_PX = 40;

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

export function ResizableBottomPane({
	children,
	minHeight = 220,
}: {
	children: ReactNode;
	minHeight?: number;
}): ReactElement {
	const [height, setHeight] = useState<number>(() => getDefaultPaneHeight(minHeight));
	const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(null);
	const cleanupDragRef = useRef<(() => void) | null>(null);

	const stopDrag = useCallback(() => {
		const cleanup = cleanupDragRef.current;
		if (cleanup) {
			cleanup();
		}
		cleanupDragRef.current = null;
		dragStateRef.current = null;
	}, []);

	useEffect(() => {
		return () => {
			stopDrag();
		};
	}, [stopDrag]);

	useEffect(() => {
		const handleResize = () => {
			setHeight((current) => clampHeight(current, minHeight));
		};
		window.addEventListener("resize", handleResize);
		return () => {
			window.removeEventListener("resize", handleResize);
		};
	}, [minHeight]);

	const handleResizeMouseDown = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (cleanupDragRef.current) {
				stopDrag();
			}
			const startY = event.clientY;
			const startHeight = height;
			dragStateRef.current = { startY, startHeight };

			const previousUserSelect = document.body.style.userSelect;
			const previousCursor = document.body.style.cursor;
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ns-resize";

			const handleMouseMove = (moveEvent: MouseEvent) => {
				const dragState = dragStateRef.current;
				if (!dragState) {
					return;
				}
				const deltaY = moveEvent.clientY - dragState.startY;
				const nextHeight = clampHeight(dragState.startHeight - deltaY, minHeight);
				setHeight(nextHeight);
			};

			const handleMouseUp = () => {
				stopDrag();
			};

			window.addEventListener("mousemove", handleMouseMove);
			window.addEventListener("mouseup", handleMouseUp);
			cleanupDragRef.current = () => {
				window.removeEventListener("mousemove", handleMouseMove);
				window.removeEventListener("mouseup", handleMouseUp);
				document.body.style.userSelect = previousUserSelect;
				document.body.style.cursor = previousCursor;
			};
		},
		[height, minHeight, stopDrag],
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
				borderTop: "1px solid var(--bp-palette-dark-gray-5)",
				background: Colors.DARK_GRAY2,
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
			<div style={{ display: "flex", flex: "1 1 0", minWidth: 0, overflow: "hidden" }}>
				{children}
			</div>
		</div>
	);
}
