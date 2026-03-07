import { Button, Icon, MenuItem } from "@blueprintjs/core";
import type { ButtonProps } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import type { ItemListPredicate, ItemRenderer } from "@blueprintjs/select";
import { Fzf } from "fzf";
import { useMemo, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";

export interface BranchSelectOption {
	value: string;
	label: string;
}

const BranchSelect = Select.ofType<BranchSelectOption>();
const MATCHED_TEXT_STYLE = {
	color: "var(--bp-typography-color-primary-rest)",
	fontWeight: 600,
} as const;

function renderHighlightedText(value: string, positions: Set<number> | undefined): ReactNode {
	if (!positions || positions.size === 0) {
		return value;
	}

	const fragments: ReactNode[] = [];
	let currentText = "";
	let currentIsMatch: boolean | null = null;
	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (character == null) {
			continue;
		}
		const isMatch = positions.has(index);
		if (currentIsMatch === null) {
			currentText = character;
			currentIsMatch = isMatch;
			continue;
		}
		if (isMatch === currentIsMatch) {
			currentText += character;
			continue;
		}
		fragments.push(
			<span
				key={`${index}:${currentIsMatch ? "match" : "plain"}`}
				style={currentIsMatch ? MATCHED_TEXT_STYLE : undefined}
			>
				{currentText}
			</span>,
		);
		currentText = character;
		currentIsMatch = isMatch;
	}

	if (currentIsMatch === null) {
		return value;
	}

	fragments.push(
		<span
			key="end"
			style={currentIsMatch ? MATCHED_TEXT_STYLE : undefined}
		>
			{currentText}
		</span>,
	);

	return fragments;
}

export function BranchSelectDropdown({
	options,
	selectedValue,
	onSelect,
	id,
	disabled = false,
	fill = false,
	size,
	buttonText,
	buttonClassName,
	buttonStyle,
	iconSize,
	emptyText = "No branches detected",
	noResultsText = "No matching branches",
	showSelectedIndicator = false,
	matchTargetWidth = true,
	dropdownStyle,
	menuStyle,
	onPopoverOpenChange,
}: {
	options: readonly BranchSelectOption[];
	selectedValue?: string | null;
	onSelect: (value: string) => void;
	id?: string;
	disabled?: boolean;
	fill?: boolean;
	size?: ButtonProps["size"];
	buttonText?: string;
	buttonClassName?: string;
	buttonStyle?: CSSProperties;
	iconSize?: number;
	emptyText?: string;
	noResultsText?: string;
	showSelectedIndicator?: boolean;
	matchTargetWidth?: boolean;
	dropdownStyle?: CSSProperties;
	menuStyle?: CSSProperties;
	onPopoverOpenChange?: (isOpen: boolean) => void;
}): ReactElement {
	const [isOpen, setIsOpen] = useState(false);
	const [query, setQuery] = useState("");
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
			return [] as ReturnType<Fzf<BranchSelectOption[]>["find"]>;
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
	const filterBranchList = useMemo((): ItemListPredicate<BranchSelectOption> => {
		return (_nextQuery, items) => {
			if (!query.trim()) {
				return items;
			}
			return fuzzyMatches.map((entry) => entry.item);
		};
	}, [fuzzyMatches, query]);
	const resolvedButtonText = buttonText ?? selectedOption?.label ?? emptyText;
	const renderBranchOption = useMemo((): ItemRenderer<BranchSelectOption> => {
		return (option, { handleClick, handleFocus, modifiers }) => {
			if (!modifiers.matchesPredicate) {
				return null;
			}
			const match = fuzzyMatchesByValue.get(option.value);
			return (
				<MenuItem
					key={option.value}
					active={modifiers.active}
					disabled={modifiers.disabled}
					text={renderHighlightedText(option.label, match?.positions)}
					onClick={handleClick}
					onFocus={handleFocus}
					roleStructure="listoption"
					style={{ paddingLeft: 8, paddingRight: 8 }}
					labelElement={
						showSelectedIndicator && option.value === selectedValue
							? <Icon icon="small-tick" />
							: undefined
					}
				/>
			);
		};
	}, [fuzzyMatchesByValue, selectedValue, showSelectedIndicator]);

	return (
		<BranchSelect
			items={orderedOptions}
			itemRenderer={renderBranchOption}
			itemListPredicate={filterBranchList}
			query={query}
			onQueryChange={setQuery}
			onItemSelect={(option) => onSelect(option.value)}
			popoverProps={{
				matchTargetWidth,
				minimal: true,
				onOpening: () => {
					setIsOpen(true);
					setQuery("");
					onPopoverOpenChange?.(true);
				},
				onClosing: () => {
					setIsOpen(false);
					setQuery("");
					onPopoverOpenChange?.(false);
				},
			}}
			popoverContentProps={dropdownStyle ? { style: dropdownStyle } : undefined}
			menuProps={menuStyle ? { style: menuStyle } : undefined}
			inputProps={{ size: "small" }}
			resetOnClose
			noResults={<MenuItem disabled text={noResultsText} roleStructure="listoption" />}
		>
			<Button
				id={id}
				size={size}
				variant="outlined"
				alignText="left"
				fill={fill}
				icon={typeof iconSize === "number" ? <Icon icon="git-branch" size={iconSize} /> : "git-branch"}
				endIcon="caret-down"
				text={resolvedButtonText}
				active={isOpen}
				disabled={disabled}
				className={buttonClassName}
				style={buttonStyle}
			/>
		</BranchSelect>
	);
}
