import * as RadixPopover from "@radix-ui/react-popover";
import { type ReactElement, type ReactNode, useCallback, useEffect, useRef } from "react";

import { cn } from "@/components/ui/cn";

export interface InlineCompletionItem {
	id: string;
	label: string;
	detail?: string;
}

interface InlineCompletionPickerProps {
	open: boolean;
	items: InlineCompletionItem[];
	selectedIndex: number;
	onSelectItem: (item: InlineCompletionItem, index: number) => void;
	onHoverItem: (index: number) => void;
	isLoading?: boolean;
	loadingMessage?: string;
	emptyMessage?: string | null;
	side?: "top" | "bottom";
	children: ReactNode;
}

export function InlineCompletionPicker({
	open,
	items,
	selectedIndex,
	onSelectItem,
	onHoverItem,
	isLoading = false,
	loadingMessage = "Loading...",
	emptyMessage = null,
	side,
	children,
}: InlineCompletionPickerProps): ReactElement {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const itemRefs = useRef(new Map<string, HTMLButtonElement>());

	const setItemRef = useCallback((key: string, node: HTMLButtonElement | null) => {
		if (node) {
			itemRefs.current.set(key, node);
			return;
		}
		itemRefs.current.delete(key);
	}, []);

	useEffect(() => {
		if (!open) {
			return;
		}
		const activeItem = items[selectedIndex];
		if (!activeItem) {
			return;
		}
		const activeElement = itemRefs.current.get(activeItem.id);
		const menuElement = menuRef.current;
		if (!activeElement || !menuElement) {
			return;
		}
		const activeTop = activeElement.offsetTop;
		const activeBottom = activeTop + activeElement.offsetHeight;
		const viewportTop = menuElement.scrollTop;
		const viewportBottom = viewportTop + menuElement.clientHeight;
		if (activeBottom > viewportBottom) {
			menuElement.scrollTop = activeBottom - menuElement.clientHeight;
			return;
		}
		if (activeTop < viewportTop) {
			menuElement.scrollTop = activeTop;
		}
	}, [items, open, selectedIndex]);

	return (
		<RadixPopover.Root open={open}>
			<RadixPopover.Anchor asChild>{children}</RadixPopover.Anchor>
			<RadixPopover.Portal>
				<RadixPopover.Content
					className="z-50 overflow-hidden rounded-lg border border-border bg-surface-1 shadow-xl"
					style={{ width: "var(--radix-popover-trigger-width, var(--radix-popover-anchor-width))" }}
					side={side}
					avoidCollisions={side === undefined}
					sideOffset={4}
					align="start"
					onOpenAutoFocus={(event) => event.preventDefault()}
					onCloseAutoFocus={(event) => event.preventDefault()}
				>
					{isLoading ? (
						<div className="px-2.5 py-1.5 text-[13px] text-text-tertiary">{loadingMessage}</div>
					) : items.length === 0 && emptyMessage ? (
						<div className="px-2.5 py-1.5 text-[13px] text-text-tertiary">{emptyMessage}</div>
					) : (
						<div ref={menuRef} className="max-h-56 overflow-x-hidden overflow-y-auto p-1">
							{items.map((item, index) => (
								<button
									type="button"
									key={item.id}
									ref={(node) => setItemRef(item.id, node)}
									className={cn(
										"flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
										index === selectedIndex ? "bg-surface-3" : "hover:bg-surface-3",
									)}
									onMouseDown={(event) => {
										event.preventDefault();
										onSelectItem(item, index);
									}}
									onMouseEnter={() => onHoverItem(index)}
								>
									<div className="min-w-0 flex-1">
										<div
											className="text-xs leading-tight text-text-primary"
											style={{
												overflowWrap: "anywhere",
												wordBreak: "break-word",
												whiteSpace: "normal",
											}}
										>
											{item.label}
										</div>
										{item.detail ? (
											<div className="truncate text-xs text-text-secondary">{item.detail}</div>
										) : null}
									</div>
								</button>
							))}
						</div>
					)}
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
