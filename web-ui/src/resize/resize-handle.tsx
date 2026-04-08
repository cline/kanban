import type { MouseEvent as ReactMouseEvent } from "react";
import { cn } from "@/components/ui/cn";

export function ResizeHandle({
	orientation,
	ariaLabel,
	hitArea = 4,
	onMouseDown,
	showBaseLine = true,
	className,
}: {
	orientation: "vertical" | "horizontal";
	ariaLabel: string;
	hitArea?: number;
	onMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
	showBaseLine?: boolean;
	className?: string;
}): React.ReactElement {
	const overlap = Math.max(0, hitArea);
	const interactiveAreaStyle =
		orientation === "vertical"
			? {
					top: 0,
					bottom: 0,
					left: -overlap,
					right: -overlap,
					cursor: "ew-resize",
				}
			: {
					left: 0,
					right: 0,
					top: -overlap,
					bottom: -overlap,
					cursor: "ns-resize",
				};

	return (
		<div
			role="separator"
			aria-orientation={orientation}
			aria-label={ariaLabel}
			onMouseDown={onMouseDown}
			className={cn(
				"relative shrink-0 group",
				orientation === "vertical" ? "w-px self-stretch" : "h-px w-full",
				className,
			)}
			style={{ cursor: orientation === "vertical" ? "ew-resize" : "ns-resize" }}
		>
			{showBaseLine ? <div className="pointer-events-none absolute inset-0 bg-border" /> : null}
			<div aria-hidden style={{ position: "absolute", zIndex: 10, ...interactiveAreaStyle }} />
		</div>
	);
}
