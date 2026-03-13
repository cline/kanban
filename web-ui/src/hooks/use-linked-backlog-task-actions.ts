import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import type { RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import {
	addTaskDependency,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
	removeTaskDependency,
	trashTaskAndGetReadyLinkedTaskIds,
} from "@/state/board-state";
import { getTaskWorkspaceInfo } from "@/stores/workspace-metadata-store";
import { trackTaskDependencyCreated, trackTasksAutoStartedFromDependency } from "@/telemetry/events";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";
import { getNextDetailTaskIdAfterTrashMove } from "@/utils/detail-view-task-order";
import { truncateTaskPromptLabel } from "@/utils/task-prompt";

export interface PendingTrashWarningState {
	taskId: string;
	fileCount: number;
	taskTitle: string;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

interface RequestMoveTaskToTrashOptions {
	optimisticMoveApplied?: boolean;
	skipWorkingChangeWarning?: boolean;
}

export function useLinkedBacklogTaskActions({
	board,
	setBoard,
	setSelectedTaskId,
	setPendingTrashWarning,
	stopTaskSession,
	cleanupTaskWorkspace,
	fetchTaskWorkingChangeCount,
	fetchTaskWorkspaceInfo,
	maybeRequestNotificationPermissionForTaskStart,
	kickoffTaskInProgress,
	startBacklogTaskWithAnimation,
	waitForBacklogStartAnimationAvailability,
}: {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	setPendingTrashWarning: Dispatch<SetStateAction<PendingTrashWarningState | null>>;
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
	fetchTaskWorkingChangeCount: (task: BoardCard) => Promise<number | null>;
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
	maybeRequestNotificationPermissionForTaskStart: () => void;
	kickoffTaskInProgress: (
		task: BoardCard,
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: { optimisticMove?: boolean },
	) => Promise<boolean>;
	startBacklogTaskWithAnimation?: (task: BoardCard) => Promise<boolean>;
	waitForBacklogStartAnimationAvailability?: () => Promise<void>;
}): {
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	handleDeleteDependency: (dependencyId: string) => void;
	confirmMoveTaskToTrash: (task: BoardCard, currentBoard?: BoardData) => Promise<void>;
	requestMoveTaskToTrash: (
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: RequestMoveTaskToTrashOptions,
	) => Promise<void>;
} {
	const boardRef = useRef(board);

	useEffect(() => {
		boardRef.current = board;
	}, [board]);

	const handleCreateDependency = useCallback(
		(fromTaskId: string, toTaskId: string) => {
			const result = addTaskDependency(boardRef.current, fromTaskId, toTaskId);
			if (!result.added) {
				const message =
					result.reason === "same_task"
						? "A task cannot be linked to itself."
						: result.reason === "duplicate"
							? "Link already exists."
							: result.reason === "trash_task"
								? "Links cannot include trashed tasks."
								: result.reason === "non_backlog"
									? "Links must include at least one Backlog task."
									: "Could not create link.";
				showAppToast({
					intent: "warning",
					icon: "warning-sign",
					message,
					timeout: 3000,
				});
				return;
			}

			setBoard((currentBoard) => {
				const latestResult = addTaskDependency(currentBoard, fromTaskId, toTaskId);
				return latestResult.added ? latestResult.board : currentBoard;
			});
			trackTaskDependencyCreated();
		},
		[setBoard],
	);

	const handleDeleteDependency = useCallback(
		(dependencyId: string) => {
			setBoard((currentBoard) => {
				const removed = removeTaskDependency(currentBoard, dependencyId);
				return removed.removed ? removed.board : currentBoard;
			});
		},
		[setBoard],
	);

	const performMoveTaskToTrash = useCallback(
		async (task: BoardCard, currentBoard?: BoardData): Promise<void> => {
			const boardBeforeTrash = currentBoard ?? boardRef.current;
			const trashed = trashTaskAndGetReadyLinkedTaskIds(boardBeforeTrash, task.id);
			if (!trashed.moved) {
				await stopTaskSession(task.id);
				await cleanupTaskWorkspace(task.id);
				return;
			}

			setBoard((currentBoardState) => {
				const latestTrashResult = trashTaskAndGetReadyLinkedTaskIds(currentBoardState, task.id);
				return latestTrashResult.moved ? latestTrashResult.board : currentBoardState;
			});
			setSelectedTaskId((currentSelectedTaskId) =>
				currentSelectedTaskId === task.id
					? getNextDetailTaskIdAfterTrashMove(boardBeforeTrash, task.id)
					: currentSelectedTaskId,
			);

			const readyTasks = trashed.readyTaskIds
				.map((readyTaskId) => findCardSelection(trashed.board, readyTaskId)?.card ?? null)
				.filter((readyTask): readyTask is BoardCard => readyTask !== null);

			if (readyTasks.length > 0) {
				maybeRequestNotificationPermissionForTaskStart();
				let startedTaskCount = 0;
				if (startBacklogTaskWithAnimation) {
					const startedTaskPromises: Promise<boolean>[] = [];
					for (const [index, readyTask] of readyTasks.entries()) {
						startedTaskPromises.push(startBacklogTaskWithAnimation(readyTask));
						if (index < readyTasks.length - 1) {
							await waitForBacklogStartAnimationAvailability?.();
						}
					}
					const startedTasks = await Promise.all(startedTaskPromises);
					startedTaskCount = startedTasks.filter(Boolean).length;
				} else {
					setBoard((currentBoardState) => {
						let nextBoardState = currentBoardState;
						for (const readyTask of readyTasks) {
							const moved = moveTaskToColumn(nextBoardState, readyTask.id, "in_progress", {
								insertAtTop: true,
							});
							if (moved.moved) {
								nextBoardState = moved.board;
							}
						}
						return nextBoardState;
					});
					for (const readyTask of readyTasks) {
						const started = await kickoffTaskInProgress(readyTask, readyTask.id, "backlog", {
							optimisticMove: true,
						});
						if (started) {
							startedTaskCount += 1;
						}
					}
				}
				if (startedTaskCount > 0) {
					trackTasksAutoStartedFromDependency(startedTaskCount);
				}
			}

			await Promise.all([stopTaskSession(task.id), stopTaskSession(getDetailTerminalTaskId(task.id))]);
			await cleanupTaskWorkspace(task.id);
		},
		[
			cleanupTaskWorkspace,
			kickoffTaskInProgress,
			maybeRequestNotificationPermissionForTaskStart,
			setBoard,
			setSelectedTaskId,
			startBacklogTaskWithAnimation,
			stopTaskSession,
			waitForBacklogStartAnimationAvailability,
		],
	);

	const requestMoveTaskToTrash = useCallback(
		async (taskId: string, fromColumnId: BoardColumnId, options?: RequestMoveTaskToTrashOptions): Promise<void> => {
			const boardSnapshot = boardRef.current;
			const selection = findCardSelection(boardSnapshot, taskId);
			if (!selection) {
				return;
			}

			const moveSelectionIfOptimisticMoveIsConfirmed = () => {
				if (!options?.optimisticMoveApplied) {
					return;
				}
				setSelectedTaskId((currentSelectedTaskId) =>
					currentSelectedTaskId === taskId
						? getNextDetailTaskIdAfterTrashMove(boardSnapshot, taskId)
						: currentSelectedTaskId,
				);
			};

			if (options?.skipWorkingChangeWarning) {
				moveSelectionIfOptimisticMoveIsConfirmed();
				await performMoveTaskToTrash(selection.card, boardSnapshot);
				return;
			}

			const changeCount = await fetchTaskWorkingChangeCount(selection.card);
			if (changeCount == null) {
				moveSelectionIfOptimisticMoveIsConfirmed();
				await performMoveTaskToTrash(selection.card, boardSnapshot);
				return;
			}

			if (changeCount > 0) {
				if (options?.optimisticMoveApplied) {
					setBoard((currentBoardState) => {
						const currentColumnId = getTaskColumnId(currentBoardState, taskId);
						if (currentColumnId !== "trash") {
							return currentBoardState;
						}
						const reverted = moveTaskToColumn(currentBoardState, taskId, fromColumnId);
						return reverted.moved ? reverted.board : currentBoardState;
					});
				}
				const workspaceInfo =
					getTaskWorkspaceInfo(selection.card.id, selection.card.baseRef) ??
					(await fetchTaskWorkspaceInfo(selection.card));
				setPendingTrashWarning({
					taskId,
					fileCount: changeCount,
					taskTitle: truncateTaskPromptLabel(selection.card.prompt) || `Task ${taskId}`,
					workspaceInfo,
				});
				return;
			}

			moveSelectionIfOptimisticMoveIsConfirmed();
			await performMoveTaskToTrash(selection.card, boardSnapshot);
		},
		[
			fetchTaskWorkingChangeCount,
			fetchTaskWorkspaceInfo,
			performMoveTaskToTrash,
			setBoard,
			setPendingTrashWarning,
			setSelectedTaskId,
		],
	);

	return {
		handleCreateDependency,
		handleDeleteDependency,
		confirmMoveTaskToTrash: async (task: BoardCard, currentBoard?: BoardData) => {
			await performMoveTaskToTrash(task, currentBoard);
		},
		requestMoveTaskToTrash,
	};
}
