import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Classic braille spinner frames — a single rotating dot pattern.
 * Sourced from the "braille" spinner in unicode-animations (MIT).
 * Each frame is one braille character (~same width as a bullet).
 *
 * @see https://github.com/gunnargray-dev/unicode-animations
 */
const BRAILLE_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BRAILLE_INTERVAL_MS = 80;

interface BrailleSpinnerProps {
	/** CSS class applied to the outer `<span>`. */
	className?: string;
	/** Inline color override (e.g. a CSS variable). Falls back to `currentColor`. */
	color?: string;
}

/**
 * A compact Unicode braille spinner — a single rotating dot pattern
 * roughly the width of a bullet. Zero dependencies, purely CSS-colored text.
 */
export function BrailleSpinner({ className, color }: BrailleSpinnerProps) {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % BRAILLE_FRAMES.length);
		}, BRAILLE_INTERVAL_MS);
		return () => clearInterval(timer);
	}, []);

	return (
		<span className={cn("inline-block font-mono leading-none", className)} style={{ color }} aria-hidden="true">
			{BRAILLE_FRAMES[frameIndex]}
		</span>
	);
}
