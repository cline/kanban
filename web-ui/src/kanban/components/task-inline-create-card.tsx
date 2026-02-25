import { Button, Card, Checkbox, Code, FormGroup, HTMLSelect, Icon } from "@blueprintjs/core";
import type { ReactElement } from "react";

import { TaskPromptComposer } from "@/kanban/components/task-prompt-composer";

export type TaskWorkspaceMode = "local" | "worktree";
export type TaskInlineCardMode = "create" | "edit";

export interface TaskBranchOption {
	value: string;
	label: string;
}

export function TaskInlineCreateCard({
	prompt,
	onPromptChange,
	onCreate,
	onCancel,
	startInPlanMode,
	onStartInPlanModeChange,
	workspaceMode,
	onWorkspaceModeChange,
	workspaceId,
	workspaceCurrentBranch,
	canUseWorktree,
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
	workspaceMode: TaskWorkspaceMode;
	onWorkspaceModeChange: (value: TaskWorkspaceMode) => void;
	workspaceId: string | null;
	workspaceCurrentBranch: string | null;
	canUseWorktree: boolean;
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
	const workspaceModeId = `${idPrefix}-workspace-mode-select`;
	const branchSelectId = `${idPrefix}-branch-select`;
	const actionLabel = mode === "edit" ? "Save" : "Create";
	const cardMarginBottom = mode === "create" ? 8 : 0;

	const workspaceModeOptions = [
		{
			value: "local",
			label: workspaceCurrentBranch
				? `Local workspace (current branch: ${workspaceCurrentBranch})`
				: "Local workspace",
		},
		{ value: "worktree", label: "Isolated worktree", disabled: !canUseWorktree },
	];

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
				label="Execution workspace"
				labelFor={workspaceModeId}
				helperText={
					workspaceMode === "local"
						? "Runs directly in your current workspace."
						: "Creates an isolated worktree when the task starts."
				}
			>
				<HTMLSelect
					id={workspaceModeId}
					value={workspaceMode}
					onChange={(event) => onWorkspaceModeChange(event.target.value as TaskWorkspaceMode)}
					options={workspaceModeOptions}
					fill
				/>
			</FormGroup>

			{workspaceMode === "worktree" ? (
				<FormGroup
					label="Worktree base branch"
					labelFor={branchSelectId}
					helperText="Branch/ref used when creating the isolated task worktree."
					style={{ marginTop: -5, marginBottom: 0 }}
				>
					<HTMLSelect
						id={branchSelectId}
						value={branchRef}
						onChange={(event) => onBranchRefChange(event.target.value)}
						disabled={!canUseWorktree}
						options={
							branchOptions.length > 0
								? branchOptions
								: [{ value: "", label: "No branches detected" }]
						}
						fill
					/>
				</FormGroup>
			) : null}

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
					disabled={!prompt.trim() || (workspaceMode === "worktree" && (!canUseWorktree || !branchRef))}
				/>
			</div>
		</Card>
	);
}
