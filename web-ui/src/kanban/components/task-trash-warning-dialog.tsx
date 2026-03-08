import { Alert, Classes, Pre } from "@blueprintjs/core";
import type { ReactElement } from "react";

import { formatPathForDisplay } from "@/kanban/utils/path-display";

export interface TaskTrashWarningViewModel {
	taskTitle: string;
	fileCount: number;
	workspacePath: string | null;
}

export function TaskTrashWarningDialog({
	open,
	warning,
	guidance,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	warning: TaskTrashWarningViewModel | null;
	guidance: string[];
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
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
			{warning?.workspacePath ? (
				<Pre style={{ margin: "8px 0" }}>{formatPathForDisplay(warning.workspacePath)}</Pre>
			) : null}
			{guidance.map((line) => (
				<p key={line} className={Classes.TEXT_MUTED}>
					{line}
				</p>
			))}
		</Alert>
	);
}
