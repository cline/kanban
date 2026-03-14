import { useCallback, useEffect, useRef } from "react";

import type { TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { findCardSelection } from "@/state/board-state";
import { getTaskWorkspaceSnapshot, subscribeToAnyTaskMetadata } from "@/stores/workspace-metadata-store";
import type { BoardCard, BoardColumnId, BoardData, TaskAutoReviewMode } from "@/types";
import { resolveTaskAutoReviewMode } from "@/types";

const AUTO_REVIEW_ACTION_DELAY_MS = 500;

function isTaskAutoReviewEnabled(task: BoardCard): boolean {
	return task.autoReviewEnabled === true;
}

interface TaskGitActionLoadingStateLike {
	commitSource: string | null;
	prSource: string | null;
}

interface RequestMoveTaskToTrashOptions {
	skipWorkingChangeWarning?: boolean;
}

interface UseReviewAutoActionsOptions {
	board: BoardData;
	taskGitActionLoadingByTaskId: Record<string, TaskGitActionLoadingStateLike>;
	runAutoReviewGitAction: (taskId: string, action: TaskGitAction) => Promise<boolean>;
	requestMoveTaskToTrash: (
		taskId: string,
		fromColumnId: BoardColumnId,
		options?: RequestMoveTaskToTrashOptions,
	) => Promise<void>;
	resetKey?: string | null;
}

export function useReviewAutoActions({
	board,
	taskGitActionLoadingByTaskId,
	runAutoReviewGitAction,
	requestMoveTaskToTrash,
	resetKey,
}: UseReviewAutoActionsOptions): void {
	const boardRef = useRef<BoardData>(board);
	const runAutoReviewGitActionRef = useRef(runAutoReviewGitAction);
	const requestMoveTaskToTrashRef = useRef(requestMoveTaskToTrash);
	const awaitingCleanActionByTaskIdRef = useRef<Record<string, TaskGitAction>>({});
	const timerByTaskIdRef = useRef<Record<string, number>>({});
	const scheduledActionByTaskIdRef = useRef<Record<string, TaskAutoReviewMode>>({});
	const moveToTrashInFlightTaskIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		boardRef.current = board;
	}, [board]);

	useEffect(() => {
		runAutoReviewGitActionRef.current = runAutoReviewGitAction;
	}, [runAutoReviewGitAction]);

	useEffect(() => {
		requestMoveTaskToTrashRef.current = requestMoveTaskToTrash;
	}, [requestMoveTaskToTrash]);

	const clearAutoReviewTimer = useCallback((taskId: string) => {
		const timer = timerByTaskIdRef.current[taskId];
		if (typeof timer === "number") {
			window.clearTimeout(timer);
		}
		delete timerByTaskIdRef.current[taskId];
		delete scheduledActionByTaskIdRef.current[taskId];
	}, []);

	const clearAllAutoReviewState = useCallback(() => {
		for (const timer of Object.values(timerByTaskIdRef.current)) {
			window.clearTimeout(timer);
		}
		awaitingCleanActionByTaskIdRef.current = {};
		timerByTaskIdRef.current = {};
		scheduledActionByTaskIdRef.current = {};
		moveToTrashInFlightTaskIdsRef.current.clear();
	}, []);

	const scheduleAutoReviewAction = useCallback((taskId: string, action: TaskAutoReviewMode, execute: () => void) => {
		const existingTimer = timerByTaskIdRef.current[taskId];
		const existingAction = scheduledActionByTaskIdRef.current[taskId];
		if (typeof existingTimer === "number" && existingAction === action) {
			return;
		}
		if (typeof existingTimer === "number") {
			window.clearTimeout(existingTimer);
		}
		scheduledActionByTaskIdRef.current[taskId] = action;
		timerByTaskIdRef.current[taskId] = window.setTimeout(() => {
			delete timerByTaskIdRef.current[taskId];
			delete scheduledActionByTaskIdRef.current[taskId];
			execute();
		}, AUTO_REVIEW_ACTION_DELAY_MS);
	}, []);

	useEffect(() => {
		return () => {
			clearAllAutoReviewState();
		};
	}, [clearAllAutoReviewState]);

	useEffect(() => {
		clearAllAutoReviewState();
	}, [clearAllAutoReviewState, resetKey]);

	const evaluateAutoReview = useCallback(
		(_trigger: { source: string; taskId?: string }) => {
			const columnByTaskId = new Map<string, BoardColumnId>();
			const reviewCardsForAutomation: BoardCard[] = [];
			for (const column of boardRef.current.columns) {
				for (const card of column.cards) {
					columnByTaskId.set(card.id, column.id);
					if (column.id === "review") {
						reviewCardsForAutomation.push(card);
					}
				}
			}

			for (const taskId of Object.keys(awaitingCleanActionByTaskIdRef.current)) {
				const columnId = columnByTaskId.get(taskId);
				if (!columnId || columnId === "trash") {
					delete awaitingCleanActionByTaskIdRef.current[taskId];
					clearAutoReviewTimer(taskId);
					moveToTrashInFlightTaskIdsRef.current.delete(taskId);
				}
			}

			for (const taskId of moveToTrashInFlightTaskIdsRef.current) {
				if (columnByTaskId.get(taskId) !== "review") {
					moveToTrashInFlightTaskIdsRef.current.delete(taskId);
				}
			}

			const reviewTaskIds = new Set(reviewCardsForAutomation.map((card) => card.id));
			for (const taskId of Object.keys(timerByTaskIdRef.current)) {
				if (!reviewTaskIds.has(taskId)) {
					clearAutoReviewTimer(taskId);
				}
			}

			for (const reviewTask of reviewCardsForAutomation) {
				const autoReviewEnabled = isTaskAutoReviewEnabled(reviewTask);
				if (!autoReviewEnabled) {
					delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
					clearAutoReviewTimer(reviewTask.id);
					continue;
				}

				const autoReviewMode = resolveTaskAutoReviewMode(reviewTask.autoReviewMode);
				const loadingState = taskGitActionLoadingByTaskId[reviewTask.id];
				const isGitActionInFlight =
					autoReviewMode === "commit"
						? loadingState?.commitSource !== null && loadingState?.commitSource !== undefined
						: autoReviewMode === "pr"
							? loadingState?.prSource !== null && loadingState?.prSource !== undefined
							: false;

				if (autoReviewMode === "move_to_trash") {
					if (moveToTrashInFlightTaskIdsRef.current.has(reviewTask.id)) {
						continue;
					}
					scheduleAutoReviewAction(reviewTask.id, "move_to_trash", () => {
						const latestSelection = findCardSelection(boardRef.current, reviewTask.id);
						if (!latestSelection || latestSelection.column.id !== "review") {
							return;
						}
						if (!isTaskAutoReviewEnabled(latestSelection.card)) {
							return;
						}
						if (resolveTaskAutoReviewMode(latestSelection.card.autoReviewMode) !== "move_to_trash") {
							return;
						}
						delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
						moveToTrashInFlightTaskIdsRef.current.add(reviewTask.id);
						void requestMoveTaskToTrashRef
							.current(reviewTask.id, "review", {
								skipWorkingChangeWarning: true,
							})
							.finally(() => {
								moveToTrashInFlightTaskIdsRef.current.delete(reviewTask.id);
							});
					});
					continue;
				}

				// Commit/PR automation mental model:
				// - A task is only "armed" for auto-trash after we actually see working changes in review and trigger commit/pr.
				// - Review entries with zero changes (common during start-in-plan-mode planning loops) are intentionally ignored.
				// - Once armed, a later review state with zero changes is treated as commit/pr success, then we auto-move to trash.
				const changedFiles = getTaskWorkspaceSnapshot(reviewTask.id)?.changedFiles;
				const awaitingAction = awaitingCleanActionByTaskIdRef.current[reviewTask.id] ?? null;
				if (awaitingAction) {
					if (
						changedFiles === 0 &&
						!isGitActionInFlight &&
						!moveToTrashInFlightTaskIdsRef.current.has(reviewTask.id)
					) {
						scheduleAutoReviewAction(reviewTask.id, "move_to_trash", () => {
							const latestSelection = findCardSelection(boardRef.current, reviewTask.id);
							if (!latestSelection || latestSelection.column.id !== "review") {
								return;
							}
							if (!isTaskAutoReviewEnabled(latestSelection.card)) {
								return;
							}
							const latestMode = resolveTaskAutoReviewMode(latestSelection.card.autoReviewMode);
							if (latestMode !== autoReviewMode) {
								return;
							}
							moveToTrashInFlightTaskIdsRef.current.add(reviewTask.id);
							void requestMoveTaskToTrashRef
								.current(reviewTask.id, "review", {
									skipWorkingChangeWarning: true,
								})
								.finally(() => {
									delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
									moveToTrashInFlightTaskIdsRef.current.delete(reviewTask.id);
								});
						});
					} else {
						clearAutoReviewTimer(reviewTask.id);
					}
					continue;
				}

				if ((changedFiles ?? 0) <= 0 || isGitActionInFlight) {
					clearAutoReviewTimer(reviewTask.id);
					continue;
				}

				scheduleAutoReviewAction(reviewTask.id, autoReviewMode, () => {
					const latestSelection = findCardSelection(boardRef.current, reviewTask.id);
					if (!latestSelection || latestSelection.column.id !== "review") {
						return;
					}
					if (!isTaskAutoReviewEnabled(latestSelection.card)) {
						return;
					}
					const latestMode = resolveTaskAutoReviewMode(latestSelection.card.autoReviewMode);
					if (latestMode !== autoReviewMode) {
						return;
					}
					awaitingCleanActionByTaskIdRef.current[reviewTask.id] = latestMode;
					void runAutoReviewGitActionRef.current(reviewTask.id, latestMode).then((triggered) => {
						if (!triggered && awaitingCleanActionByTaskIdRef.current[reviewTask.id] === latestMode) {
							delete awaitingCleanActionByTaskIdRef.current[reviewTask.id];
						}
					});
				});
			}
		},
		[clearAutoReviewTimer, scheduleAutoReviewAction, taskGitActionLoadingByTaskId],
	);

	useEffect(() => {
		evaluateAutoReview({
			source: "board_or_loading_change",
		});
	}, [board, evaluateAutoReview, taskGitActionLoadingByTaskId]);

	useEffect(() => {
		return subscribeToAnyTaskMetadata((taskId) => {
			const selection = findCardSelection(boardRef.current, taskId);
			if (!selection || selection.column.id !== "review") {
				return;
			}
			evaluateAutoReview({
				source: "task_metadata_store",
				taskId,
			});
		});
	}, [evaluateAutoReview]);
}
