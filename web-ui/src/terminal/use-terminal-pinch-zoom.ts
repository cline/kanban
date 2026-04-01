import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 13;
const PINCH_SENSITIVITY = 0.04;

interface UseTerminalPinchZoomOptions {
	containerRef: RefObject<HTMLDivElement | null>;
	enabled: boolean;
	onFontSizeChange: (fontSize: number) => void;
}

function getDistance(touch1: Touch, touch2: Touch): number {
	const dx = touch1.clientX - touch2.clientX;
	const dy = touch1.clientY - touch2.clientY;
	return Math.sqrt(dx * dx + dy * dy);
}

export function useTerminalPinchZoom({ containerRef, enabled, onFontSizeChange }: UseTerminalPinchZoomOptions): void {
	const startDistanceRef = useRef<number | null>(null);
	const baseFontSizeRef = useRef(DEFAULT_FONT_SIZE);
	const currentFontSizeRef = useRef(DEFAULT_FONT_SIZE);

	const handleTouchStart = useCallback(
		(event: TouchEvent) => {
			if (!enabled || event.touches.length !== 2) {
				return;
			}
			startDistanceRef.current = getDistance(event.touches[0]!, event.touches[1]!);
			baseFontSizeRef.current = currentFontSizeRef.current;
		},
		[enabled],
	);

	const handleTouchMove = useCallback(
		(event: TouchEvent) => {
			if (!enabled || event.touches.length !== 2 || startDistanceRef.current === null) {
				return;
			}
			event.preventDefault();
			const currentDistance = getDistance(event.touches[0]!, event.touches[1]!);
			const delta = (currentDistance - startDistanceRef.current) * PINCH_SENSITIVITY;
			const newSize = Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, baseFontSizeRef.current + delta)));
			if (newSize !== currentFontSizeRef.current) {
				currentFontSizeRef.current = newSize;
				onFontSizeChange(newSize);
			}
		},
		[enabled, onFontSizeChange],
	);

	const handleTouchEnd = useCallback(() => {
		startDistanceRef.current = null;
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !enabled) {
			return;
		}
		container.addEventListener("touchstart", handleTouchStart, { passive: true });
		container.addEventListener("touchmove", handleTouchMove, { passive: false });
		container.addEventListener("touchend", handleTouchEnd, { passive: true });
		container.addEventListener("touchcancel", handleTouchEnd, { passive: true });

		return () => {
			container.removeEventListener("touchstart", handleTouchStart);
			container.removeEventListener("touchmove", handleTouchMove);
			container.removeEventListener("touchend", handleTouchEnd);
			container.removeEventListener("touchcancel", handleTouchEnd);
		};
	}, [containerRef, enabled, handleTouchEnd, handleTouchMove, handleTouchStart]);
}
