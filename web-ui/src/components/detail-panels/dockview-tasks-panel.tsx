// ── Dockview panel: Tasks (ColumnContextPanel) ──

import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import { useDetailPanelContext } from "./detail-panel-context";

export function DockviewTasksPanel() {
	const ctx = useDetailPanelContext();
	return (
		<ColumnContextPanel
			selection={ctx.selection}
			workspacePath={ctx.workspacePath}
			onCardSelect={ctx.onCardSelect}
			taskSessions={ctx.taskSessions}
			onTaskDragEnd={ctx.onTaskDragEnd}
			onCreateTask={ctx.onCreateTask}
			onStartTask={ctx.onStartTask}
			onStartAllTasks={ctx.onStartAllTasks}
			onClearTrash={ctx.onClearTrash}
			editingTaskId={ctx.editingTaskId}
			inlineTaskEditor={ctx.inlineTaskEditor}
			onEditTask={ctx.onEditTask}
			onCommitTask={ctx.onCommitTask}
			onOpenPrTask={ctx.onOpenPrTask}
			onMoveToTrashTask={ctx.onMoveReviewCardToTrash}
			onRestoreFromTrashTask={ctx.onRestoreTaskFromTrash}
			commitTaskLoadingById={ctx.commitTaskLoadingById}
			openPrTaskLoadingById={ctx.openPrTaskLoadingById}
			moveToTrashLoadingById={ctx.moveToTrashLoadingById}
		/>
	);
}
