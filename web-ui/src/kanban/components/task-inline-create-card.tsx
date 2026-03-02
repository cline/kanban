import { Button, Card, Checkbox, Code, FormGroup, Icon } from "@blueprintjs/core";
import type { ReactElement } from "react";

import { BranchSelectDropdown, type BranchSelectOption } from "@/kanban/components/branch-select-dropdown";
import { TaskPromptComposer } from "@/kanban/components/task-prompt-composer";

export type TaskInlineCardMode = "create" | "edit";

export type TaskBranchOption = BranchSelectOption;

export function TaskInlineCreateCard({
	prompt,
	onPromptChange,
	onCreate,
	onCancel,
	startInPlanMode,
	onStartInPlanModeChange,
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
	const branchSelectId = `${idPrefix}-branch-select`;
	const actionLabel = mode === "edit" ? "Save" : "Create";
	const cardMarginBottom = mode === "create" ? 8 : 0;

	return (
		<Card compact style={{ flexShrink: 0, marginBottom: cardMarginBottom }}>
			<FormGroup
				helperText={
					<span>Use <Code>@file</Code> to reference files.</span>
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
					onChange={(event) => onStartInPlanModeChange(event.currentTarget.checked)}
					label="Start in plan mode"
				/>
			</FormGroup>

			<FormGroup
				helperText="Creates the worktree at the selected ref's current HEAD in detached state."
				style={{ marginTop: -5, marginBottom: 0 }}
			>
				<span style={{ display: "block", marginBottom: 4 }}>Worktree base ref</span>
				<BranchSelectDropdown
					id={branchSelectId}
					options={branchOptions}
					selectedValue={branchRef}
					onSelect={onBranchRefChange}
					fill
					emptyText="No branches detected"
				/>
			</FormGroup>

			<div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
				<Button text="Cancel" variant="outlined" onClick={onCancel} />
				<Button
					text={(
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
					)}
					intent="primary"
					onClick={onCreate}
					disabled={!prompt.trim() || !branchRef}
				/>
			</div>
		</Card>
	);
}
