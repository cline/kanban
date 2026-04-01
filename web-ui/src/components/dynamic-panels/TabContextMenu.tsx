// ── Right-click context menu for tabs ──

import { ArrowRightFromLine, Columns2, Rows2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/components/ui/cn";
import { useLayoutDispatch } from "./LayoutContext";
import type { PanelNode, TabData } from "./layoutTypes";

interface TabContextMenuProps {
	tab: TabData;
	panelId: string;
	panelTabs: TabData[];
	otherPanels: PanelNode[];
	position: { x: number; y: number };
	onClose: () => void;
}

export function TabContextMenu({ tab, panelId, panelTabs, otherPanels, position, onClose }: TabContextMenuProps) {
	const dispatch = useLayoutDispatch();
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on click outside or Escape
	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("mousedown", handleClick);
		document.addEventListener("keydown", handleKey);
		return () => {
			document.removeEventListener("mousedown", handleClick);
			document.removeEventListener("keydown", handleKey);
		};
	}, [onClose]);

	const act = useCallback(
		(fn: () => void) => {
			fn();
			onClose();
		},
		[onClose],
	);

	const tabIndex = panelTabs.findIndex((t) => t.id === tab.id);
	const closableTabs = panelTabs.filter((t) => t.closable && t.id !== tab.id);
	const tabsToRight = panelTabs.slice(tabIndex + 1).filter((t) => t.closable);

	return createPortal(
		<div
			ref={menuRef}
			className="fixed z-50 min-w-48 rounded-md border border-border bg-surface-1 py-1 shadow-xl text-xs"
			style={{ top: position.y, left: position.x }}
		>
			{/* Close */}
			{tab.closable && (
				<MenuItem
					icon={<X size={14} />}
					label="Close"
					onClick={() => act(() => dispatch({ type: "REMOVE_TAB", panelId, tabId: tab.id }))}
				/>
			)}

			{/* Close others */}
			{closableTabs.length > 0 && (
				<MenuItem
					icon={<XCircle size={14} />}
					label="Close Others"
					onClick={() =>
						act(() => {
							for (const t of closableTabs) {
								dispatch({ type: "REMOVE_TAB", panelId, tabId: t.id });
							}
						})
					}
				/>
			)}

			{/* Close to the right */}
			{tabsToRight.length > 0 && (
				<MenuItem
					label="Close to the Right"
					onClick={() =>
						act(() => {
							for (const t of tabsToRight) {
								dispatch({ type: "REMOVE_TAB", panelId, tabId: t.id });
							}
						})
					}
				/>
			)}

			<Separator />

			{/* Split right */}
			<MenuItem
				icon={<Columns2 size={14} />}
				label="Split Right"
				onClick={() =>
					act(() =>
						dispatch({
							type: "SPLIT_PANEL",
							panelId,
							direction: "horizontal",
							tabToMove: tab,
						}),
					)
				}
			/>

			{/* Split down */}
			<MenuItem
				icon={<Rows2 size={14} />}
				label="Split Down"
				onClick={() =>
					act(() =>
						dispatch({
							type: "SPLIT_PANEL",
							panelId,
							direction: "vertical",
							tabToMove: tab,
						}),
					)
				}
			/>

			{/* Move to panel */}
			{otherPanels.length > 0 && (
				<>
					<Separator />
					<div className="px-2 py-1 text-text-tertiary text-[10px] uppercase tracking-wider">Move to panel</div>
					{otherPanels.map((target) => {
						const label = target.tabs.length > 0 ? target.tabs.map((t) => t.title).join(", ") : "Empty panel";
						return (
							<MenuItem
								key={target.id}
								icon={<ArrowRightFromLine size={14} />}
								label={label}
								onClick={() =>
									act(() =>
										dispatch({
											type: "MOVE_TAB",
											tabId: tab.id,
											fromPanelId: panelId,
											toPanelId: target.id,
										}),
									)
								}
							/>
						);
					})}
				</>
			)}
		</div>,
		document.body,
	);
}

// ── Small internal primitives ──

function MenuItem({ icon, label, onClick }: { icon?: React.ReactNode; label: string; onClick: () => void }) {
	return (
		<button
			type="button"
			className={cn(
				"flex w-full items-center gap-2 px-3 py-1.5 text-left text-text-primary",
				"hover:bg-surface-3 transition-colors duration-75 cursor-pointer",
			)}
			onClick={onClick}
		>
			{icon && <span className="text-text-secondary shrink-0">{icon}</span>}
			<span className="truncate">{label}</span>
		</button>
	);
}

function Separator() {
	return <div className="my-1 h-px bg-border" />;
}
