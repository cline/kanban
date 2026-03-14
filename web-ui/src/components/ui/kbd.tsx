import type { ReactNode } from "react";

import { cn } from "@/components/ui/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }): React.ReactElement {
	return (
		<kbd
			className={cn(
				"inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded border border-border bg-surface-2 font-mono text-[11px] text-text-secondary",
				className,
			)}
		>
			{children}
		</kbd>
	);
}
