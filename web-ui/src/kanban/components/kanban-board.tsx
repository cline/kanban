import {
	DragDropContext,
	type BeforeCapture,
	type DragStart,
	type DropResult,
	type Sensor,
	type SensorAPI,
	type SnapDragActions,
} from "@hello-pangea/dnd";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { BoardColumn } from "@/kanban/components/board-column";
import { DependencyOverlay } from "@/kanban/components/dependencies/dependency-overlay";
import { useDependencyLinking } from "@/kanban/components/dependencies/use-dependency-linking";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import { canCreateTaskDependency } from "@/kanban/state/board-state";
import { findCardColumnId, type ProgrammaticCardMoveInFlight } from "@/kanban/state/drag-rules";
import type { BoardCard, BoardColumnId, BoardData, BoardDependency, ReviewTaskWorkspaceSnapshot } from "@/kanban/types";

const BOARD_COLUMN_ORDER: BoardColumnId[] = ["backlog", "in_progress", "review", "trash"];

export type RequestProgrammaticCardMove = (move: ProgrammaticCardMoveInFlight) => boolean;

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
	onRequestProgrammaticCardMoveReady,
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
	onRequestProgrammaticCardMoveReady?: (requestMove: RequestProgrammaticCardMove | null) => void;
}): React.ReactElement {
	const dragOccurredRef = useRef(false);
	const boardRef = useRef<HTMLElement>(null);
	const sensorApiRef = useRef<SensorAPI | null>(null);
	const latestDataRef = useRef<BoardData>(data);
	const programmaticCardMoveInFlightRef = useRef<ProgrammaticCardMoveInFlight | null>(null);
	const [activeDragTaskId, setActiveDragTaskId] = useState<string | null>(null);
	const [activeDragSourceColumnId, setActiveDragSourceColumnId] = useState<BoardColumnId | null>(null);
	const [programmaticCardMoveInFlight, setProgrammaticCardMoveInFlight] = useState<ProgrammaticCardMoveInFlight | null>(null);
	const dependencyLinking = useDependencyLinking({
		canLinkTasks: (fromTaskId, toTaskId) => canCreateTaskDependency(data, fromTaskId, toTaskId),
		onCreateDependency,
	});

	useEffect(() => {
		latestDataRef.current = data;
	}, [data]);

	const programmaticSensor: Sensor = useCallback((api: SensorAPI) => {
		sensorApiRef.current = api;
	}, []);

	const clearProgrammaticCardMoveInFlight = useCallback((taskId?: string) => {
		if (taskId && programmaticCardMoveInFlightRef.current?.taskId !== taskId) {
			return;
		}
		programmaticCardMoveInFlightRef.current = null;
		setProgrammaticCardMoveInFlight(null);
	}, []);

	const requestProgrammaticCardMove = useCallback<RequestProgrammaticCardMove>((move) => {
		const { taskId, toColumnId: targetColumnId } = move;
		const board = latestDataRef.current;
		const sourceColumnId = findCardColumnId(board.columns, taskId);
		if (!sourceColumnId || sourceColumnId !== move.fromColumnId || sourceColumnId === targetColumnId) {
			return false;
		}

		const sensorApi = sensorApiRef.current;
		if (!sensorApi) {
			return false;
		}

		const sourceOrderIndex = BOARD_COLUMN_ORDER.indexOf(sourceColumnId);
		const targetOrderIndex = BOARD_COLUMN_ORDER.indexOf(targetColumnId);
		if (sourceOrderIndex < 0 || targetOrderIndex < 0) {
			return false;
		}

		const horizontalSteps = targetOrderIndex - sourceOrderIndex;
		programmaticCardMoveInFlightRef.current = move;
		setProgrammaticCardMoveInFlight(move);
		const preDrag = sensorApi.tryGetLock(taskId);
		if (!preDrag) {
			clearProgrammaticCardMoveInFlight(taskId);
			return false;
		}

		let dragActions: SnapDragActions;
		try {
			dragActions = preDrag.snapLift();
		} catch {
			clearProgrammaticCardMoveInFlight(taskId);
			if (preDrag.isActive()) {
				preDrag.abort();
			}
			return false;
		}

		const moveOneStep = horizontalSteps > 0 ? dragActions.moveRight : dragActions.moveLeft;
		const targetColumn = board.columns.find((column) => column.id === targetColumnId);
		const verticalToTopSteps = targetColumnId === "trash"
			? (targetColumn?.cards.length ?? 0) + 1
			: 0;
		const moveSteps: Array<() => void> = [];
		for (let step = 0; step < Math.abs(horizontalSteps); step += 1) {
			moveSteps.push(moveOneStep);
		}
		for (let step = 0; step < verticalToTopSteps; step += 1) {
			moveSteps.push(dragActions.moveUp);
		}

		const performStep = (stepIndex: number) => {
			if (!dragActions.isActive()) {
				return;
			}
			try {
				if (stepIndex >= moveSteps.length) {
					dragActions.drop();
					return;
				}
				moveSteps[stepIndex]?.();
				window.setTimeout(() => {
					performStep(stepIndex + 1);
				}, 90);
			} catch {
				clearProgrammaticCardMoveInFlight(taskId);
				if (dragActions.isActive()) {
					dragActions.cancel();
				}
			}
		};

		window.requestAnimationFrame(() => {
			window.requestAnimationFrame(() => {
				performStep(0);
			});
		});
		return true;
	}, [clearProgrammaticCardMoveInFlight]);

	useEffect(() => {
		onRequestProgrammaticCardMoveReady?.(requestProgrammaticCardMove);
		return () => {
			onRequestProgrammaticCardMoveReady?.(null);
		};
	}, [onRequestProgrammaticCardMoveReady, requestProgrammaticCardMove]);

	const handleBeforeCapture = useCallback((start: BeforeCapture) => {
		setActiveDragTaskId(start.draggableId);
		setActiveDragSourceColumnId(findCardColumnId(data.columns, start.draggableId));
	}, [data]);

	const handleDragStart = useCallback((_start: DragStart) => {
		dragOccurredRef.current = true;
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			setActiveDragTaskId(null);
			setActiveDragSourceColumnId(null);
			clearProgrammaticCardMoveInFlight(result.draggableId);
			requestAnimationFrame(() => {
				dragOccurredRef.current = false;
			});
			onDragEnd(result);
		},
		[clearProgrammaticCardMoveInFlight, onDragEnd],
	);

	return (
		<DragDropContext
			onBeforeCapture={handleBeforeCapture}
			onDragStart={handleDragStart}
			onDragEnd={handleDragEnd}
			sensors={[programmaticSensor]}
		>
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
						activeDragTaskId={activeDragTaskId}
						activeDragSourceColumnId={activeDragSourceColumnId}
						programmaticCardMoveInFlight={programmaticCardMoveInFlight}
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
