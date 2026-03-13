import { Button, Card, Checkbox, Code, FormGroup, HTMLSelect, Icon } from "@blueprintjs/core";
import type { ReactElement } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { BranchSelectDropdown, type BranchSelectOption } from "@/components/branch-select-dropdown";
import { TaskPromptComposer } from "@/components/task-prompt-composer";
import type { TaskAutoReviewMode } from "@/types";

export type TaskInlineCardMode = "create" | "edit";

export type TaskBranchOption = BranchSelectOption;

const AUTO_REVIEW_MODE_OPTIONS: Array<{ value: TaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Make commit" },
	{ value: "pr", label: "Make PR" },
	{ value: "move_to_trash", label: "Move to Trash" },
];
const AUTO_REVIEW_MODE_SELECT_WIDTH_CH = 14.5;

function ButtonShortcut({ includeShift = false }: { includeShift?: boolean }): ReactElement {
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: 2,
				marginLeft: 6,
			}}
			aria-hidden
		>
			<Icon icon="key-command" size={12} />
			{includeShift ? <Icon icon="key-shift" size={12} /> : null}
			<Icon icon="key-enter" size={12} />
		</span>
	);
}

export function TaskInlineCreateCard({
	prompt,
	onPromptChange,
	onCreate,
	onCreateAndStart,
	onCancel,
	startInPlanMode,
	onStartInPlanModeChange,
	autoReviewEnabled,
	onAutoReviewEnabledChange,
	autoReviewMode,
	onAutoReviewModeChange,
	startInPlanModeDisabled = false,
	workspaceId,
	branchRef,
	branchOptions,
	onBranchRefChange,
	enabled = true,
	mode = "create",
	idPrefix = "inline-task",
}: {
	prompt: string;
	onPromptChange: (value: string) => void;
	onCreate: () => void;
	onCreateAndStart?: () => void;
	onCancel: () => void;
	startInPlanMode: boolean;
	onStartInPlanModeChange: (value: boolean) => void;
	autoReviewEnabled: boolean;
	onAutoReviewEnabledChange: (value: boolean) => void;
	autoReviewMode: TaskAutoReviewMode;
	onAutoReviewModeChange: (value: TaskAutoReviewMode) => void;
	startInPlanModeDisabled?: boolean;
	workspaceId: string | null;
	branchRef: string;
	branchOptions: TaskBranchOption[];
	onBranchRefChange: (value: string) => void;
	enabled?: boolean;
	mode?: TaskInlineCardMode;
	idPrefix?: string;
}): ReactElement {
	const promptId = `${idPrefix}-prompt-input`;
	const planModeId = `${idPrefix}-plan-mode-toggle`;
	const autoReviewEnabledId = `${idPrefix}-auto-review-enabled-toggle`;
	const autoReviewModeId = `${idPrefix}-auto-review-mode-select`;
	const branchSelectId = `${idPrefix}-branch-select`;
	const actionLabel = mode === "edit" ? "Save" : "Create";
	const cancelLabel = "Cancel (esc)";
	const cardMarginBottom = mode === "create" ? 8 : 0;

	useHotkeys(
		"esc",
		(event) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
				return;
			}
			onCancel();
		},
		{
			enabled,
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[enabled, onCancel],
	);

	return (
		<Card compact style={{ flexShrink: 0, marginBottom: cardMarginBottom }}>
			<FormGroup
				helperText={
					<span>
						Use <Code>@file</Code> to reference files.
					</span>
				}
			>
				<TaskPromptComposer
					id={promptId}
					value={prompt}
					onValueChange={onPromptChange}
					onSubmit={onCreate}
					onSubmitAndStart={onCreateAndStart}
					placeholder="Describe the task"
					enabled={enabled}
					autoFocus
					workspaceId={workspaceId}
				/>
			</FormGroup>

			<FormGroup style={{ marginTop: -12, marginBottom: 4 }}>
				<Checkbox
					id={planModeId}
					checked={startInPlanMode}
					disabled={startInPlanModeDisabled || !enabled}
					onChange={(event) => onStartInPlanModeChange(event.currentTarget.checked)}
					label="Start in plan mode"
				/>
			</FormGroup>

			<FormGroup
				helperText="Creates the worktree at the selected ref's current HEAD in detached state."
				style={{ marginTop: -5, marginBottom: 0 }}
			>
				<span style={{ display: "block", marginTop: 2, marginBottom: 4 }}>Worktree base ref</span>
				<BranchSelectDropdown
					id={branchSelectId}
					options={branchOptions}
					selectedValue={branchRef}
					onSelect={onBranchRefChange}
					fill
					emptyText="No branches detected"
				/>
			</FormGroup>

			<FormGroup style={{ marginTop: 8, marginBottom: 4 }}>
				<div style={{ display: "flex", alignItems: "center", gap: 8, rowGap: 6, flexWrap: "wrap" }}>
					<Checkbox
						id={autoReviewEnabledId}
						checked={autoReviewEnabled}
						onChange={(event) => onAutoReviewEnabledChange(event.currentTarget.checked)}
						label="Automatically"
					/>
					<HTMLSelect
						id={autoReviewModeId}
						value={autoReviewMode}
						onChange={(event) => onAutoReviewModeChange(event.currentTarget.value as TaskAutoReviewMode)}
						options={AUTO_REVIEW_MODE_OPTIONS}
						style={{
							width: `${AUTO_REVIEW_MODE_SELECT_WIDTH_CH}ch`,
							maxWidth: "100%",
						}}
					/>
				</div>
			</FormGroup>

			<div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 12 }}>
				<Button text={cancelLabel} variant="outlined" onClick={onCancel} />
				<div style={{ display: "flex", gap: 8 }}>
					<Button
						text={
							<span style={{ display: "inline-flex", alignItems: "center" }}>
								<span>{actionLabel}</span>
								<ButtonShortcut />
							</span>
						}
						onClick={onCreate}
						disabled={!prompt.trim() || !branchRef}
					/>
					{onCreateAndStart ? (
						<Button
							text={
								<span style={{ display: "inline-flex", alignItems: "center" }}>
									<span>Start</span>
									<ButtonShortcut includeShift />
								</span>
							}
							intent="primary"
							onClick={onCreateAndStart}
							disabled={!prompt.trim() || !branchRef}
						/>
					) : null}
				</div>
			</div>
		</Card>
	);
}
