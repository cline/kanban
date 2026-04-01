// ── Root component for the dynamic split-panel layout ──

import { useCallback, useMemo, useReducer, useState } from "react";
import { cn } from "@/components/ui/cn";
import { DragProvider, type DragState, INITIAL_DRAG_STATE } from "./dynamic-panels/DragContext";
import { LayoutProvider } from "./dynamic-panels/LayoutContext";
import { LayoutNodeView } from "./dynamic-panels/LayoutNodeView";
import { layoutReducer } from "./dynamic-panels/layoutReducer";
import type { LayoutState, TabData } from "./dynamic-panels/layoutTypes";
import { loadPersistedLayout, usePersistLayout } from "./dynamic-panels/useLayoutPersistence";

// ── Props ──

interface DynamicPanelsProps {
	/** Initial layout tree. Falls back to persisted layout, then an empty panel. */
	initialLayout: LayoutState;
	/** Render the content for a given tab. Switch on `tab.id` to map to your components. */
	renderTabContent?: (tab: TabData, panelId: string) => React.ReactNode;
	/** localStorage key for persisting layout. If omitted, layout is not persisted. */
	persistenceKey?: string;
	className?: string;
}

// ── Component ──

function DynamicPanels({ initialLayout, renderTabContent, persistenceKey, className }: DynamicPanelsProps) {
	const [state, dispatch] = useReducer(
		layoutReducer,
		persistenceKey ? (loadPersistedLayout(persistenceKey) ?? initialLayout) : initialLayout,
	);

	usePersistLayout(state, persistenceKey);

	const layoutCtx = useMemo(() => ({ dispatch, renderTabContent }), [dispatch, renderTabContent]);

	// Native drag state
	const [drag, setDragRaw] = useState<DragState>(INITIAL_DRAG_STATE);
	const setDrag = useCallback((updater: (prev: DragState) => DragState) => {
		setDragRaw(updater);
	}, []);
	const dragCtx = useMemo(() => ({ drag, setDrag }), [drag, setDrag]);

	return (
		<LayoutProvider value={layoutCtx}>
			<DragProvider value={dragCtx}>
				<div className={cn("h-full w-full overflow-hidden bg-surface-0", className)}>
					<LayoutNodeView node={state.root} layoutRoot={state.root} />
				</div>
			</DragProvider>
		</LayoutProvider>
	);
}

export default DynamicPanels;
