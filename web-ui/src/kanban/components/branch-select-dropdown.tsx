import { Button, Icon, MenuItem } from "@blueprintjs/core";
import type { ButtonProps } from "@blueprintjs/core";
import { Select } from "@blueprintjs/select";
import type { ItemPredicate, ItemRenderer } from "@blueprintjs/select";
import { useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";

export interface BranchSelectOption {
	value: string;
	label: string;
}

const BranchSelect = Select.ofType<BranchSelectOption>();

const filterBranch: ItemPredicate<BranchSelectOption> = (query, option) => {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) {
		return true;
	}
	return option.label.toLowerCase().includes(normalizedQuery) || option.value.toLowerCase().includes(normalizedQuery);
};

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
	const resolvedButtonText = buttonText ?? selectedOption?.label ?? emptyText;
	const renderBranchOption = useMemo((): ItemRenderer<BranchSelectOption> => {
		return (option, { handleClick, handleFocus, modifiers }) => {
			if (!modifiers.matchesPredicate) {
				return null;
			}
				return (
					<MenuItem
						key={option.value}
						active={modifiers.active}
						disabled={modifiers.disabled}
						text={option.label}
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
	}, [selectedValue, showSelectedIndicator]);

	return (
		<BranchSelect
			items={orderedOptions}
			itemRenderer={renderBranchOption}
			itemPredicate={filterBranch}
			onItemSelect={(option) => onSelect(option.value)}
			popoverProps={{
				matchTargetWidth,
				minimal: true,
				onOpening: () => onPopoverOpenChange?.(true),
				onClosing: () => onPopoverOpenChange?.(false),
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
				disabled={disabled}
				className={buttonClassName}
				style={buttonStyle}
			/>
		</BranchSelect>
	);
}
