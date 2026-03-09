import { Alert, Classes } from "@blueprintjs/core";
import type { ReactElement } from "react";

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
		<Alert
			isOpen={open}
			icon="trash"
			intent="danger"
			confirmButtonText="Clear Trash"
			cancelButtonText="Cancel"
			onConfirm={onConfirm}
			onCancel={onCancel}
			canEscapeKeyCancel
		>
			<h4 className={Classes.HEADING}>Clear trash permanently?</h4>
			<p className={Classes.TEXT_MUTED}>
				This will permanently delete {taskCount} {taskLabel} from Trash.
			</p>
			<p>This action cannot be undone.</p>
		</Alert>
	);
}
