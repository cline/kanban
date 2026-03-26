import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement, ReactNode } from "react";
import { cloneElement, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/components/ui/cn";

export interface ContextMenuItem {
	id: string;
	label: string;
	onSelect: () => void;
	disabled?: boolean;
	danger?: boolean;
}

interface ContextMenuPosition {
	x: number;
	y: number;
}

const MENU_WIDTH_PX = 220;
const MENU_HEIGHT_PADDING_PX = 16;
const MENU_ITEM_HEIGHT_PX = 36;
const VIEWPORT_MARGIN_PX = 12;

const TaskAgentReviewTriggerContext = createContext<((taskId: string) => void) | null>(null);

export function TaskAgentReviewTriggerProvider({
	children,
	onTrigger,
}: {
	children: ReactNode;
	onTrigger: ((taskId: string) => void) | null;
}): ReactElement {
	return <TaskAgentReviewTriggerContext.Provider value={onTrigger}>{children}</TaskAgentReviewTriggerContext.Provider>;
}

export function useTaskAgentReviewTrigger(): ((taskId: string) => void) | null {
	return useContext(TaskAgentReviewTriggerContext);
}

function clampMenuPosition(position: ContextMenuPosition, itemCount: number): ContextMenuPosition {
	if (typeof window === "undefined") {
		return position;
	}

	const estimatedHeight = MENU_HEIGHT_PADDING_PX + itemCount * MENU_ITEM_HEIGHT_PX;
	const maxX = Math.max(VIEWPORT_MARGIN_PX, window.innerWidth - MENU_WIDTH_PX - VIEWPORT_MARGIN_PX);
	const maxY = Math.max(VIEWPORT_MARGIN_PX, window.innerHeight - estimatedHeight - VIEWPORT_MARGIN_PX);

	return {
		x: Math.min(Math.max(position.x, VIEWPORT_MARGIN_PX), maxX),
		y: Math.min(Math.max(position.y, VIEWPORT_MARGIN_PX), maxY),
	};
}

export function ContextMenu({
	children,
	items,
	disabled = false,
	ariaLabel = "Context menu",
}: {
	children: ReactElement<{
		onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
		onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
	}>;
	items: ContextMenuItem[];
	disabled?: boolean;
	ariaLabel?: string;
}): ReactElement {
	const [isOpen, setIsOpen] = useState(false);
	const [position, setPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 });
	const menuRef = useRef<HTMLDivElement | null>(null);

	const closeMenu = () => {
		setIsOpen(false);
	};

	const openMenuAt = (nextPosition: ContextMenuPosition) => {
		if (disabled || items.length === 0) {
			return;
		}
		setPosition(clampMenuPosition(nextPosition, items.length));
		setIsOpen(true);
	};

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const menu = menuRef.current;
		const firstButton = menu?.querySelector<HTMLButtonElement>("button:not(:disabled)");
		firstButton?.focus();

		const handlePointerDown = (event: MouseEvent) => {
			if (menuRef.current?.contains(event.target as Node)) {
				return;
			}
			closeMenu();
		};
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				closeMenu();
			}
		};
		const handleResize = () => {
			closeMenu();
		};

		window.addEventListener("mousedown", handlePointerDown);
		window.addEventListener("contextmenu", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("resize", handleResize);
		window.addEventListener("blur", handleResize);

		return () => {
			window.removeEventListener("mousedown", handlePointerDown);
			window.removeEventListener("contextmenu", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("resize", handleResize);
			window.removeEventListener("blur", handleResize);
		};
	}, [isOpen]);

	const wrappedChild = useMemo(() => {
		return cloneElement(children, {
			onContextMenu: (event: ReactMouseEvent<HTMLElement>) => {
				children.props.onContextMenu?.(event);
				if (event.defaultPrevented) {
					return;
				}
				event.preventDefault();
				openMenuAt({
					x: event.clientX,
					y: event.clientY,
				});
			},
			onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
				children.props.onKeyDown?.(event);
				if (event.defaultPrevented) {
					return;
				}
				if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
					event.preventDefault();
					const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
					openMenuAt({
						x: rect.left + Math.min(rect.width / 2, MENU_WIDTH_PX / 2),
						y: rect.top + Math.min(rect.height / 2, MENU_ITEM_HEIGHT_PX),
					});
				}
			},
		});
	}, [children, items.length, disabled]);

	return (
		<>
			{wrappedChild}
			{isOpen
				? createPortal(
						<div
							ref={menuRef}
							role="menu"
							aria-label={ariaLabel}
							className="fixed z-[100] min-w-[220px] rounded-lg border border-border-bright bg-surface-1 p-1 shadow-lg"
							style={{
								left: position.x,
								top: position.y,
							}}
						>
							{items.map((item) => (
								<button
									key={item.id}
									type="button"
									role="menuitem"
									disabled={item.disabled}
									className={cn(
										"flex min-h-9 w-full items-center rounded-md px-3 text-left text-sm text-text-primary transition-colors",
										"hover:bg-surface-3 focus-visible:bg-surface-3 focus-visible:outline-none",
										item.danger && "text-status-red",
										item.disabled && "cursor-not-allowed opacity-50",
									)}
									onClick={() => {
										if (item.disabled) {
											return;
										}
										closeMenu();
										item.onSelect();
									}}
								>
									{item.label}
								</button>
							))}
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
