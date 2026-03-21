import { useCallback, useEffect, useState } from "react";

import { findCardSelection } from "@/state/board-state";
import type { BoardData } from "@/types";

interface UseTaskStartActionsInput {
	board: BoardData;
	handleCreateTask: (options?: { keepDialogOpen?: boolean }) => string | null;
	handleCreateTasks: (prompts: string[], options?: { keepDialogOpen?: boolean }) => string[];
	handleStartTask: (taskId: string) => void;
	handleStartAllBacklogTasks: (taskIds?: string[]) => void;
}

export interface UseTaskStartActionsResult {
	handleCreateAndStartTask: (options?: { keepDialogOpen?: boolean }) => string | null;
	handleCreateAndStartTasks: (prompts: string[], options?: { keepDialogOpen?: boolean }) => string[];
	handleStartTaskFromBoard: (taskId: string) => void;
	handleStartAllBacklogTasksFromBoard: () => void;
}

export function getStartableBacklogTaskIds(board: BoardData): string[] {
	const allBacklogTasks = new Set<string>();
	const allInProgressTasks = new Set<string>();
	const startableTaskIds: string[] = [];

	const backlogCards = board.columns.find((column) => column.id === "backlog")?.cards;
	const inProgressTasks = board.columns.find((column) => column.id === "in_progress")?.cards;

	backlogCards?.forEach((card) => {
		allBacklogTasks.add(card.id);
	});
	inProgressTasks?.forEach((card) => {
		allInProgressTasks.add(card.id);
	});

	backlogCards?.forEach((card) => {
		const dependency = board.dependencies.find((d) => d.fromTaskId === card.id);
		const isChildTaskInBacklog = dependency && allBacklogTasks.has(dependency.toTaskId);
		const isChildTaskInProgress = dependency && allInProgressTasks.has(dependency.toTaskId);

		if (!isChildTaskInBacklog && !isChildTaskInProgress) {
			startableTaskIds.push(card.id);
		}
	});

	return startableTaskIds;
}

export function useTaskStartActions({
	board,
	handleCreateTask,
	handleCreateTasks,
	handleStartTask,
	handleStartAllBacklogTasks,
}: UseTaskStartActionsInput): UseTaskStartActionsResult {
	const [pendingTaskStartAfterCreateIds, setPendingTaskStartAfterCreateIds] = useState<string[] | null>(null);

	const startBacklogTasks = useCallback(
		(taskIds: string[]) => {
			const backlogTaskIds = [...new Set(taskIds.filter((taskId) => taskId.trim().length > 0))].filter((taskId) => {
				const selection = findCardSelection(board, taskId);
				return selection?.column.id === "backlog";
			});

			if (backlogTaskIds.length === 0) {
				return;
			}

			if (backlogTaskIds.length === 1) {
				const firstTaskId = backlogTaskIds[0];
				if (!firstTaskId) {
					return;
				}
				handleStartTask(firstTaskId);
				return;
			}
			handleStartAllBacklogTasks(backlogTaskIds);
		},
		[board, handleStartAllBacklogTasks, handleStartTask],
	);

	const handleStartTaskFromBoard = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "backlog") {
				handleStartTask(taskId);
				return;
			}
			startBacklogTasks([taskId]);
		},
		[board, handleStartTask, startBacklogTasks],
	);

	const handleStartAllBacklogTasksFromBoard = useCallback(() => {
		const backlogTaskIds = getStartableBacklogTaskIds(board);

		if (backlogTaskIds.length === 0) {
			return;
		}
		startBacklogTasks(backlogTaskIds);
	}, [board, startBacklogTasks]);

	const handleCreateAndStartTask = useCallback((options?: { keepDialogOpen?: boolean }): string | null => {
		const taskId = handleCreateTask(options);
		if (!taskId) {
			return null;
		}
		setPendingTaskStartAfterCreateIds([taskId]);
		return taskId;
	}, [handleCreateTask]);

	const handleCreateAndStartTasks = useCallback(
		(prompts: string[], options?: { keepDialogOpen?: boolean }): string[] => {
			const taskIds = handleCreateTasks(prompts, options);
			if (taskIds.length === 0) {
				return [];
			}
			setPendingTaskStartAfterCreateIds(taskIds);
			return taskIds;
		},
		[handleCreateTasks],
	);

	useEffect(() => {
		if (!pendingTaskStartAfterCreateIds || pendingTaskStartAfterCreateIds.length === 0) {
			return;
		}
		const allInBacklog = pendingTaskStartAfterCreateIds.every((taskId) => {
			const selection = findCardSelection(board, taskId);
			return selection?.column.id === "backlog";
		});
		if (!allInBacklog) {
			return;
		}
		startBacklogTasks(pendingTaskStartAfterCreateIds);
		setPendingTaskStartAfterCreateIds(null);
	}, [board, pendingTaskStartAfterCreateIds, startBacklogTasks]);

	return {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	};
}
