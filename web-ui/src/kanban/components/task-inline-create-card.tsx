import { Button, Card, Checkbox, Code, FormGroup, HTMLSelect, Icon } from "@blueprintjs/core";
import type { ReactElement } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { BranchSelectDropdown, type BranchSelectOption } from "@/kanban/components/branch-select-dropdown";
import { TaskPromptComposer } from "@/kanban/components/task-prompt-composer";
import type { TaskAutoReviewMode } from "@/kanban/types";

export type TaskInlineCardMode = "create" | "edit";

export type TaskBranchOption = BranchSelectOption;

const AUTO_REVIEW_MODE_OPTIONS: Array<{ value: TaskAutoReviewMode; label: string }> = [
	{ value: "commit", label: "Make commit" },
	{ value: "pr", label: "Make PR" },
	{ value: "move_to_trash", label: "Move to Trash" },
];
const AUTO_REVIEW_MODE_SELECT_WIDTH_CH = 14.5;

export function TaskInlineCreateCard({
	prompt,
	onPromptChange,
	onCreate,
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
	disallowedSlashCommands,
	enabled = true,
	mode = "create",
	idPrefix = "inline-task",
}: {
	prompt: string;
	onPromptChange: (value: string) => void;
	onCreate: () => void;
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
	disallowedSlashCommands: string[];
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
	const cancelLabel = mode === "create" ? "Cancel (esc)" : "Cancel";
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
			enabled: mode === "create",
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[mode, onCancel],
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
					placeholder="Describe the task"
					enabled={enabled}
					autoFocus
					workspaceId={workspaceId}
					disallowedSlashCommands={disallowedSlashCommands}
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

			<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
				<Button text={cancelLabel} variant="outlined" onClick={onCancel} />
				<Button
					text={
						<span style={{ display: "inline-flex", alignItems: "center" }}>
							<span>{actionLabel}</span>
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
								<Icon icon="key-enter" size={12} />
							</span>
						</span>
					}
					intent="primary"
					onClick={onCreate}
					disabled={!prompt.trim() || !branchRef}
				/>
			</div>
		</Card>
	);
}
