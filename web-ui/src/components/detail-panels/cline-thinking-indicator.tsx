import React, { useState } from "react";

import { ShimmeringText } from "@/components/ui/text-shimmer";
import { useInterval } from "@/utils/react-use";

const BRAILLE_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const BRAILLE_SPINNER_INTERVAL_MS = 80;

const BrailleSpinner = React.memo(function BrailleSpinner() {
	const [frameIndex, setFrameIndex] = useState(0);

	useInterval(() => {
		setFrameIndex((current) => (current + 1) % BRAILLE_SPINNER_FRAMES.length);
	}, BRAILLE_SPINNER_INTERVAL_MS);

	return (
		<span
			aria-hidden="true"
			data-testid="cline-thinking-spinner"
			className="inline-flex w-[1ch] justify-center font-mono text-sm leading-none text-text-tertiary"
		>
			{BRAILLE_SPINNER_FRAMES[frameIndex]}
		</span>
	);
});

export const ClineThinkingIndicator = React.memo(function ClineThinkingIndicator() {
	return (
		<div className="px-1.5" role="status" aria-live="polite">
			<div className="inline-flex items-center gap-1.5">
				<BrailleSpinner />
				<ShimmeringText
					text="Thinking..."
					className="text-sm"
					duration={2.5}
					spread={5}
					repeatDelay={0}
					startOnView={false}
				/>
			</div>
		</div>
	);
});
