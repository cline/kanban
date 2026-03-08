import { Alert, Classes, Pre } from "@blueprintjs/core";
import type { ReactElement } from "react";

import type { RuntimeTaskWorkspaceInfoResponse } from "@/kanban/runtime/types";
import { formatPathForDisplay } from "@/kanban/utils/path-display";

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
		<Alert
			isOpen={open}
			icon="warning-sign"
			intent="danger"
			confirmButtonText="Move to Trash Anyway"
			cancelButtonText="Cancel"
			onConfirm={onConfirm}
			onCancel={onCancel}
			canEscapeKeyCancel
		>
			<h4 className={Classes.HEADING}>Unsaved task changes detected</h4>
			<p className={Classes.TEXT_MUTED} style={{ marginBottom: 12 }}>
				{warning
					? `${warning.taskTitle} has ${warning.fileCount} changed file(s).`
					: "This task has uncommitted changes."}
			</p>
			<p>Moving to Trash will delete this task worktree. Preserve your work first, then trash the task.</p>
			{warning?.workspaceInfo?.path ? (
				<Pre style={{ margin: "8px 0" }}>{formatPathForDisplay(warning.workspaceInfo.path)}</Pre>
			) : null}
			{guidance.map((line) => (
				<p key={line} className={Classes.TEXT_MUTED}>
					{line}
				</p>
			))}
		</Alert>
	);
}
