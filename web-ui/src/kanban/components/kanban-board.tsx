import { DragDropContext, type BeforeCapture, type DragStart, type DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import { DependencyOverlay } from "@/kanban/components/dependencies/dependency-overlay";
import { useDependencyLinking } from "@/kanban/components/dependencies/use-dependency-linking";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import { canCreateTaskDependency } from "@/kanban/state/board-state";
import { findCardColumnId } from "@/kanban/state/drag-rules";
import type { BoardCard, BoardColumnId, BoardData, BoardDependency, ReviewTaskWorkspaceSnapshot } from "@/kanban/types";

export function KanbanBoard({
	data,
	taskSessions,
	onCardSelect,
	onCreateTask,
	onStartTask,
	onClearTrash,
	inlineTaskCreator,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onMoveToTrashTask,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	reviewWorkspaceSnapshots,
	dependencies,
	onCreateDependency,
	onDeleteDependency,
	onDragEnd,
}: {
	data: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onCardSelect: (taskId: string) => void;
	onCreateTask: () => void;
	onStartTask?: (taskId: string) => void;
	onClearTrash?: () => void;
	inlineTaskCreator?: ReactNode;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveToTrashTask?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	reviewWorkspaceSnapshots?: Record<string, ReviewTaskWorkspaceSnapshot>;
	dependencies: BoardDependency[];
	onCreateDependency?: (fromTaskId: string, toTaskId: string) => void;
	onDeleteDependency?: (dependencyId: string) => void;
	onDragEnd: (result: DropResult) => void;
}): React.ReactElement {
	const dragOccurredRef = useRef(false);
	const boardRef = useRef<HTMLElement>(null);
	const [activeDragSourceColumnId, setActiveDragSourceColumnId] = useState<BoardColumnId | null>(null);
	const dependencyLinking = useDependencyLinking({
		canLinkTasks: (fromTaskId, toTaskId) => canCreateTaskDependency(data, fromTaskId, toTaskId),
		onCreateDependency,
	});

	const handleBeforeCapture = useCallback((start: BeforeCapture) => {
		setActiveDragSourceColumnId(findCardColumnId(data.columns, start.draggableId));
	}, [data]);

	const handleDragStart = useCallback((_start: DragStart) => {
		dragOccurredRef.current = true;
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			setActiveDragSourceColumnId(null);
			requestAnimationFrame(() => {
				dragOccurredRef.current = false;
			});
			onDragEnd(result);
		},
		[onDragEnd],
	);

	return (
		<DragDropContext onBeforeCapture={handleBeforeCapture} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
			<section ref={boardRef} className="kb-board kb-dependency-surface">
				{data.columns.map((column) => (
					<BoardColumn
						key={column.id}
						column={column}
						taskSessions={taskSessions}
						onCreateTask={column.id === "backlog" ? onCreateTask : undefined}
						onStartTask={column.id === "backlog" ? onStartTask : undefined}
						onClearTrash={column.id === "trash" ? onClearTrash : undefined}
						inlineTaskCreator={column.id === "backlog" ? inlineTaskCreator : undefined}
						editingTaskId={column.id === "backlog" ? editingTaskId : null}
						inlineTaskEditor={column.id === "backlog" ? inlineTaskEditor : undefined}
						onEditTask={column.id === "backlog" ? onEditTask : undefined}
						onCommitTask={column.id === "review" ? onCommitTask : undefined}
						onOpenPrTask={column.id === "review" ? onOpenPrTask : undefined}
						onMoveToTrashTask={column.id === "review" ? onMoveToTrashTask : undefined}
						commitTaskLoadingById={column.id === "review" ? commitTaskLoadingById : undefined}
						openPrTaskLoadingById={column.id === "review" ? openPrTaskLoadingById : undefined}
						reviewWorkspaceSnapshots={column.id === "review" || column.id === "in_progress" ? reviewWorkspaceSnapshots : undefined}
						activeDragSourceColumnId={activeDragSourceColumnId}
						onDependencyPointerDown={dependencyLinking.onDependencyPointerDown}
						onDependencyPointerEnter={dependencyLinking.onDependencyPointerEnter}
						dependencySourceTaskId={dependencyLinking.draft?.sourceTaskId ?? null}
						dependencyTargetTaskId={dependencyLinking.draft?.targetTaskId ?? null}
						isDependencyLinking={dependencyLinking.draft !== null}
						onCardClick={(card) => {
							if (!dragOccurredRef.current) {
								onCardSelect(card.id);
							}
						}}
					/>
				))}
				<DependencyOverlay
					containerRef={boardRef}
					dependencies={dependencies}
					draft={dependencyLinking.draft}
					onDeleteDependency={onDeleteDependency}
				/>
			</section>
		</DragDropContext>
	);
}
