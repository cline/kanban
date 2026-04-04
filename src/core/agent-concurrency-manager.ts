/**
 * Global concurrency limiter for agent task sessions.
 *
 * Tracks the number of actively running agent sessions across all workspaces
 * and enforces a configurable maximum. When a slot frees up (a task completes,
 * is stopped, or fails) the manager automatically starts the next eligible
 * backlog task in the same workspace.
 *
 * All slot operations are synchronous, which is safe because Node.js runs on
 * a single thread — a synchronous check-and-set cannot be interrupted.
 */

import type { RuntimeTaskSessionState } from "./api-contract";

/** Per-slot metadata so we know which workspace a task belongs to. */
interface ActiveTaskEntry {
	workspaceId: string;
	workspacePath: string;
}

/** Parameters required to auto-start a queued backlog task. */
export interface QueuedTaskStartParams {
	taskId: string;
	workspaceId: string;
	workspacePath: string;
	prompt: string;
	baseRef: string;
	startInPlanMode: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: string;
	images?: Array<{ id: string; data: string; mimeType: string; name?: string }>;
}

/** Delegate that performs the full task-start pipeline (worktree + session + board move). */
export type StartTaskFromQueueDelegate = (params: QueuedTaskStartParams) => Promise<boolean>;

/** Delegate that reads the current backlog for a workspace in display order. */
export type GetBacklogTasksDelegate = (
	workspaceId: string,
	workspacePath: string,
) => Promise<QueuedTaskStartParams[]>;

/** Snapshot of the concurrency manager's current state. */
export interface AgentConcurrencyStatus {
	active: number;
	max: number | null;
	availableSlots: number | null;
	activeTaskIds: string[];
}

export interface AgentConcurrencyManagerDeps {
	getBacklogTasks: GetBacklogTasksDelegate;
	startTaskFromQueue: StartTaskFromQueueDelegate;
}

export interface AgentConcurrencyManager {
	/**
	 * Atomically check whether a slot is available and claim it.
	 * Returns `true` if the slot was claimed, `false` if no slot is available
	 * or the task is already tracked as active.
	 *
	 * Because Node.js is single-threaded, the synchronous check + set cannot
	 * be interleaved with another caller.
	 */
	tryClaimSlot(taskId: string, workspaceId: string, workspacePath: string): boolean;

	/**
	 * Release a previously claimed slot without triggering queue processing.
	 * Used when a task start fails after the slot was claimed.
	 */
	releaseSlot(taskId: string): void;

	/**
	 * Notify the manager that a task's session state has changed.
	 * If the task transitioned from active to inactive, its slot is released
	 * and queue processing is triggered for the originating workspace.
	 */
	notifyTaskStateChanged(
		taskId: string,
		workspaceId: string,
		workspacePath: string,
		previousState: RuntimeTaskSessionState,
		newState: RuntimeTaskSessionState,
	): void;

	/** Update the maximum number of concurrent agents. `null` means unlimited. */
	updateMaxConcurrency(max: number | null): void;

	/** Return a snapshot of the current concurrency status. */
	getStatus(): AgentConcurrencyStatus;

	/** Whether the given task is currently occupying a slot. */
	isTaskActive(taskId: string): boolean;
}

/** Returns `true` when a session state represents an actively running agent. */
function isActiveSessionState(state: RuntimeTaskSessionState): boolean {
	return state === "running" || state === "awaiting_review";
}

/** Returns `true` when a session state represents a finished or idle agent. */
function isInactiveSessionState(state: RuntimeTaskSessionState): boolean {
	return state === "idle" || state === "interrupted" || state === "failed";
}

export function createAgentConcurrencyManager(deps: AgentConcurrencyManagerDeps): AgentConcurrencyManager {
	const activeTasks = new Map<string, ActiveTaskEntry>();
	let maxConcurrent: number | null = null;
	let processingQueue = false;

	/** Whether at least one slot is available for a new task. */
	function hasAvailableSlot(): boolean {
		if (maxConcurrent === null) {
			return true;
		}
		return activeTasks.size < maxConcurrent;
	}

	/**
	 * Process the backlog queue for a given workspace.
	 * Picks the next eligible backlog task (top-to-bottom order) and starts it
	 * using the full start pipeline delegate. Repeats while slots are available.
	 *
	 * Guarded by `processingQueue` to prevent concurrent runs.
	 */
	async function processQueue(workspaceId: string, workspacePath: string): Promise<void> {
		if (processingQueue) {
			return;
		}
		if (maxConcurrent === null) {
			// Unlimited mode — nothing to queue-process.
			return;
		}
		processingQueue = true;

		try {
			while (hasAvailableSlot()) {
				let backlogTasks: QueuedTaskStartParams[];
				try {
					backlogTasks = await deps.getBacklogTasks(workspaceId, workspacePath);
				} catch {
					// Cannot read workspace state; stop processing.
					break;
				}

				// Find the first backlog task that is not already active.
				const nextTask = backlogTasks.find((task) => !activeTasks.has(task.taskId));
				if (!nextTask) {
					break;
				}

				// Claim the slot before the async start.
				activeTasks.set(nextTask.taskId, { workspaceId, workspacePath });

				try {
					const started = await deps.startTaskFromQueue(nextTask);
					if (!started) {
						// Start delegate returned false (e.g. task was deleted meanwhile).
						activeTasks.delete(nextTask.taskId);
					}
				} catch {
					// Start failed — release the slot and skip this task.
					activeTasks.delete(nextTask.taskId);
				}
			}
		} finally {
			processingQueue = false;
		}
	}

	return {
		tryClaimSlot(taskId: string, workspaceId: string, workspacePath: string): boolean {
			if (activeTasks.has(taskId)) {
				return false;
			}
			if (!hasAvailableSlot()) {
				return false;
			}
			activeTasks.set(taskId, { workspaceId, workspacePath });
			return true;
		},

		releaseSlot(taskId: string): void {
			activeTasks.delete(taskId);
		},

		notifyTaskStateChanged(
			taskId: string,
			workspaceId: string,
			workspacePath: string,
			previousState: RuntimeTaskSessionState,
			newState: RuntimeTaskSessionState,
		): void {
			const wasActive = isActiveSessionState(previousState);
			const nowInactive = isInactiveSessionState(newState);

			if (wasActive && nowInactive) {
				const wasTracked = activeTasks.delete(taskId);
				if (wasTracked) {
					// Fire-and-forget: auto-start next backlog task.
					void processQueue(workspaceId, workspacePath);
				}
			}
		},

		updateMaxConcurrency(max: number | null): void {
			maxConcurrent = max;
		},

		getStatus(): AgentConcurrencyStatus {
			return {
				active: activeTasks.size,
				max: maxConcurrent,
				availableSlots: maxConcurrent === null ? null : Math.max(0, maxConcurrent - activeTasks.size),
				activeTaskIds: Array.from(activeTasks.keys()),
			};
		},

		isTaskActive(taskId: string): boolean {
			return activeTasks.has(taskId);
		},
	};
}
