import { useCallback, useEffect, useRef } from "react";

import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { getScheduledTasksDue } from "@/state/board-state";
import type { BoardData } from "@/types";

/**
 * Computes the earliest `nextRunAt` among enabled scheduled backlog tasks.
 * Returns `null` if no scheduled tasks are pending.
 */
function getEarliestScheduledRunAt(board: BoardData): number | null {
	const backlogColumn = board.columns.find((column) => column.id === "backlog");
	if (!backlogColumn) {
		return null;
	}
	let earliest: number | null = null;
	for (const card of backlogColumn.cards) {
		if (card.schedule?.enabled && card.schedule.runCount > 0 && card.schedule.nextRunAt > 0) {
			if (earliest === null || card.schedule.nextRunAt < earliest) {
				earliest = card.schedule.nextRunAt;
			}
		}
	}
	return earliest;
}

/**
 * Maximum delay for `setTimeout` to avoid overflow (approximately 24.8 days).
 * Browsers cap setTimeout at 2^31−1 ms; exceeding this fires immediately.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

interface UseScheduledTaskStarterOptions {
	board: BoardData;
	startBacklogTasks: (taskIds: string[]) => void;
}

/**
 * Reactively starts scheduled backlog tasks when their `nextRunAt` time arrives.
 *
 * Instead of polling at an interval, this hook:
 * 1. On every board change, checks for immediately-due tasks and starts them.
 * 2. For the next future scheduled task, sets a precise `setTimeout`.
 * 3. When the document regains visibility (e.g. tab switch), rechecks for overdue tasks.
 */
export function useScheduledTaskStarter({ board, startBacklogTasks }: UseScheduledTaskStarterOptions): void {
	const isDocumentVisible = useDocumentVisibility();
	const startBacklogTasksRef = useRef(startBacklogTasks);

	useEffect(() => {
		startBacklogTasksRef.current = startBacklogTasks;
	}, [startBacklogTasks]);

	const startDueTasks = useCallback(
		(currentBoard: BoardData): boolean => {
			const dueTaskIds = getScheduledTasksDue(currentBoard);
			if (dueTaskIds.length === 0) {
				return false;
			}
			startBacklogTasksRef.current(dueTaskIds);
			return true;
		},
		[],
	);

	// Main reactive effect: check on every board change and set timer for next due task.
	useEffect(() => {
		// Start any tasks that are already due.
		const now = Date.now();
		const dueTaskIds = getScheduledTasksDue(board, now);
		if (dueTaskIds.length > 0) {
			startBacklogTasksRef.current(dueTaskIds);
		}

		// Find the earliest future scheduled task and set a timer.
		const earliest = getEarliestScheduledRunAt(board);
		if (earliest === null) {
			return;
		}

		const delayMs = Math.max(0, earliest - now);
		if (delayMs === 0) {
			// Already handled above.
			return;
		}

		const clampedDelay = Math.min(delayMs, MAX_TIMEOUT_MS);
		const timerId = window.setTimeout(() => {
			startDueTasks(board);
		}, clampedDelay);

		return () => {
			window.clearTimeout(timerId);
		};
	}, [board, startDueTasks]);

	// When the document becomes visible again, re-check for overdue tasks
	// that may have been missed while the tab was in the background.
	useEffect(() => {
		if (!isDocumentVisible) {
			return;
		}
		startDueTasks(board);
	}, [isDocumentVisible, board, startDueTasks]);
}
