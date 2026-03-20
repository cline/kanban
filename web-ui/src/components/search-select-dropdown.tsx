import * as RadixPopover from "@radix-ui/react-popover";
import { Fzf } from "fzf";
import { Check, ChevronDown } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode, WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { renderFuzzyHighlightedText } from "@/components/shared/render-fuzzy-highlighted-text";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";

export interface SearchSelectOption {
	value: string;
	label: string;
}

const MATCHED_TEXT_STYLE = {
	color: "var(--color-text-primary)",
	fontWeight: 600,
} as const;

export function SearchSelectDropdown({
	options,
	selectedValue,
	onSelect,
	id,
	icon,
	disabled = false,
	fill = false,
	size,
	buttonText,
	buttonClassName,
	buttonStyle,
	iconSize,
	placeholder = "Search...",
	emptyText = "No options available",
	noResultsText = "No matching results",
	showSelectedIndicator = false,
	matchTargetWidth = true,
	collisionPadding = 8,
	dropdownStyle,
	menuStyle,
	onPopoverOpenChange,
}: {
	options: readonly SearchSelectOption[];
	selectedValue?: string | null;
	onSelect: (value: string) => void;
	id?: string;
	icon?: ReactNode;
	disabled?: boolean;
	fill?: boolean;
	size?: "sm" | "md";
	buttonText?: string;
	buttonClassName?: string;
	buttonStyle?: CSSProperties;
	iconSize?: number;
	placeholder?: string;
	emptyText?: string;
	noResultsText?: string;
	showSelectedIndicator?: boolean;
	matchTargetWidth?: boolean;
	collisionPadding?: number;
	dropdownStyle?: CSSProperties;
	menuStyle?: CSSProperties;
	onPopoverOpenChange?: (isOpen: boolean) => void;
}): ReactElement {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeOptionIndex, setActiveOptionIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const orderedOptions = useMemo(() => {
		const items = options.slice();
		if (!selectedValue) {
			return items;
		}
		const selectedIndex = items.findIndex((option) => option.value === selectedValue);
		if (selectedIndex <= 0) {
			return items;
		}
		const [selectedOption] = items.splice(selectedIndex, 1);
		if (!selectedOption) {
			return items;
		}
		items.unshift(selectedOption);
		return items;
	}, [options, selectedValue]);
	const selectedOption = useMemo(
		() => orderedOptions.find((option) => option.value === selectedValue) ?? null,
		[orderedOptions, selectedValue],
	);
	const fuzzyMatches = useMemo(() => {
		if (!query.trim()) {
			return [] as ReturnType<Fzf<SearchSelectOption[]>["find"]>;
		}
		const finder = new Fzf(orderedOptions, {
			selector: (option) => option.label,
		});
		return finder.find(query);
	}, [orderedOptions, query]);
	const fuzzyMatchesByValue = useMemo(
		() => new Map(fuzzyMatches.map((match) => [match.item.value, match])),
		[fuzzyMatches],
	);
	const filteredItems = useMemo(() => {
		if (!query.trim()) {
			return orderedOptions;
		}
		return fuzzyMatches.map((entry) => entry.item);
	}, [fuzzyMatches, orderedOptions, query]);
	const resolvedButtonText = buttonText ?? selectedOption?.label ?? emptyText;

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			setIsOpen(nextOpen);
			setQuery("");
			if (!nextOpen) {
				setActiveOptionIndex(0);
			}
			onPopoverOpenChange?.(nextOpen);
		},
		[onPopoverOpenChange],
	);

	useEffect(() => {
		if (filteredItems.length === 0) {
			setActiveOptionIndex(0);
			return;
		}
		setActiveOptionIndex((currentIndex) => {
			if (currentIndex >= 0 && currentIndex < filteredItems.length) {
				return currentIndex;
			}
			if (!selectedValue) {
				return 0;
			}
			const selectedIndex = filteredItems.findIndex((option) => option.value === selectedValue);
			return selectedIndex >= 0 ? selectedIndex : 0;
		});
	}, [filteredItems, selectedValue]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const optionElement = optionRefs.current[activeOptionIndex] ?? null;
		optionElement?.scrollIntoView({ block: "nearest" });
	}, [activeOptionIndex, isOpen]);

	useEffect(() => {
		if (isOpen) {
			window.requestAnimationFrame(() => {
				inputRef.current?.focus();
			});
		}
	}, [isOpen]);

	const handleSearchInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (filteredItems.length === 0) {
			if (event.key === "Escape") {
				event.preventDefault();
				handleOpenChange(false);
			}
			return;
		}

		if (event.key === "ArrowDown") {
			event.preventDefault();
			setActiveOptionIndex((currentIndex) => Math.min(currentIndex + 1, filteredItems.length - 1));
			return;
		}

		if (event.key === "ArrowUp") {
			event.preventDefault();
			setActiveOptionIndex((currentIndex) => Math.max(currentIndex - 1, 0));
			return;
		}

		if (event.key === "Home") {
			event.preventDefault();
			setActiveOptionIndex(0);
			return;
		}

		if (event.key === "End") {
			event.preventDefault();
			setActiveOptionIndex(filteredItems.length - 1);
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			const option = filteredItems[activeOptionIndex];
			if (!option) {
				return;
			}
			onSelect(option.value);
			handleOpenChange(false);
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			handleOpenChange(false);
		}
	};

	const resolvedIconSize = typeof iconSize === "number" ? iconSize : 14;

	const handleWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
		const menu = menuRef.current;
		if (!menu || menu.scrollHeight <= menu.clientHeight) {
			return;
		}
		menu.scrollTop += event.deltaY;
		event.preventDefault();
		event.stopPropagation();
	}, []);

	const resolvedIcon = icon !== undefined ? icon : undefined;

	return (
		<RadixPopover.Root open={isOpen} onOpenChange={handleOpenChange}>
			<RadixPopover.Trigger asChild>
				<Button
					id={id}
					size={size}
					variant="default"
					fill={fill}
					icon={resolvedIcon}
					iconRight={<ChevronDown size={resolvedIconSize} />}
					disabled={disabled}
					className={cn(fill && "justify-between text-left", buttonClassName)}
					style={buttonStyle}
				>
					<span className="flex-1 truncate text-left">{resolvedButtonText}</span>
				</Button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					className="z-50 max-h-[300px] rounded-lg border border-border bg-surface-1 shadow-xl overflow-hidden"
					onWheelCapture={handleWheelCapture}
					collisionPadding={collisionPadding}
					style={{
						width: matchTargetWidth ? "var(--radix-popover-trigger-width)" : undefined,
						...dropdownStyle,
					}}
					sideOffset={4}
				>
					<div className="p-2 border-b border-border">
						<input
							ref={inputRef}
							className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
							placeholder={placeholder}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={handleSearchInputKeyDown}
						/>
					</div>
					<div ref={menuRef} className="max-h-[250px] overflow-y-auto overscroll-contain p-1" style={menuStyle}>
						{filteredItems.length === 0 ? (
							<div className="px-2.5 py-1.5 text-[13px] text-text-tertiary">{noResultsText}</div>
						) : (
							filteredItems.map((option, optionIndex) => {
								const match = fuzzyMatchesByValue.get(option.value);
								const isSelected = showSelectedIndicator && option.value === selectedValue;
								const isActive = optionIndex === activeOptionIndex;
								return (
									<button
										type="button"
										key={option.value}
										ref={(node) => {
											optionRefs.current[optionIndex] = node;
										}}
										className={cn(
											"flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] rounded-md text-left",
											isActive ? "bg-surface-3 text-text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
										)}
										onMouseEnter={() => setActiveOptionIndex(optionIndex)}
										onClick={() => {
											onSelect(option.value);
											handleOpenChange(false);
										}}
									>
										<span className="flex-1 break-all">{renderFuzzyHighlightedText(option.label, match?.positions, MATCHED_TEXT_STYLE)}</span>
										{isSelected ? <Check size={14} className="shrink-0 text-text-secondary" /> : null}
									</button>
								);
							})
						)}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
