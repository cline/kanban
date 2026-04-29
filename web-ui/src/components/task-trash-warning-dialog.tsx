import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
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
		return ["Save your changes before marking this task as done."];
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
		"After preserving the work, you can safely move this task to Done.",
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
		<AlertDialog
			open={open}
			onOpenChange={(isOpen) => {
				if (!isOpen) onCancel();
			}}
		>
			<AlertDialogHeader>
				<AlertDialogTitle>Unsaved task changes detected</AlertDialogTitle>
			</AlertDialogHeader>
			<AlertDialogBody>
				<AlertDialogDescription>
					{warning
						? `${warning.taskTitle} has ${warning.fileCount} changed file(s).`
						: "This task has uncommitted changes."}
				</AlertDialogDescription>
				<p>Moving to Done will delete this task worktree. Preserve your work first, then move the task to done.</p>
				{warning?.workspaceInfo?.path ? (
					<pre className="overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
						{formatPathForDisplay(warning.workspaceInfo.path)}
					</pre>
				) : null}
				<div className="flex flex-col gap-1">
					{guidance.map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
			</AlertDialogBody>
			<AlertDialogFooter>
				<AlertDialogCancel asChild>
					<Button variant="default" onClick={onCancel}>
						Cancel
					</Button>
				</AlertDialogCancel>
				<AlertDialogAction asChild>
					<Button variant="danger" onClick={onConfirm}>
						Move to Done Anyway
					</Button>
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialog>
	);
}
