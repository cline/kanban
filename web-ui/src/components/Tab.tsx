// ── Single tab button with native HTML drag support ──

import { X } from "lucide-react";
import { useCallback } from "react";
import { cn } from "@/components/ui/cn";
import { useDragContext } from "./dynamic-panels/DragContext";
import type { TabData } from "./dynamic-panels/layoutTypes";

interface TabProps {
	tab: TabData;
	panelId: string;
	isActive: boolean;
	onActivate: () => void;
	onClose?: () => void;
	onContextMenu?: (e: React.MouseEvent) => void;
}

export function Tab({ tab, panelId, isActive, onActivate, onClose, onContextMenu }: TabProps) {
	const { drag, setDrag } = useDragContext();

	const onDragStart = useCallback(
		(e: React.DragEvent) => {
			e.dataTransfer.effectAllowed = "move";
			e.dataTransfer.setData("text/plain", tab.id);
			// Slight delay so the browser captures the element before we update state
			requestAnimationFrame(() => {
				setDrag((d) => ({
					...d,
					payload: { tabId: tab.id, tabTitle: tab.title, sourcePanelId: panelId },
				}));
			});
		},
		[tab, panelId, setDrag],
	);

	const onDragEnd = useCallback(() => {
		setDrag(() => ({
			payload: null,
			dropTarget: null,
			tabBarTarget: null,
			edgeTarget: null,
		}));
	}, [setDrag]);

	const isDragging = drag.payload?.tabId === tab.id;

	return (
		<div
			draggable
			onDragStart={onDragStart}
			onDragEnd={onDragEnd}
			role="tab"
			aria-selected={isActive}
			className={cn(
				"group flex items-center gap-1.5 px-3 h-8.5 text-xs cursor-grab",
				"border-r border-border/60 select-none whitespace-nowrap",
				"transition-colors duration-75",
				isActive
					? "bg-surface-2 text-text-primary"
					: "bg-transparent text-text-secondary hover:bg-surface-1 hover:text-text-primary",
				isDragging && "opacity-40",
			)}
			onClick={onActivate}
			onContextMenu={onContextMenu}
		>
			<span className="truncate max-w-35">{tab.title}</span>
			{tab.closable && (
				<button
					type="button"
					aria-label={`Close ${tab.title}`}
					className={cn(
						"rounded-sm p-0.5 transition-colors duration-75 shrink-0",
						"opacity-0 group-hover:opacity-100",
						isActive && "opacity-50",
						"hover:bg-surface-4 hover:text-text-primary",
					)}
					onClick={(e) => {
						e.stopPropagation();
						onClose?.();
					}}
				>
					<X size={12} />
				</button>
			)}
		</div>
	);
}
