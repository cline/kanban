import * as RadixPopover from "@radix-ui/react-popover";
import { Fzf } from "fzf";
import { Check, ChevronDown } from "lucide-react";
import type { KeyboardEvent, ReactElement, WheelEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	CLINE_REASONING_EFFORT_OPTIONS,
	formatClineReasoningEffortLabel,
} from "@/components/detail-panels/cline-model-picker-options";
import type { SearchSelectOption } from "@/components/search-select-dropdown";
import { renderFuzzyHighlightedText } from "@/components/shared/render-fuzzy-highlighted-text";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import type { RuntimeClineReasoningEffort } from "@/runtime/types";

const MATCHED_TEXT_STYLE = {
	color: "var(--color-text-primary)",
	fontWeight: 600,
} as const;

export function ClineChatModelSelector({
	modelOptions,
	recommendedModelIds = [],
	pinSelectedModelToTop = true,
	selectedModelId,
	selectedModelButtonText,
	onSelectModel,
	reasoningEnabledModelIds = [],
	defaultOptionSupportsReasoningEffort = false,
	selectedReasoningEffort,
	onSelectReasoningEffort,
	disabled = false,
	isModelLoading = false,
	isModelSaving = false,
	fill = false,
	triggerVariant = "subtle",
	onPopoverOpenChange,
}: {
	modelOptions: readonly SearchSelectOption[];
	recommendedModelIds?: readonly string[];
	pinSelectedModelToTop?: boolean;
	selectedModelId: string;
	selectedModelButtonText: string;
	onSelectModel: (value: string) => void;
	reasoningEnabledModelIds?: readonly string[];
	defaultOptionSupportsReasoningEffort?: boolean;
	selectedReasoningEffort: RuntimeClineReasoningEffort | "";
	onSelectReasoningEffort: (value: RuntimeClineReasoningEffort | "") => void;
	disabled?: boolean;
	isModelLoading?: boolean;
	isModelSaving?: boolean;
	fill?: boolean;
	triggerVariant?: "default" | "subtle";
	onPopoverOpenChange?: (open: boolean) => void;
}): ReactElement {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeOptionIndex, setActiveOptionIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const shouldScrollSelectedModelOnOpenRef = useRef(false);

	const recommendedModelIdSet = useMemo(
		() => new Set(recommendedModelIds.map((value) => value.trim()).filter((value) => value.length > 0)),
		[recommendedModelIds],
	);
	const reasoningEnabledModelIdSet = useMemo(
		() => new Set(reasoningEnabledModelIds.map((value) => value.trim()).filter((value) => value.length > 0)),
		[reasoningEnabledModelIds],
	);
	const selectedModelSupportsReasoningEffort =
		selectedModelId.length === 0
			? defaultOptionSupportsReasoningEffort
			: reasoningEnabledModelIdSet.has(selectedModelId);

	const orderedOptions = useMemo(() => {
		const items = modelOptions.slice();
		if (!pinSelectedModelToTop || !selectedModelId) {
			return items;
		}
		const selectedIndex = items.findIndex((option) => option.value === selectedModelId);
		if (selectedIndex <= 0) {
			return items;
		}
		const [selectedOption] = items.splice(selectedIndex, 1);
		if (!selectedOption) {
			return items;
		}
		items.unshift(selectedOption);
		return items;
	}, [modelOptions, pinSelectedModelToTop, selectedModelId]);

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
	const filteredModelOptions = useMemo(() => {
		if (!query.trim()) {
			if (recommendedModelIdSet.size === 0) {
				return orderedOptions;
			}
			const recommendedItems = orderedOptions.filter((item) => recommendedModelIdSet.has(item.value));
			const otherItems = orderedOptions.filter((item) => !recommendedModelIdSet.has(item.value));
			return [...recommendedItems, ...otherItems];
		}
		return fuzzyMatches.map((entry) => entry.item);
	}, [fuzzyMatches, orderedOptions, query, recommendedModelIdSet]);
	const filteredItemIndexByValue = useMemo(
		() => new Map(filteredModelOptions.map((item, index) => [item.value, index] as const)),
		[filteredModelOptions],
	);
	const selectedModelIndex = useMemo(
		() => filteredModelOptions.findIndex((option) => option.value === selectedModelId),
		[filteredModelOptions, selectedModelId],
	);
	const showRecommendedSection = query.trim().length === 0 && recommendedModelIdSet.size > 0;
	const recommendedItems = useMemo(
		() => filteredModelOptions.filter((item) => recommendedModelIdSet.has(item.value)),
		[filteredModelOptions, recommendedModelIdSet],
	);
	const otherItems = useMemo(
		() => filteredModelOptions.filter((item) => !recommendedModelIdSet.has(item.value)),
		[filteredModelOptions, recommendedModelIdSet],
	);

	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			onPopoverOpenChange?.(nextOpen);
			setIsOpen(nextOpen);
			setQuery("");
			if (nextOpen) {
				setActiveOptionIndex(selectedModelIndex >= 0 ? selectedModelIndex : 0);
				shouldScrollSelectedModelOnOpenRef.current = true;
				return;
			}
			if (!nextOpen) {
				setActiveOptionIndex(0);
			}
		},
		[onPopoverOpenChange, selectedModelIndex],
	);

	useEffect(() => {
		if (filteredModelOptions.length === 0) {
			setActiveOptionIndex(0);
			return;
		}
		setActiveOptionIndex((currentIndex) => {
			if (currentIndex >= 0 && currentIndex < filteredModelOptions.length) {
				return currentIndex;
			}
			if (!selectedModelId) {
				return 0;
			}
			const selectedIndex = filteredModelOptions.findIndex((option) => option.value === selectedModelId);
			return selectedIndex >= 0 ? selectedIndex : 0;
		});
	}, [filteredModelOptions, selectedModelId]);

	useEffect(() => {
		if (!isOpen || !shouldScrollSelectedModelOnOpenRef.current) {
			return;
		}
		shouldScrollSelectedModelOnOpenRef.current = false;
		const nextActiveIndex = activeOptionIndex;
		const frameId = window.requestAnimationFrame(() => {
			const optionElement = optionRefs.current[nextActiveIndex] ?? null;
			if (optionElement && typeof optionElement.scrollIntoView === "function") {
				optionElement.scrollIntoView({ block: "center" });
			}
		});
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [activeOptionIndex, isOpen]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		window.requestAnimationFrame(() => {
			inputRef.current?.focus();
		});
	}, [isOpen]);

	const handleSearchInputKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (filteredModelOptions.length === 0) {
				if (event.key === "Escape") {
					event.preventDefault();
					handleOpenChange(false);
				}
				return;
			}

			if (event.key === "ArrowDown") {
				event.preventDefault();
				setActiveOptionIndex((currentIndex) => Math.min(currentIndex + 1, filteredModelOptions.length - 1));
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
				setActiveOptionIndex(filteredModelOptions.length - 1);
				return;
			}

			if (event.key === "Enter") {
				event.preventDefault();
				const option = filteredModelOptions[activeOptionIndex];
				if (!option) {
					return;
				}
				onSelectModel(option.value);
				setQuery("");
				const optionSupportsReasoningEffort =
					option.value.length === 0
						? defaultOptionSupportsReasoningEffort
						: reasoningEnabledModelIdSet.has(option.value);
				if (!optionSupportsReasoningEffort) {
					handleOpenChange(false);
				}
				return;
			}

			if (event.key === "Escape") {
				event.preventDefault();
				handleOpenChange(false);
			}
		},
		[activeOptionIndex, filteredModelOptions, handleOpenChange, onSelectModel, reasoningEnabledModelIdSet],
	);

	const handleWheelCapture = useCallback((event: WheelEvent<HTMLDivElement>) => {
		const menu = menuRef.current;
		if (!menu || menu.scrollHeight <= menu.clientHeight) {
			return;
		}
		menu.scrollTop += event.deltaY;
		event.preventDefault();
		event.stopPropagation();
	}, []);

	const renderModelOptionButton = (option: SearchSelectOption): ReactElement => {
		const optionIndex = filteredItemIndexByValue.get(option.value) ?? 0;
		const match = fuzzyMatchesByValue.get(option.value);
		const isSelected = option.value === selectedModelId;
		const isActive = optionIndex === activeOptionIndex;
		return (
			<button
				type="button"
				key={option.value}
				ref={(node) => {
					optionRefs.current[optionIndex] = node;
				}}
				className={cn(
					"flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]",
					isSelected
						? "bg-accent text-accent-fg hover:bg-accent"
						: isActive
							? "bg-surface-3 text-text-primary"
							: "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
				)}
				onMouseEnter={() => setActiveOptionIndex(optionIndex)}
				onClick={() => {
					onSelectModel(option.value);
					setQuery("");
					const optionSupportsReasoningEffort =
						option.value.length === 0
							? defaultOptionSupportsReasoningEffort
							: reasoningEnabledModelIdSet.has(option.value);
					if (!optionSupportsReasoningEffort) {
						handleOpenChange(false);
					}
				}}
			>
				<span className="flex-1 break-all">
					{renderFuzzyHighlightedText(option.label, match?.positions, MATCHED_TEXT_STYLE)}
				</span>
				{isSelected ? <Check size={14} className="shrink-0 text-accent-fg" /> : null}
			</button>
		);
	};

	return (
		<RadixPopover.Root open={isOpen} onOpenChange={handleOpenChange}>
			<RadixPopover.Trigger asChild>
				<Button
					id="cline-chat-model-picker"
					size="sm"
					variant="default"
					disabled={disabled}
					iconRight={<ChevronDown size={14} />}
					className={cn(
						"min-w-0 max-w-full justify-between px-2 text-left shadow-none",
						triggerVariant === "subtle" &&
							"bg-surface-3 text-text-secondary hover:bg-surface-4 hover:text-text-primary",
						(isModelLoading || isModelSaving) && "text-text-tertiary",
						fill && "w-full",
					)}
				>
					<span className="flex-1 truncate text-left">{selectedModelButtonText}</span>
				</Button>
			</RadixPopover.Trigger>
			<RadixPopover.Portal>
				<RadixPopover.Content
					className="z-50 w-[520px] max-w-[calc(100vw-24px)] rounded-lg border border-border bg-surface-1 shadow-xl overflow-hidden"
					onWheelCapture={handleWheelCapture}
					collisionPadding={12}
					sideOffset={4}
				>
					<div
						className={cn(
							"grid",
							selectedModelSupportsReasoningEffort ? "grid-cols-[minmax(0,1fr)_180px]" : "grid-cols-1",
						)}
					>
						<div className={cn("p-2", selectedModelSupportsReasoningEffort && "border-r border-border")}>
							<p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-[0.02em] text-text-tertiary">
								Model ID
							</p>
							<input
								ref={inputRef}
								className="h-7 w-full rounded-md border border-border bg-surface-2 px-2 text-xs text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
								placeholder="Search models..."
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={handleSearchInputKeyDown}
							/>
							<div ref={menuRef} className="mt-2 max-h-[260px] overflow-y-auto overscroll-contain p-1">
								{filteredModelOptions.length === 0 ? (
									<div className="px-2.5 py-1.5 text-[13px] text-text-tertiary">No matching models</div>
								) : (
									<>
										{showRecommendedSection && recommendedItems.length > 0 ? (
											<div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.02em] text-text-tertiary">
												Recommended models
											</div>
										) : null}
										{(showRecommendedSection ? recommendedItems : filteredModelOptions).map((option) =>
											renderModelOptionButton(option),
										)}
										{showRecommendedSection && recommendedItems.length > 0 && otherItems.length > 0 ? (
											<>
												<div className="my-1 border-t border-border" />
												<div className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.02em] text-text-tertiary">
													All models
												</div>
											</>
										) : null}
										{showRecommendedSection && otherItems.length > 0
											? otherItems.map((option) => renderModelOptionButton(option))
											: null}
									</>
								)}
							</div>
						</div>
						{selectedModelSupportsReasoningEffort ? (
							<div className="p-2">
								<p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-[0.02em] text-text-tertiary">
									Reasoning effort
								</p>
								<div className="p-1">
									{CLINE_REASONING_EFFORT_OPTIONS.map((option) => {
										const isSelected = option.value === selectedReasoningEffort;
										return (
											<button
												type="button"
												key={option.value}
												className={cn(
													"flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px]",
													isSelected
														? "bg-accent text-accent-fg hover:bg-accent"
														: "text-text-secondary hover:bg-surface-3 hover:text-text-primary",
												)}
												onClick={() => {
													onSelectReasoningEffort(option.value as RuntimeClineReasoningEffort | "");
													handleOpenChange(false);
												}}
											>
												<span className="flex-1">
													{formatClineReasoningEffortLabel(
														option.value as RuntimeClineReasoningEffort | "",
													)}
												</span>
												{isSelected ? <Check size={14} className="shrink-0 text-accent-fg" /> : null}
											</button>
										);
									})}
								</div>
							</div>
						) : null}
					</div>
				</RadixPopover.Content>
			</RadixPopover.Portal>
		</RadixPopover.Root>
	);
}
