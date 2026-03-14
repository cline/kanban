import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogTitle,
} from "@/components/ui/dialog";

export function ClearTrashDialog({
	open,
	taskCount,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	taskCount: number;
	onCancel: () => void;
	onConfirm: () => void;
}): ReactElement {
	const taskLabel = taskCount === 1 ? "task" : "tasks";

	return (
		<AlertDialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
			<AlertDialogTitle className="text-sm font-semibold text-text-primary">
				Clear trash permanently?
			</AlertDialogTitle>
			<AlertDialogDescription className="text-text-secondary mt-2">
				This will permanently delete {taskCount} {taskLabel} from Trash.
			</AlertDialogDescription>
			<p className="text-[13px] text-text-primary mt-2">This action cannot be undone.</p>
			<div className="flex justify-end gap-2 mt-4">
				<AlertDialogCancel asChild>
					<Button variant="default" onClick={onCancel}>Cancel</Button>
				</AlertDialogCancel>
				<AlertDialogAction asChild>
					<Button variant="danger" onClick={onConfirm}>Clear Trash</Button>
				</AlertDialogAction>
			</div>
		</AlertDialog>
	);
}
