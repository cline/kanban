import { GitBranch } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";

import { SearchSelectDropdown, type SearchSelectOption } from "@/components/search-select-dropdown";
import { useI18n } from "@/i18n/i18n-context";

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
	emptyText,
	noResultsText,
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
	const { t } = useI18n();
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
			emptyText={emptyText ?? t("task.noBranches")}
			noResultsText={noResultsText ?? t("task.noMatchingBranches")}
			showSelectedIndicator={showSelectedIndicator}
			matchTargetWidth={matchTargetWidth}
			dropdownStyle={dropdownStyle}
			menuStyle={menuStyle}
			onPopoverOpenChange={onPopoverOpenChange}
		/>
	);
}
