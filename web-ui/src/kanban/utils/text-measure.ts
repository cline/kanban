export const DEFAULT_TEXT_MEASURE_FONT = "500 14px sans-serif";

let sharedMeasureContext: CanvasRenderingContext2D | null | undefined;

function getSharedMeasureContext(): CanvasRenderingContext2D | null {
	if (typeof document === "undefined") {
		return null;
	}
	if (sharedMeasureContext !== undefined) {
		return sharedMeasureContext;
	}
	const canvas = document.createElement("canvas");
	sharedMeasureContext = canvas.getContext("2d");
	return sharedMeasureContext;
}

export function measureTextWidth(value: string, font: string): number {
	const context = getSharedMeasureContext();
	if (!context) {
		return value.length;
	}
	context.font = font;
	return context.measureText(value).width;
}

export function readElementFontShorthand(element: Element | null, fallbackFont = DEFAULT_TEXT_MEASURE_FONT): string {
	if (!element || typeof window === "undefined") {
		return fallbackFont;
	}
	const computed = window.getComputedStyle(element);
	const font =
		`${computed.fontStyle} ${computed.fontVariant} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`
			.replace(/\s+/g, " ")
			.trim();
	return font || fallbackFont;
}
