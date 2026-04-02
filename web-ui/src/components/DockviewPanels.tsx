// ── Dockview-powered panel layout ──

import {
	type DockviewApi,
	DockviewReact,
	type DockviewReadyEvent,
	type IDockviewPanelProps,
	themeDark,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "@/components/dockview-overrides.css";
import { useCallback } from "react";

// ── Panel component registration ──

export interface PanelComponentProps {
	[key: string]: unknown;
}

type PanelComponents = Record<string, React.FC<IDockviewPanelProps<PanelComponentProps>>>;

// ── Component ──

export interface DockviewPanelsProps {
	/** Map of component IDs to React components for panel content. */
	components: PanelComponents;
	/** Called when the dockview API is ready. Use this to add panels programmatically. */
	onReady: (event: DockviewReadyEvent) => void;
	/** Called when layout changes (for persistence). */
	onLayoutChange?: (api: DockviewApi) => void;
	className?: string;
}

export function DockviewPanels({ components, onReady, onLayoutChange, className }: DockviewPanelsProps) {
	const handleReady = useCallback(
		(event: DockviewReadyEvent) => {
			if (onLayoutChange) {
				event.api.onDidLayoutChange(() => {
					onLayoutChange(event.api);
				});
			}
			onReady(event);
		},
		[onReady, onLayoutChange],
	);

	return (
		<div className={className} style={{ height: "100%", width: "100%" }}>
			<DockviewReact components={components} onReady={handleReady} theme={themeDark} disableFloatingGroups />
		</div>
	);
}
