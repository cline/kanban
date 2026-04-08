import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

type ResizeDragAxis = "x" | "y";

function getPointerPosition(axis: ResizeDragAxis, event: MouseEvent): number {
	return axis === "x" ? event.clientX : event.clientY;
}

interface ResizeDragSession {
	axis: ResizeDragAxis;
	cursor: "ew-resize" | "ns-resize";
	onMove: (pointer: number, event: MouseEvent) => void;
	onEnd?: (pointer: number, event: MouseEvent) => void;
}

interface ResizeDragStartConfig extends ResizeDragSession {}

export function useResizeDrag(): {
	isDragging: boolean;
	startDrag: (event: ReactMouseEvent, config: ResizeDragStartConfig) => void;
	stopDrag: () => void;
} {
	const [isDragging, setIsDragging] = useState(false);
	const dragSessionRef = useRef<ResizeDragSession | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		const previousBodyStyle = previousBodyStyleRef.current;
		if (previousBodyStyle) {
			document.body.style.userSelect = previousBodyStyle.userSelect;
			document.body.style.cursor = previousBodyStyle.cursor;
		}
		previousBodyStyleRef.current = null;
		dragSessionRef.current = null;
		setIsDragging(false);
	}, []);

	const handleMouseMove = useCallback((event: MouseEvent) => {
		const dragSession = dragSessionRef.current;
		if (!dragSession) {
			return;
		}
		const pointer = getPointerPosition(dragSession.axis, event);
		dragSession.onMove(pointer, event);
	}, []);

	const handleMouseUp = useCallback(
		(event: MouseEvent) => {
			const dragSession = dragSessionRef.current;
			if (!dragSession) {
				return;
			}
			const pointer = getPointerPosition(dragSession.axis, event);
			dragSession.onEnd?.(pointer, event);
			stopDrag();
		},
		[stopDrag],
	);

	useWindowEvent("mousemove", handleMouseMove);
	useWindowEvent("mouseup", handleMouseUp);
	useUnmount(stopDrag);

	const startDrag = useCallback(
		(event: ReactMouseEvent, config: ResizeDragStartConfig) => {
			event.preventDefault();
			stopDrag();
			dragSessionRef.current = config;
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = config.cursor;
			setIsDragging(true);
		},
		[stopDrag],
	);

	return {
		isDragging,
		startDrag,
		stopDrag,
	};
}
