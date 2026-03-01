import { Classes, Colors, Icon } from "@blueprintjs/core";
import type { CSSProperties } from "react";

export function GitStatusLabel({
	branchLabel,
	changedFiles,
	additions,
	deletions,
	style,
}: {
	branchLabel: string;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
	style?: CSSProperties;
}): React.ReactElement {
	const hasChangeSummary = typeof changedFiles === "number";
	const fileLabel = changedFiles === 1 ? "file" : "files";
	return (
		<span
			className={Classes.MONOSPACE_TEXT}
			style={{
				fontSize: "var(--bp-typography-size-body-small)",
				color: Colors.GRAY4,
				marginRight: 4,
				...style,
			}}
		>
			<Icon icon="git-branch" size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
			<span style={{ color: Colors.LIGHT_GRAY5 }}>{branchLabel}</span>
			{hasChangeSummary ? (
				<span style={{ marginLeft: 6 }}>
					<span style={{ color: Colors.GRAY3 }}>({changedFiles} {fileLabel}</span>
					<span style={{ color: Colors.GREEN4 }}> +{additions ?? 0}</span>
					<span style={{ color: Colors.RED4 }}> -{deletions ?? 0}</span>
					<span style={{ color: Colors.GRAY3 }}>)</span>
				</span>
			) : null}
		</span>
	);
}
