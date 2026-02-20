import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
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
	workspaceCurrentBranch: string | null;
	canUseWorktree: boolean;
	branchRef: string;
	branchOptions: TaskBranchOption[];
	onBranchRefChange: (value: string) => void;
	disallowedSlashCommands: string[];
	enabled?: boolean;
}): ReactElement {
	return (
		<div className="mb-2 shrink-0 rounded-md border border-border bg-card p-3">
			<div className="space-y-1">
				<label htmlFor="inline-task-prompt-input" className="text-xs text-muted-foreground">
					Prompt
				</label>
				<TaskPromptComposer
					id="inline-task-prompt-input"
					value={prompt}
					onValueChange={onPromptChange}
					onSubmit={onCreate}
					placeholder="Describe the task"
					enabled={enabled}
					disallowedSlashCommands={disallowedSlashCommands}
				/>
				<p className="text-[11px] text-muted-foreground">
					Use <code className="font-mono text-foreground">@file</code> to reference files.
				</p>
			</div>
			<div className="mt-3 space-y-1">
				<label htmlFor="inline-task-plan-mode-toggle" className="text-xs text-muted-foreground">
					Start mode
				</label>
				<label
					htmlFor="inline-task-plan-mode-toggle"
					className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
				>
					<input
						id="inline-task-plan-mode-toggle"
						type="checkbox"
						checked={startInPlanMode}
						onChange={(event) => onStartInPlanModeChange(event.target.checked)}
						className="size-4 rounded border-border bg-background accent-primary"
					/>
					<span>Start in plan mode</span>
				</label>
			</div>
			<div className="mt-3 space-y-1">
				<label htmlFor="inline-task-workspace-mode-select" className="text-xs text-muted-foreground">
					Execution mode
				</label>
				<select
					id="inline-task-workspace-mode-select"
					value={workspaceMode}
					onChange={(event) => onWorkspaceModeChange(event.target.value as TaskWorkspaceMode)}
					className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
				>
					<option value="local">
						{workspaceCurrentBranch
							? `Local workspace (current branch: ${workspaceCurrentBranch})`
							: "Local workspace"}
					</option>
					<option value="worktree" disabled={!canUseWorktree}>
						Isolated worktree
					</option>
				</select>
				<p className="text-[11px] text-muted-foreground">
					{workspaceMode === "local"
						? "Runs directly in your current workspace."
						: "Creates an isolated worktree when the task starts."}
				</p>
			</div>
			{workspaceMode === "worktree" ? (
				<div className="mt-3 space-y-1">
					<label htmlFor="inline-task-branch-select" className="text-xs text-muted-foreground">
						Worktree base branch
					</label>
					<select
						id="inline-task-branch-select"
						value={branchRef}
						onChange={(event) => onBranchRefChange(event.target.value)}
						disabled={!canUseWorktree}
						className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
					>
						{branchOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
						{branchOptions.length === 0 ? <option value="">No branches detected</option> : null}
					</select>
					<p className="text-[11px] text-muted-foreground">
						Branch/ref used when creating the isolated task worktree.
					</p>
				</div>
			) : null}
			<div className="mt-3 flex items-center justify-end gap-2">
				<Button variant="outline" onClick={onCancel}>
					Cancel
				</Button>
				<Button
					onClick={onCreate}
					disabled={!prompt.trim() || (workspaceMode === "worktree" && (!canUseWorktree || !branchRef))}
				>
					Create
				</Button>
			</div>
		</div>
	);
}
