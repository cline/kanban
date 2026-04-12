import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/components/ui/cn";

const nativeSelectBaseClassName =
	"rounded-md border border-border-bright bg-surface-2 text-text-primary hover:bg-surface-3 hover:border-border-bright focus:border-border-focus focus:outline-none cursor-pointer disabled:cursor-default disabled:opacity-40";

function getNativeSelectClassName({
	size = "md",
	fill = false,
	withCustomChevron = false,
	className,
}: {
	size?: "sm" | "md";
	fill?: boolean;
	withCustomChevron?: boolean;
	className?: string;
} = {}): string {
	return cn(
		nativeSelectBaseClassName,
		size === "sm" ? "h-7 text-[12px]" : "h-8 text-[13px]",
		withCustomChevron ? "appearance-none pl-2 pr-7" : "px-2",
		fill && "w-full",
		className,
	);
}

interface NativeSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
	size?: "sm" | "md";
	fill?: boolean;
	containerClassName?: string;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
	{ size = "md", fill = false, containerClassName, className, children, ...props },
	ref,
) {
	return (
		<div className={cn("relative inline-flex max-w-full", fill && "w-full", containerClassName)}>
			<select
				ref={ref}
				className={getNativeSelectClassName({
					size,
					fill,
					withCustomChevron: true,
					className,
				})}
				{...props}
			>
				{children}
			</select>
			<ChevronDown
				size={14}
				aria-hidden
				className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
			/>
		</div>
	);
});
