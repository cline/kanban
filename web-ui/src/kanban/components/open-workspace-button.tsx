import {
	Button,
	ButtonGroup,
	Icon,
	Menu,
	MenuItem,
	Popover,
	PopoverInteractionKind,
} from "@blueprintjs/core";

import type { OpenTargetId, OpenTargetOption } from "@/kanban/utils/open-targets";

function OpenTargetIcon({ option }: { option: OpenTargetOption }): React.ReactElement {
	return (
		<img
			src={option.iconSrc}
			alt=""
			aria-hidden
			style={{
				width: 14,
				height: 14,
				display: "block",
				objectFit: "contain",
				filter: "brightness(0) invert(1)",
				opacity: 0.9,
			}}
		/>
	);
}

export function OpenWorkspaceButton({
	options,
	selectedOptionId,
	disabled,
	loading,
	onOpen,
	onSelectOption,
}: {
	options: readonly OpenTargetOption[];
	selectedOptionId: OpenTargetId;
	disabled: boolean;
	loading: boolean;
	onOpen: () => void;
	onSelectOption: (optionId: OpenTargetId) => void;
}): React.ReactElement {
	const selectedOption = options.find((option) => option.id === selectedOptionId) ?? options[0];
	if (!selectedOption) {
		return <></>;
	}

	return (
		<ButtonGroup>
			<Button
				fill
				size="small"
				variant="outlined"
				icon={<OpenTargetIcon option={selectedOption} />}
				text="Open"
				disabled={disabled}
				loading={loading}
				onClick={onOpen}
				aria-label={`Open in ${selectedOption.label}`}
			/>
			<Popover
				interactionKind={PopoverInteractionKind.CLICK}
				placement="bottom-end"
				content={(
					<Menu>
						{options.map((option) => (
							<MenuItem
								key={option.id}
								icon={<OpenTargetIcon option={option} />}
								text={option.label}
								active={option.id === selectedOptionId}
								onClick={() => onSelectOption(option.id)}
								labelElement={option.id === selectedOptionId ? <Icon icon="small-tick" /> : undefined}
							/>
						))}
					</Menu>
				)}
			>
				<Button
					size="small"
					variant="outlined"
					icon="chevron-down"
					disabled={disabled}
					aria-label="Select open target"
				/>
			</Popover>
		</ButtonGroup>
	);
}
