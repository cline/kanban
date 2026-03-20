import { GitBranch } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";

import { SearchSelectDropdown, type SearchSelectOption } from "@/components/search-select-dropdown";

export type BranchSelectOption = SearchSelectOption;

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
	size?: "sm" | "md";
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
	const resolvedIconSize = typeof iconSize === "number" ? iconSize : 14;

	return (
		<SearchSelectDropdown
			options={options}
			selectedValue={selectedValue}
			onSelect={onSelect}
			id={id}
			icon={<GitBranch size={resolvedIconSize} />}
			disabled={disabled}
			fill={fill}
			size={size}
			buttonText={buttonText}
			buttonClassName={buttonClassName}
			buttonStyle={buttonStyle}
			iconSize={iconSize}
			emptyText={emptyText}
			noResultsText={noResultsText}
			showSelectedIndicator={showSelectedIndicator}
			matchTargetWidth={matchTargetWidth}
			dropdownStyle={dropdownStyle}
			menuStyle={menuStyle}
			onPopoverOpenChange={onPopoverOpenChange}
		/>
	);
}
