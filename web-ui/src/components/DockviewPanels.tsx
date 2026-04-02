// ── Dockview-powered panel layout ──

import {
	type DockviewApi,
	DockviewReact,
	type DockviewReadyEvent,
	type IDockviewPanelProps,
	themeDark,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import { useCallback, useRef } from "react";

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
	const apiRef = useRef<DockviewApi | null>(null);

	const handleReady = useCallback(
		(event: DockviewReadyEvent) => {
			apiRef.current = event.api;

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
			<style>{`
				/* Hide close button on tabs */
				.dv-default-tab-action { display: none !important; }
				/* Transparent tab backgrounds + padding */
				.dv-tab { background-color: transparent !important; padding: 0 16px !important; }
				/* Instant sash color on resize */
				.dockview-theme-dark {
					--dv-active-sash-color: rgba(0, 132, 255, 0.35) !important;
					--dv-active-sash-transition-duration: 0s !important;
					--dv-active-sash-transition-delay: 0s !important;
				}
				/* Ensure panel content fills available space */
				.dv-content-container > div {
					height: 100% !important;
					display: flex !important;
					flex-direction: column !important;
				}
			`}</style>
			<DockviewReact components={components} onReady={handleReady} theme={themeDark} disableFloatingGroups />
		</div>
	);
}
