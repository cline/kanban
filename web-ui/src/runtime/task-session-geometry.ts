import { MOBILE_BREAKPOINT_PX } from "@/utils/platform";

const DETAIL_TERMINAL_WIDTH_FRACTION = 1 / 3;
const APPROX_TERMINAL_CELL_WIDTH_PX = 8;
const APPROX_TERMINAL_CELL_HEIGHT_PX = 16;
const APP_TOP_BAR_HEIGHT_PX = 40;
const MIN_TERMINAL_COLS = 20;
const MIN_TERMINAL_ROWS = 12;

export interface TaskSessionGeometry {
	cols: number;
	rows: number;
}

export function estimateTaskSessionGeometry(viewportWidth: number, viewportHeight: number): TaskSessionGeometry {
	const isMobile = viewportWidth < MOBILE_BREAKPOINT_PX;
	const safeViewportWidth = Math.max(0, viewportWidth);
	const safeViewportHeight = Math.max(0, viewportHeight - APP_TOP_BAR_HEIGHT_PX);
	// On mobile, the terminal occupies the full viewport width.
	const terminalWidthPx = isMobile ? safeViewportWidth : safeViewportWidth * DETAIL_TERMINAL_WIDTH_FRACTION;

	return {
		cols: Math.max(MIN_TERMINAL_COLS, Math.floor(terminalWidthPx / APPROX_TERMINAL_CELL_WIDTH_PX)),
		rows: Math.max(MIN_TERMINAL_ROWS, Math.floor(safeViewportHeight / APPROX_TERMINAL_CELL_HEIGHT_PX)),
	};
}
