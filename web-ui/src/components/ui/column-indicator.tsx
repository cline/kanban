import { columnIndicatorColors } from "@/data/column-colors";

export function ColumnIndicator({ columnId, size = 14 }: { columnId: string; size?: number }): React.ReactElement {
	const color = columnIndicatorColors[columnId] ?? "var(--color-text-tertiary)";
	const r = size * 0.4;
	const cx = size / 2;
	const cy = size / 2;
	const strokeWidth = size * 0.15;

	if (columnId === "backlog") {
		return (
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />
			</svg>
		);
	}
	if (columnId === "in_progress") {
		const top = cy - r;
		const bottom = cy + r;
		return (
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />
				<path d={`M${cx} ${top} A${r} ${r} 0 0 0 ${cx} ${bottom} Z`} fill={color} />
			</svg>
		);
	}
	if (columnId === "review") {
		const top = cy - r;
		const right = cx + r;
		return (
			<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
				<circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={strokeWidth} />
				<path d={`M${cx} ${top} A${r} ${r} 0 1 0 ${right} ${cy} L${cx} ${cy} Z`} fill={color} />
			</svg>
		);
	}
	return (
		<svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
			<circle cx={cx} cy={cy} r={r + strokeWidth / 2} fill={color} />
		</svg>
	);
}
