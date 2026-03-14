import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export function TooltipProvider({ children }: { children: ReactNode }): React.ReactElement {
	return <RadixTooltip.Provider delayDuration={400}>{children}</RadixTooltip.Provider>;
}

export function Tooltip({
	content,
	children,
	side,
}: {
	content: ReactNode;
	children: ReactNode;
	side?: "top" | "right" | "bottom" | "left";
}): React.ReactElement {
	if (!content) {
		return <>{children}</>;
	}

	return (
		<RadixTooltip.Root>
			<RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
			<RadixTooltip.Portal>
				<RadixTooltip.Content
					side={side}
					className="z-50 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs text-text-primary shadow-lg"
					style={{ animation: "kb-tooltip-show 100ms ease" }}
					sideOffset={5}
				>
					{content}
				</RadixTooltip.Content>
			</RadixTooltip.Portal>
		</RadixTooltip.Root>
	);
}
