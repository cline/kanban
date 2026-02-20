import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TaskPromptComposer } from "@/kanban/components/task-prompt-composer";

export type TaskWorkspaceMode = "local" | "worktree";

export interface TaskBranchOption {
	value: string;
	label: string;
}

export function TaskCreateDialog({
	open,
	onOpenChange,
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
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
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
}): ReactElement {
	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				onOpenChange(nextOpen);
			}}
		>
			<DialogContent className="border-border bg-card text-foreground">
				<DialogHeader>
					<DialogTitle>Create Task</DialogTitle>
					<DialogDescription className="text-muted-foreground">New tasks are added to Backlog.</DialogDescription>
				</DialogHeader>
				<div className="space-y-1">
					<label htmlFor="task-prompt-input" className="text-xs text-muted-foreground">
						Prompt
					</label>
					<TaskPromptComposer
						id="task-prompt-input"
						value={prompt}
						onValueChange={onPromptChange}
						onSubmit={onCreate}
						placeholder="Describe the task"
						enabled={open}
						disallowedSlashCommands={disallowedSlashCommands}
					/>
					<p className="text-[11px] text-muted-foreground">
						Use <code className="font-mono text-foreground">@file</code> to reference files.
					</p>
				</div>
				<div className="space-y-1">
					<label htmlFor="task-plan-mode-toggle" className="text-xs text-muted-foreground">
						Start mode
					</label>
					<label
						htmlFor="task-plan-mode-toggle"
						className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
					>
						<input
							id="task-plan-mode-toggle"
							type="checkbox"
							checked={startInPlanMode}
							onChange={(event) => onStartInPlanModeChange(event.target.checked)}
							className="size-4 rounded border-border bg-background accent-primary"
						/>
						<span>Start in plan mode</span>
					</label>
				</div>
				<div className="space-y-1">
					<label htmlFor="task-workspace-mode-select" className="text-xs text-muted-foreground">
						Execution mode
					</label>
					<select
						id="task-workspace-mode-select"
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
				<div className="space-y-1">
					<label htmlFor="task-branch-select" className="text-xs text-muted-foreground">
						Worktree base branch
					</label>
					<select
						id="task-branch-select"
						value={branchRef}
						onChange={(event) => onBranchRefChange(event.target.value)}
						disabled={workspaceMode !== "worktree" || !canUseWorktree}
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
						{workspaceMode === "worktree"
							? "Branch/ref used when creating the isolated task worktree."
							: "Disabled while local mode is selected."}
					</p>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button
						onClick={onCreate}
						disabled={!prompt.trim() || (workspaceMode === "worktree" && (!canUseWorktree || !branchRef))}
					>
						Create
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
