import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

/**
 * A polished setting row with label + optional description on the left,
 * and a control aligned to the right. Sits inside a SettingSection card
 * with dividers between rows (Linear-style).
 */
export function SettingRow({
	label,
	description,
	control,
	children,
	className,
	noBorder,
}: {
	label?: string;
	description?: ReactNode;
	control?: ReactNode;
	children?: ReactNode;
	className?: string;
	noBorder?: boolean;
}): React.ReactElement {
	return (
		<div
			className={cn(
				"flex items-start justify-between gap-4 px-4 py-3",
				!noBorder && "border-b border-border/40 last:border-b-0",
				className,
			)}
		>
			<div className="flex-1 min-w-0">
				{label ? <p className="text-[13px] font-semibold text-text-primary m-0">{label}</p> : null}
				{description ? (
					<p className="text-[12px] text-text-secondary mt-1 mb-0 leading-relaxed">{description}</p>
				) : null}
				{children ? <div className="mt-3">{children}</div> : null}
			</div>
			{control ? <div className="shrink-0 flex items-center pt-0.5">{control}</div> : null}
		</div>
	);
}
