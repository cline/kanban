import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					onCancel();
				}
			}}
		>
			<DialogContent className="border-border bg-card text-foreground">
				<DialogHeader>
					<DialogTitle>Unsaved task changes detected</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						{warning
							? `${warning.taskTitle} has ${warning.fileCount} changed file(s).`
							: "This task has uncommitted changes."}
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-2 text-sm text-muted-foreground">
					<p>Moving to Trash will delete this task worktree. Preserve your work first, then trash the task.</p>
					{warning?.workspacePath ? (
						<p className="rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground">
							{warning.workspacePath}
						</p>
					) : null}
					{guidance.map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onCancel}>
						Cancel
					</Button>
					<Button variant="destructive" onClick={onConfirm}>
						Move to Trash Anyway
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
