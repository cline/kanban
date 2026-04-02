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
import { cn } from "@/components/ui/cn";

export interface PanelComponentProps {
	[key: string]: unknown;
}

type PanelComponents = Record<string, React.FC<IDockviewPanelProps<PanelComponentProps>>>;

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
		<div className={cn("h-full w-full", className)}>
			<DockviewReact components={components} onReady={handleReady} theme={themeDark} disableFloatingGroups />
		</div>
	);
}
