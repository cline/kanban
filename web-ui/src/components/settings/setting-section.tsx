import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

/**
 * A sub-section within a settings panel. Renders a muted heading
 * with the content wrapped in a Linear-style card.
 */
export function SettingSection({
	title,
	children,
	className,
	noCard,
}: {
	title: string;
	children: ReactNode;
	className?: string;
	/** When true, skip the card wrapper (useful when children provide their own card). */
	noCard?: boolean;
}): React.ReactElement {
	return (
		<div className={cn("mt-6 first:mt-0", className)}>
			<h3 className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary m-0 mb-2">{title}</h3>
			{noCard ? (
				<div>{children}</div>
			) : (
				<div className="rounded-lg border border-border bg-surface-0 overflow-clip">{children}</div>
			)}
		</div>
	);
}
