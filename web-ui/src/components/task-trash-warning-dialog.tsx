import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import type { RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

export interface TaskTrashWarningViewModel {
	taskTitle: string;
	fileCount: number;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

function getTrashWarningGuidance(workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null): string[] {
	if (!workspaceInfo) {
		return ["Save your changes before trashing this task."];
	}

	if (workspaceInfo.isDetached) {
		return [
			"Create a branch inside this worktree, commit, then open a PR from that branch.",
			"Or commit and cherry-pick the commit onto your target branch (for example main).",
		];
	}

	const branch = workspaceInfo.branch ?? workspaceInfo.baseRef;
	return [
		`Commit your changes in the worktree branch (${branch}), then open a PR or cherry-pick as needed.`,
		"After preserving the work, you can safely move this task to Trash.",
	];
}

export function TaskTrashWarningDialog({
	open,
	warning,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	warning: TaskTrashWarningViewModel | null;
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
	const guidance = getTrashWarningGuidance(warning?.workspaceInfo ?? null);

	return (
		<AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
			<AlertDialogTitle className="text-sm font-semibold text-text-primary">
				Unsaved task changes detected
			</AlertDialogTitle>
			<AlertDialogDescription className="text-text-secondary mt-2 mb-3">
				{warning
					? `${warning.taskTitle} has ${warning.fileCount} changed file(s).`
					: "This task has uncommitted changes."}
			</AlertDialogDescription>
			<p className="text-[13px] text-text-primary">
				Moving to Trash will delete this task worktree. Preserve your work first, then trash the task.
			</p>
			{warning?.workspaceInfo?.path ? (
				<pre className="rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap overflow-auto my-2">
					{formatPathForDisplay(warning.workspaceInfo.path)}
				</pre>
			) : null}
			{guidance.map((line) => (
				<p key={line} className="text-[13px] text-text-secondary">
					{line}
				</p>
			))}
			<div className="flex justify-end gap-2 mt-4">
				<AlertDialogCancel asChild>
					<Button variant="default" onClick={onCancel}>Cancel</Button>
				</AlertDialogCancel>
				<AlertDialogAction asChild>
					<Button variant="danger" onClick={onConfirm}>Move to Trash Anyway</Button>
				</AlertDialogAction>
			</div>
		</AlertDialog>
	);
}
