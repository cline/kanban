// ── Renders a PanelNode: tab bar + content area ──
// Drop targets: tab bar (insertion indicator) + content area (5-zone split overlay).

import { useCallback, useRef, useState } from "react";
import { Tab } from "@/components/Tab";
import { type DropZone, useDragContext } from "./DragContext";
import { DropOverlay, hitTestDropZone } from "./DropOverlay";
import { useLayoutContext } from "./LayoutContext";
import { collectPanels } from "./layoutHelpers";
import type { PanelNode, TabData } from "./layoutTypes";
import { TabContextMenu } from "./TabContextMenu";
import { useKeyboardNavigation } from "./useKeyboardNavigation";

interface PanelViewProps {
	node: PanelNode;
	layoutRoot?: import("./layoutTypes").LayoutNode;
}

export function PanelView({ node, layoutRoot }: PanelViewProps) {
	const { dispatch, renderTabContent } = useLayoutContext();
	const { drag, setDrag } = useDragContext();

	// Context menu
	const [ctxMenu, setCtxMenu] = useState<{ tab: TabData; x: number; y: number } | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const tabBarRef = useRef<HTMLDivElement>(null);

	// Tab bar insertion indicator position (px from left edge of tab bar)
	const [insertIndicatorX, setInsertIndicatorX] = useState<number | null>(null);

	useKeyboardNavigation(node, dispatch, panelRef);

	const handleTabContextMenu = useCallback((e: React.MouseEvent, tab: TabData) => {
		e.preventDefault();
		setCtxMenu({ tab, x: e.clientX, y: e.clientY });
	}, []);

	const otherPanels = layoutRoot ? collectPanels(layoutRoot).filter((p) => p.id !== node.id) : [];

	// ── Content area drop handlers (5-zone overlay) ──

	const isDragging = drag.payload !== null;
	const isOverThisPanel = drag.dropTarget?.panelId === node.id;
	const activeZone: DropZone | null = isOverThisPanel ? drag.dropTarget!.zone : null;

	const onContentDragOver = useCallback(
		(e: React.DragEvent) => {
			if (!drag.payload) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "move";

			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const zone = hitTestDropZone(e.clientX, e.clientY, rect);

			setDrag((d) => ({
				...d,
				dropTarget: { panelId: node.id, zone },
				tabBarTarget: null,
			}));
		},
		[drag.payload, node.id, setDrag],
	);

	const onContentDragLeave = useCallback(
		(e: React.DragEvent) => {
			// Only clear if actually leaving this element (not entering a child)
			if (e.currentTarget.contains(e.relatedTarget as Node)) return;
			setDrag((d) => (d.dropTarget?.panelId === node.id ? { ...d, dropTarget: null } : d));
		},
		[node.id, setDrag],
	);

	const resetDrag = useCallback(() => {
		setDrag(() => ({ payload: null, dropTarget: null, tabBarTarget: null }));
	}, [setDrag]);

	const onContentDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			if (!drag.payload || !drag.dropTarget || drag.dropTarget.panelId !== node.id) {
				resetDrag();
				return;
			}

			const { tabId, sourcePanelId } = drag.payload;
			const { zone } = drag.dropTarget;

			const direction: "horizontal" | "vertical" = zone === "left" || zone === "right" ? "horizontal" : "vertical";
			const allPanels = layoutRoot ? collectPanels(layoutRoot) : [];
			const srcPanel = allPanels.find((p) => p.id === sourcePanelId);
			const tabData = srcPanel?.tabs.find((t) => t.id === tabId);
			if (tabData) {
				if (sourcePanelId !== node.id) {
					dispatch({ type: "REMOVE_TAB", panelId: sourcePanelId, tabId });
				}
				dispatch({
					type: "SPLIT_PANEL",
					panelId: node.id,
					direction,
					tabToMove: sourcePanelId === node.id ? tabData : undefined,
					newTabData: sourcePanelId !== node.id ? tabData : undefined,
					position: zone === "left" || zone === "top" ? "before" : "after",
				});
			}
			resetDrag();
		},
		[drag.payload, drag.dropTarget, node.id, dispatch, layoutRoot, resetDrag],
	);

	// ── Tab bar drop handlers (insertion indicator) ──

	const computeInsertIndex = useCallback(
		(clientX: number): number => {
			if (!tabBarRef.current) return node.tabs.length;
			const tabs = tabBarRef.current.querySelectorAll<HTMLElement>("[role='tab']");
			for (let i = 0; i < tabs.length; i++) {
				const rect = tabs[i]!.getBoundingClientRect();
				if (clientX < rect.left + rect.width / 2) return i;
			}
			return node.tabs.length;
		},
		[node.tabs.length],
	);

	const onTabBarDragOver = useCallback(
		(e: React.DragEvent) => {
			if (!drag.payload) return;
			e.preventDefault();
			e.stopPropagation();
			e.dataTransfer.dropEffect = "move";

			const idx = computeInsertIndex(e.clientX);

			// Compute indicator x position
			if (tabBarRef.current) {
				const tabs = tabBarRef.current.querySelectorAll<HTMLElement>("[role='tab']");
				let x: number;
				if (tabs.length === 0) {
					x = 0;
				} else if (idx >= tabs.length) {
					const last = tabs[tabs.length - 1]!.getBoundingClientRect();
					const barRect = tabBarRef.current.getBoundingClientRect();
					x = last.right - barRect.left;
				} else {
					const target = tabs[idx]!.getBoundingClientRect();
					const barRect = tabBarRef.current.getBoundingClientRect();
					x = target.left - barRect.left;
				}
				setInsertIndicatorX(x);
			}

			setDrag((d) => ({
				...d,
				dropTarget: null,
				tabBarTarget: { panelId: node.id, index: idx },
			}));
		},
		[drag.payload, node.id, computeInsertIndex, setDrag],
	);

	const onTabBarDragLeave = useCallback(
		(e: React.DragEvent) => {
			if (e.currentTarget.contains(e.relatedTarget as Node)) return;
			setInsertIndicatorX(null);
			setDrag((d) => (d.tabBarTarget?.panelId === node.id ? { ...d, tabBarTarget: null } : d));
		},
		[node.id, setDrag],
	);

	const onTabBarDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setInsertIndicatorX(null);
			if (!drag.payload || !drag.tabBarTarget || drag.tabBarTarget.panelId !== node.id) {
				resetDrag();
				return;
			}

			const { tabId, sourcePanelId } = drag.payload;
			const { index } = drag.tabBarTarget;

			if (sourcePanelId === node.id) {
				const fromIndex = node.tabs.findIndex((t) => t.id === tabId);
				if (fromIndex !== -1 && fromIndex !== index) {
					dispatch({
						type: "REORDER_TABS",
						panelId: node.id,
						fromIndex,
						toIndex: index > fromIndex ? index - 1 : index,
					});
				}
			} else {
				dispatch({ type: "MOVE_TAB", tabId, fromPanelId: sourcePanelId, toPanelId: node.id, toIndex: index });
			}
			resetDrag();
		},
		[drag.payload, drag.tabBarTarget, node, dispatch, resetDrag],
	);

	// ── Render ──

	const activeTab = node.tabs.find((t) => t.id === node.activeTabId) ?? null;
	const showTabBarIndicator = isDragging && drag.tabBarTarget?.panelId === node.id && insertIndicatorX !== null;

	return (
		<div ref={panelRef} className="flex flex-col h-full w-full min-w-0 min-h-0 bg-surface-0">
			{/* Tab bar */}
			<div
				ref={tabBarRef}
				className="relative flex items-stretch border-b border-border bg-surface-1 h-8 shrink-0 overflow-hidden"
				onDragOver={onTabBarDragOver}
				onDragLeave={onTabBarDragLeave}
				onDrop={onTabBarDrop}
			>
				{/* Tabs */}
				<div className="flex-1 flex items-stretch overflow-x-auto min-w-0" role="tablist">
					{node.tabs.map((tab) => (
						<Tab
							key={tab.id}
							tab={tab}
							panelId={node.id}
							isActive={tab.id === node.activeTabId}
							onActivate={() => dispatch({ type: "SET_ACTIVE_TAB", panelId: node.id, tabId: tab.id })}
							onClose={
								tab.closable
									? () => dispatch({ type: "REMOVE_TAB", panelId: node.id, tabId: tab.id })
									: undefined
							}
							onContextMenu={(e) => handleTabContextMenu(e, tab)}
						/>
					))}
				</div>

				{/* Insertion indicator (vertical bar) */}
				{showTabBarIndicator && (
					<div
						className="absolute top-0 bottom-0 w-0.5 bg-accent z-20 pointer-events-none"
						style={{ left: insertIndicatorX ?? 0 }}
					/>
				)}
			</div>

			{/* Content area (drop target) — flex column so children can stretch to fill */}
			<div
				className="relative flex flex-col flex-1 min-h-0 overflow-hidden"
				role="tabpanel"
				onDragOver={onContentDragOver}
				onDragLeave={onContentDragLeave}
				onDrop={onContentDrop}
			>
				{activeTab && renderTabContent ? (
					renderTabContent(activeTab, node.id)
				) : activeTab ? (
					<div className="flex items-center justify-center h-full text-text-tertiary text-sm select-none">
						{activeTab.title}
					</div>
				) : (
					<div className="flex items-center justify-center h-full text-text-tertiary text-xs select-none">
						No tabs open
					</div>
				)}

				{/* 5-zone drop overlay */}
				{isDragging && <DropOverlay activeZone={activeZone} />}
			</div>

			{/* Context menu */}
			{ctxMenu && (
				<TabContextMenu
					tab={ctxMenu.tab}
					panelId={node.id}
					panelTabs={node.tabs}
					otherPanels={otherPanels}
					position={{ x: ctxMenu.x, y: ctxMenu.y }}
					onClose={() => setCtxMenu(null)}
				/>
			)}
		</div>
	);
}
