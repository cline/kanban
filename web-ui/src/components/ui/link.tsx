import { type AnchorHTMLAttributes, forwardRef } from "react";

import { cn } from "@/components/ui/cn";

interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
	external?: boolean;
}

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(
	{ external, className, children, ...props },
	ref,
) {
	return (
		<a
			ref={ref}
			className={cn(
				"cursor-pointer text-accent underline-offset-2 hover:text-accent-hover hover:underline",
				className,
			)}
			{...(external ? { target: "_blank", rel: "noreferrer" } : {})}
			{...props}
		>
			{children}
		</a>
	);
});
