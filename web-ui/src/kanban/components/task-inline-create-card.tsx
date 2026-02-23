import { Button, Card, Checkbox, Code, FormGroup, HTMLSelect } from "@blueprintjs/core";
import type { ReactElement } from "react";

import { TaskPromptComposer } from "@/kanban/components/task-prompt-composer";

export type TaskWorkspaceMode = "local" | "worktree";

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
}): ReactElement {
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
		<Card compact style={{ marginBottom: 8, flexShrink: 0 }}>
			<FormGroup
				label="Prompt"
				labelFor="inline-task-prompt-input"
				helperText={
					<span>Use <Code>@file</Code> to reference files.</span>
				}
			>
				<TaskPromptComposer
					id="inline-task-prompt-input"
					value={prompt}
					onValueChange={onPromptChange}
					onSubmit={onCreate}
					placeholder="Describe the task"
					enabled={enabled}
					workspaceId={workspaceId}
					disallowedSlashCommands={disallowedSlashCommands}
				/>
			</FormGroup>

			<FormGroup label="Start mode" labelFor="inline-task-plan-mode-toggle">
				<Checkbox
					id="inline-task-plan-mode-toggle"
					checked={startInPlanMode}
					onChange={(event) => onStartInPlanModeChange(event.currentTarget.checked)}
					label="Start in plan mode"
				/>
			</FormGroup>

			<FormGroup
				label="Execution mode"
				labelFor="inline-task-workspace-mode-select"
				helperText={
					workspaceMode === "local"
						? "Runs directly in your current workspace."
						: "Creates an isolated worktree when the task starts."
				}
			>
				<HTMLSelect
					id="inline-task-workspace-mode-select"
					value={workspaceMode}
					onChange={(event) => onWorkspaceModeChange(event.target.value as TaskWorkspaceMode)}
					options={workspaceModeOptions}
					fill
				/>
			</FormGroup>

			{workspaceMode === "worktree" ? (
				<FormGroup
					label="Worktree base branch"
					labelFor="inline-task-branch-select"
					helperText="Branch/ref used when creating the isolated task worktree."
				>
					<HTMLSelect
						id="inline-task-branch-select"
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
					text="Create"
					intent="primary"
					onClick={onCreate}
					disabled={!prompt.trim() || (workspaceMode === "worktree" && (!canUseWorktree || !branchRef))}
				/>
			</div>
		</Card>
	);
}
