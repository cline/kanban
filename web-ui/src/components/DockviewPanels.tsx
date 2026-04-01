// ── Dockview-powered panel layout with Kanban dark theme ──

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

// ── Kanban theme: override dockview CSS variables to match our dark theme ──

const KANBAN_THEME_OVERRIDES: React.CSSProperties = {
	// Tab bar
	"--dv-tabs-and-actions-container-background-color": "var(--color-surface-1)",
	"--dv-tabs-and-actions-container-height": "32px",
	"--dv-tabs-and-actions-container-font-size": "12px",
	// Active group, visible tab (selected)
	"--dv-activegroup-visiblepanel-tab-background-color": "var(--color-surface-1)",
	"--dv-activegroup-visiblepanel-tab-color": "var(--color-text-primary)",
	// Active group, hidden tabs (not selected)
	"--dv-activegroup-hiddenpanel-tab-background-color": "var(--color-surface-1)",
	"--dv-activegroup-hiddenpanel-tab-color": "var(--color-text-tertiary)",
	// Inactive group tabs
	"--dv-inactivegroup-visiblepanel-tab-background-color": "var(--color-surface-1)",
	"--dv-inactivegroup-visiblepanel-tab-color": "var(--color-text-secondary)",
	"--dv-inactivegroup-hiddenpanel-tab-background-color": "var(--color-surface-1)",
	"--dv-inactivegroup-hiddenpanel-tab-color": "var(--color-text-tertiary)",
	// Tab divider
	"--dv-tab-divider-color": "transparent",
	// Panel content background
	"--dv-group-view-background-color": "var(--color-surface-0)",
	// Separator / sash
	"--dv-separator-border": "var(--color-border)",
	"--dv-sash-color": "transparent",
	"--dv-active-sash-color": "var(--color-accent)",
	"--dv-active-sash-transition-duration": "0s",
	"--dv-active-sash-transition-delay": "0s",
	// Drag overlay
	"--dv-drag-over-background-color": "rgba(0, 132, 255, 0.1)",
	"--dv-drag-over-border-color": "var(--color-accent)",
	// Scrollbar
	"--dv-scrollbar-background-color": "var(--color-surface-4)",
	// Icon hover
	"--dv-icon-hover-background-color": "var(--color-surface-3)",
} as React.CSSProperties;

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

			// Forward layout changes for persistence
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
		<div className={className} style={{ ...KANBAN_THEME_OVERRIDES, height: "100%", width: "100%" }}>
			<style>{`
				.dv-default-tab-action { display: none !important; }
				.dockview-theme-dark {
					--dv-active-sash-color: rgba(0, 132, 255, 0.35) !important;
					--dv-active-sash-transition-duration: 0s !important;
					--dv-active-sash-transition-delay: 0s !important;
				}
			`}</style>
			<DockviewReact components={components} onReady={handleReady} theme={themeDark} disableFloatingGroups />
		</div>
	);
}
