import { useCallback, useEffect, useRef } from "react";

import { showAppToast } from "@/components/app-toaster";
import type { TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { findCardSelection } from "@/state/board-state";
import { getTaskWorkspaceSnapshot, subscribeToAnyTaskMetadata } from "@/stores/workspace-metadata-store";
import type { BoardCard, BoardColumnId, BoardData, TaskAutoReviewMode, TaskPendingGitAction } from "@/types";
import { isPendingGitActionStale, resolveTaskAutoReviewMode } from "@/types";

const AUTO_REVIEW_ACTION_DELAY_MS = 500;

function isTaskAutoReviewEnabled(task: BoardCard): boolean {
	return task.autoReviewEnabled === true;
}

/**
 * Persists (or clears) the durable `pendingGitAction` arming state on a card.
 * Returns `true` when the requested state was applied, and `false` when the write was
 * refused (for example because another tab already armed the same card).
 */
export type PersistPendingGitAction = (taskId: string, value: TaskPendingGitAction | null) => Promise<boolean>;

const noopPersistPendingGitAction: PersistPendingGitAction = async () => true;

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
	persistPendingGitAction?: PersistPendingGitAction;
}

export function useReviewAutoActions({
	board,
	taskGitActionLoadingByTaskId,
	runAutoReviewGitAction,
	requestMoveTaskToTrash,
	resetKey,
	persistPendingGitAction,
}: UseReviewAutoActionsOptions): void {
	const boardRef = useRef<BoardData>(board);
	const runAutoReviewGitActionRef = useRef(runAutoReviewGitAction);
	const requestMoveTaskToTrashRef = useRef(requestMoveTaskToTrash);
	const persistPendingGitActionRef = useRef<PersistPendingGitAction>(
		persistPendingGitAction ?? noopPersistPendingGitAction,
	);
	// In-memory mirror of the durable arming state. Bridges the window between arming a
	// card and the persisted `pendingGitAction` arriving back on the board. The card
	// field (server-side) is the source of truth; this ref alone must never be.
	const localPendingGitActionByTaskIdRef = useRef<Record<string, TaskPendingGitAction>>({});
	const timerByTaskIdRef = useRef<Record<string, number>>({});
	type ScheduledAutoReviewAction = TaskAutoReviewMode | "move_to_done_after_git_action";
	const scheduledActionByTaskIdRef = useRef<Record<string, ScheduledAutoReviewAction>>({});
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

	useEffect(() => {
		persistPendingGitActionRef.current = persistPendingGitAction ?? noopPersistPendingGitAction;
	}, [persistPendingGitAction]);

	const clearPendingGitAction = useCallback((taskId: string) => {
		void persistPendingGitActionRef.current(taskId, null).catch(() => {
			// Clearing is best-effort; the staleness timeout bounds a stranded entry.
		});
	}, []);

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
		// Only the ephemeral mirror is cleared here: the durable arming state lives on
		// the card (`pendingGitAction`) and must survive unmounts and project switches.
		localPendingGitActionByTaskIdRef.current = {};
		timerByTaskIdRef.current = {};
		scheduledActionByTaskIdRef.current = {};
		moveToTrashInFlightTaskIdsRef.current.clear();
	}, []);

	const scheduleAutoReviewAction = useCallback(
		(taskId: string, action: ScheduledAutoReviewAction, execute: () => void) => {
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
		},
		[],
	);

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
					} else if (card.pendingGitAction) {
						// A card that left review while armed must not stay armed forever.
						clearPendingGitAction(card.id);
					}
				}
			}

			for (const taskId of Object.keys(localPendingGitActionByTaskIdRef.current)) {
				const columnId = columnByTaskId.get(taskId);
				if (!columnId || columnId === "trash") {
					delete localPendingGitActionByTaskIdRef.current[taskId];
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
				const cardPendingGitAction = reviewTask.pendingGitAction ?? null;
				// Once the persisted arming state arrives back on the card, the local
				// mirror is redundant.
				if (cardPendingGitAction && localPendingGitActionByTaskIdRef.current[reviewTask.id]) {
					delete localPendingGitActionByTaskIdRef.current[reviewTask.id];
				}
				const pendingGitAction =
					cardPendingGitAction ?? localPendingGitActionByTaskIdRef.current[reviewTask.id] ?? null;

				const autoReviewEnabled = isTaskAutoReviewEnabled(reviewTask);
				if (!autoReviewEnabled) {
					delete localPendingGitActionByTaskIdRef.current[reviewTask.id];
					clearAutoReviewTimer(reviewTask.id);
					if (cardPendingGitAction) {
						clearPendingGitAction(reviewTask.id);
					}
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

				// Commit/PR automation mental model:
				// - A task is only "armed" for auto-done after we actually see working changes in review and trigger commit/pr.
				// - The arming state is persisted on the card (`pendingGitAction`) so it survives reloads,
				//   unmounts, and project switches, and acts as a cross-tab lock.
				// - Review entries with zero changes (common during start-in-plan-mode planning loops) are intentionally ignored.
				// - Once armed, completion is judged on evidence: the workspace HEAD moved past the commit
				//   recorded at arming time. Zero changed files with an unchanged HEAD means the tree was
				//   cleaned some other way and must NOT advance the card.
				const changedFiles = getTaskWorkspaceSnapshot(reviewTask.id)?.changedFiles;
				if (pendingGitAction) {
					if (isPendingGitActionStale(pendingGitAction)) {
						delete localPendingGitActionByTaskIdRef.current[reviewTask.id];
						clearAutoReviewTimer(reviewTask.id);
						clearPendingGitAction(reviewTask.id);
						showAppToast(
							{
								intent: "warning",
								icon: "warning-sign",
								message: `Auto-review ${pendingGitAction.action} for "${reviewTask.title}" timed out before completing. The card stays in Review.`,
								timeout: 7000,
							},
							`auto-review-pending-git-action-timeout-${reviewTask.id}`,
						);
						continue;
					}

					const headCommit = getTaskWorkspaceSnapshot(reviewTask.id)?.headCommit ?? null;
					const headCommitMoved = headCommit !== null && headCommit !== pendingGitAction.headCommitAtRequest;
					if (
						headCommitMoved &&
						!isGitActionInFlight &&
						!moveToTrashInFlightTaskIdsRef.current.has(reviewTask.id)
					) {
						scheduleAutoReviewAction(reviewTask.id, "move_to_done_after_git_action", () => {
							const latestSelection = findCardSelection(boardRef.current, reviewTask.id);
							if (!latestSelection || latestSelection.column.id !== "review") {
								return;
							}
							if (!isTaskAutoReviewEnabled(latestSelection.card)) {
								return;
							}
							const latestPendingGitAction =
								latestSelection.card.pendingGitAction ??
								localPendingGitActionByTaskIdRef.current[reviewTask.id] ??
								null;
							if (!latestPendingGitAction) {
								return;
							}
							const latestMode = resolveTaskAutoReviewMode(latestSelection.card.autoReviewMode);
							if (latestMode !== latestPendingGitAction.action) {
								return;
							}
							moveToTrashInFlightTaskIdsRef.current.add(reviewTask.id);
							void requestMoveTaskToTrashRef
								.current(reviewTask.id, "review", {
									skipWorkingChangeWarning: true,
								})
								.finally(() => {
									delete localPendingGitActionByTaskIdRef.current[reviewTask.id];
									moveToTrashInFlightTaskIdsRef.current.delete(reviewTask.id);
									clearPendingGitAction(reviewTask.id);
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
					if (latestSelection.card.pendingGitAction ?? localPendingGitActionByTaskIdRef.current[reviewTask.id]) {
						// Already armed here or in another tab.
						return;
					}
					const pendingValue: TaskPendingGitAction = {
						action: latestMode,
						requestedAt: Date.now(),
						headCommitAtRequest: getTaskWorkspaceSnapshot(reviewTask.id)?.headCommit ?? null,
						attempt: 0,
					};
					void (async () => {
						let armed = true;
						try {
							armed = await persistPendingGitActionRef.current(reviewTask.id, pendingValue);
						} catch {
							// Persistence unavailable: degrade to the legacy in-tab arming behavior.
							armed = true;
						}
						if (!armed) {
							// Another tab or earlier request already armed this card.
							return;
						}
						localPendingGitActionByTaskIdRef.current[reviewTask.id] = pendingValue;
						try {
							const triggered = await runAutoReviewGitActionRef.current(reviewTask.id, latestMode);
							if (!triggered && localPendingGitActionByTaskIdRef.current[reviewTask.id] === pendingValue) {
								delete localPendingGitActionByTaskIdRef.current[reviewTask.id];
								clearPendingGitAction(reviewTask.id);
							}
						} catch {
							if (localPendingGitActionByTaskIdRef.current[reviewTask.id] === pendingValue) {
								delete localPendingGitActionByTaskIdRef.current[reviewTask.id];
								clearPendingGitAction(reviewTask.id);
							}
						}
					})();
				});
			}
		},
		[clearAutoReviewTimer, clearPendingGitAction, scheduleAutoReviewAction, taskGitActionLoadingByTaskId],
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
