import { motion, type UseInViewOptions, useInView } from "motion/react";
import type React from "react";
import { useMemo, useRef } from "react";
import { cn } from "@/components/ui/cn";

interface ShimmeringTextProps {
	text: string;
	duration?: number;
	delay?: number;
	repeat?: boolean;
	repeatDelay?: number;
	className?: string;
	startOnView?: boolean;
	once?: boolean;
	inViewMargin?: UseInViewOptions["margin"];
	spread?: number;
	color?: string;
	shimmerColor?: string;
}

export function ShimmeringText({
	text,
	duration = 2,
	delay = 0,
	repeat = true,
	repeatDelay = 0.5,
	className,
	startOnView = true,
	once = false,
	inViewMargin,
	spread = 2,
	color,
	shimmerColor,
}: ShimmeringTextProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const isInView = useInView(ref, { once, margin: inViewMargin });

	const dynamicSpread = useMemo(() => {
		return text.length * spread;
	}, [text, spread]);

	const shouldAnimate = !startOnView || isInView;

	return (
		<motion.span
			ref={ref}
			className={cn(
				"relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
				"[--base-color:#6E7681] [--shimmer-color:#C9D1D9]",
				"[background-repeat:no-repeat,padding-box]",
				"[--shimmer-bg:linear-gradient(90deg,transparent_calc(50%-var(--spread)),var(--shimmer-color),transparent_calc(50%+var(--spread)))]",
				className,
			)}
			style={
				{
					"--spread": `${dynamicSpread}px`,
					...(color && { "--base-color": color }),
					...(shimmerColor && { "--shimmer-color": shimmerColor }),
					backgroundImage: "var(--shimmer-bg), linear-gradient(var(--base-color), var(--base-color))",
				} as React.CSSProperties
			}
			initial={{
				backgroundPosition: "125% center",
			}}
			animate={
				shouldAnimate
					? {
							backgroundPosition: "-25% center",
						}
					: {}
			}
			transition={{
				backgroundPosition: {
					repeat: repeat ? Infinity : 0,
					duration,
					delay,
					repeatDelay,
					ease: "linear",
				},
			}}
		>
			{text}
		</motion.span>
	);
}
