import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";

import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint";
import { moveTaskToColumn, trashTaskAndGetReadyLinkedTaskIds } from "../core/task-board-mutations";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import type { RuntimeAppRouter } from "../trpc/app-router";
import { getGitSyncSummary } from "../workspace/git-sync";
import { resolveTaskCwd } from "../workspace/task-worktree";
import type { RuntimeTaskGitAction, RuntimeTaskGitActionCoordinator } from "./runtime-task-git-actions";

const AUTO_REVIEW_ACTION_DELAY_MS = 500;
const WORKSPACE_AUTOMATION_POLL_INTERVAL_MS = 1_000;

interface ScheduledTaskAction {
	action: RuntimeTaskAutoReviewMode;
	scheduledAt: number;
}

interface TrackedWorkspaceAutomation {
	workspaceId: string;
	terminalManager: TerminalSessionManager | null;
	clineTaskSessionService: ClineTaskSessionService | null;
	pollTimer: NodeJS.Timeout | null;
	runningTick: Promise<void> | null;
	rerunRequested: boolean;
	scheduledActionByTaskId: Map<string, ScheduledTaskAction>;
	moveToTrashInFlightTaskIds: Set<string>;
	terminalSummaryUnsubscribe: (() => void) | null;
	clineSummaryUnsubscribe: (() => void) | null;
}

export interface RuntimeTaskAutomation {
	trackWorkspace: (workspaceId: string) => void;
	trackTerminalManager: (workspaceId: string, manager: TerminalSessionManager) => void;
	trackClineTaskSessionService: (workspaceId: string, service: ClineTaskSessionService) => void;
	disposeWorkspace: (workspaceId: string) => void;
	close: () => void;
}

export interface CreateRuntimeTaskAutomationDependencies {
	getWorkspacePathById: (workspaceId: string) => string | null;
	taskGitActionCoordinator: RuntimeTaskGitActionCoordinator;
}

/**
 * Builds a runtime-scoped TRPC client that can call back into the local Kanban server.
 */
function createRuntimeTrpcClient(workspaceId: string) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => ({ "x-kanban-workspace-id": workspaceId }),
			}),
		],
	});
}

/**
 * Normalizes the task auto-review mode to Kanban's persisted default.
 */
function resolveTaskAutoReviewMode(value: RuntimeTaskAutoReviewMode | null | undefined): RuntimeTaskAutoReviewMode {
	if (value === "pr" || value === "move_to_trash") {
		return value;
	}
	return "commit";
}

/**
 * Selects the newest summary for a task when both the persisted snapshot and live managers know about it.
 */
function selectNewestTaskSessionSummary(
	current: RuntimeTaskSessionSummary | null,
	candidate: RuntimeTaskSessionSummary | null,
): RuntimeTaskSessionSummary | null {
	if (!current) {
		return candidate;
	}
	if (!candidate) {
		return current;
	}
	if (candidate.updatedAt !== current.updatedAt) {
		return candidate.updatedAt > current.updatedAt ? candidate : current;
	}
	if (candidate.agentId === "cline" && current.agentId !== "cline") {
		return candidate;
	}
	return current;
}

/**
 * Collects the session summaries that automation can act on immediately.
 * Disk-only terminal snapshots are excluded because they cannot receive input after restart.
 */
function collectAutomationTaskSessionSummaries(
	terminalManager: TerminalSessionManager | null,
	clineTaskSessionService: ClineTaskSessionService | null,
): Record<string, RuntimeTaskSessionSummary> {
	const mergedSessions: Record<string, RuntimeTaskSessionSummary> = {};
	for (const summary of terminalManager?.listSummaries() ?? []) {
		if (!terminalManager?.hasActiveTaskSession(summary.taskId)) {
			continue;
		}
		const newest = selectNewestTaskSessionSummary(mergedSessions[summary.taskId] ?? null, summary);
		if (newest) {
			mergedSessions[summary.taskId] = newest;
		}
	}
	for (const summary of clineTaskSessionService?.listSummaries() ?? []) {
		const newest = selectNewestTaskSessionSummary(mergedSessions[summary.taskId] ?? null, summary);
		if (newest) {
			mergedSessions[summary.taskId] = newest;
		}
	}
	return mergedSessions;
}

/**
 * Finds a task and its current column inside a workspace board snapshot.
 */
function findTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	taskId: string,
): { task: RuntimeBoardCard; columnId: RuntimeBoardColumnId } | null {
	for (const column of state.board.columns) {
		const task = column.cards.find((candidate) => candidate.id === taskId);
		if (task) {
			return {
				task,
				columnId: column.id,
			};
		}
	}
	return null;
}

/**
 * Builds the mutable controller state for a newly tracked workspace.
 */
function createTrackedWorkspaceAutomation(workspaceId: string): TrackedWorkspaceAutomation {
	return {
		workspaceId,
		terminalManager: null,
		clineTaskSessionService: null,
		pollTimer: null,
		runningTick: null,
		rerunRequested: false,
		scheduledActionByTaskId: new Map(),
		moveToTrashInFlightTaskIds: new Set(),
		terminalSummaryUnsubscribe: null,
		clineSummaryUnsubscribe: null,
	};
}

/**
 * Resolves the companion terminal-session id used for the task detail shell.
 */
function getDetailTerminalTaskId(taskId: string): string {
	return `__detail_terminal__:${taskId}`;
}

/**
 * Loads the current worktree changed-file count for a task without creating a missing worktree.
 */
async function loadTaskChangedFileCount(task: RuntimeBoardCard, workspacePath: string): Promise<number | null> {
	try {
		const taskCwd = await resolveTaskCwd({
			cwd: workspacePath,
			taskId: task.id,
			baseRef: task.baseRef,
			ensure: false,
		});
		const summary = await getGitSyncSummary(taskCwd);
		return summary.changedFiles;
	} catch {
		return null;
	}
}

/**
 * Notifies connected runtime clients that a workspace state mutation has been saved.
 */
async function notifyRuntimeWorkspaceStateUpdated(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
): Promise<void> {
	await runtimeClient.workspace.notifyStateUpdated.mutate().catch(() => null);
}

/**
 * Triggers a runtime-owned commit or PR action for a review task.
 */
async function runTaskGitAction(input: {
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	task: RuntimeBoardCard;
	action: RuntimeTaskGitAction;
}): Promise<boolean> {
	const response = await input.runtimeClient.runtime.runTaskGitAction
		.mutate({
			taskId: input.task.id,
			baseRef: input.task.baseRef,
			action: input.action,
			source: "auto",
		})
		.catch(() => null);
	return response?.ok === true;
}

/**
 * Starts a linked backlog task using the runtime's existing worktree and task-session APIs.
 */
async function startLinkedBacklogTask(input: {
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	workspacePath: string;
	taskId: string;
}): Promise<boolean> {
	const state = await loadWorkspaceState(input.workspacePath).catch(() => null);
	const record = state ? findTaskRecord(state, input.taskId) : null;
	if (!record || record.columnId !== "backlog") {
		return false;
	}

	const ensured = await input.runtimeClient.workspace.ensureWorktree
		.mutate({
			taskId: record.task.id,
			baseRef: record.task.baseRef,
		})
		.catch(() => null);
	if (!ensured?.ok) {
		return false;
	}

	const started = await input.runtimeClient.runtime.startTaskSession
		.mutate({
			taskId: record.task.id,
			prompt: record.task.prompt,
			startInPlanMode: record.task.startInPlanMode,
			baseRef: record.task.baseRef,
			images: record.task.images,
		})
		.catch(() => null);
	if (!started?.ok || !started.summary) {
		return false;
	}

	const mutation = await mutateWorkspaceState(input.workspacePath, (latestState) => {
		const latestRecord = findTaskRecord(latestState, input.taskId);
		if (!latestRecord || latestRecord.columnId !== "backlog") {
			return {
				board: latestState.board,
				value: false,
				save: false,
			};
		}
		const moved = moveTaskToColumn(latestState.board, latestRecord.task.id, "in_progress");
		return {
			board: moved.moved ? moved.board : latestState.board,
			value: moved.moved,
			save: moved.moved,
		};
	}).catch(() => null);
	if (mutation?.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}
	return mutation?.value === true;
}

/**
 * Moves a review task to trash, starts any newly ready linked backlog tasks, and cleans up its worktree.
 */
async function trashTaskAndStartLinkedTasks(input: {
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	workspacePath: string;
	taskId: string;
	sourceColumnId: RuntimeBoardColumnId;
}): Promise<boolean> {
	const mutation = await mutateWorkspaceState(input.workspacePath, (latestState) => {
		const record = findTaskRecord(latestState, input.taskId);
		if (!record || record.columnId === "trash") {
			return {
				board: latestState.board,
				value: {
					moved: false,
					readyTaskIds: [] as string[],
					previousColumnId: record?.columnId ?? null,
				},
				save: false,
			};
		}
		const boardForTrashMutation =
			input.sourceColumnId === "review" && record.columnId === "in_progress"
				? (moveTaskToColumn(latestState.board, input.taskId, "review").board ?? latestState.board)
				: latestState.board;
		const trashed = trashTaskAndGetReadyLinkedTaskIds(boardForTrashMutation, input.taskId);
		return {
			board: trashed.moved ? trashed.board : latestState.board,
			value: {
				moved: trashed.moved,
				readyTaskIds: trashed.readyTaskIds,
				previousColumnId: record.columnId,
			},
			save: trashed.moved,
		};
	}).catch(() => null);
	if (!mutation?.value.moved) {
		return false;
	}

	await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);

	if (mutation.value.previousColumnId === "in_progress" || mutation.value.previousColumnId === "review") {
		await Promise.all([
			input.runtimeClient.runtime.stopTaskSession
				.mutate({
					taskId: input.taskId,
				})
				.catch(() => null),
			input.runtimeClient.runtime.stopTaskSession
				.mutate({
					taskId: getDetailTerminalTaskId(input.taskId),
				})
				.catch(() => null),
		]);
	}

	for (const readyTaskId of mutation.value.readyTaskIds) {
		await startLinkedBacklogTask({
			runtimeClient: input.runtimeClient,
			workspacePath: input.workspacePath,
			taskId: readyTaskId,
		});
	}

	await input.runtimeClient.workspace.deleteWorktree
		.mutate({
			taskId: input.taskId,
		})
		.catch(() => null);

	return true;
}

/**
 * Derives the board shape automation should evaluate without persisting session-driven column moves.
 */
function deriveAutomationWorkspaceState(input: {
	state: RuntimeWorkspaceStateResponse;
	liveSessions: Record<string, RuntimeTaskSessionSummary>;
}): RuntimeWorkspaceStateResponse {
	let nextBoard = input.state.board;
	for (const summary of Object.values(input.liveSessions)) {
		const record = findTaskRecord(
			{
				...input.state,
				board: nextBoard,
			},
			summary.taskId,
		);
		if (!record) {
			continue;
		}
		if (summary.state === "awaiting_review" && record.columnId === "in_progress") {
			const moved = moveTaskToColumn(nextBoard, summary.taskId, "review");
			nextBoard = moved.moved ? moved.board : nextBoard;
			continue;
		}
		if (summary.state === "running" && record.columnId === "review") {
			const moved = moveTaskToColumn(nextBoard, summary.taskId, "in_progress");
			nextBoard = moved.moved ? moved.board : nextBoard;
			continue;
		}
		if (summary.state === "interrupted" && record.columnId !== "trash") {
			const moved = moveTaskToColumn(nextBoard, summary.taskId, "trash");
			nextBoard = moved.moved ? moved.board : nextBoard;
		}
	}
	return {
		...input.state,
		board: nextBoard,
		sessions: input.liveSessions,
	};
}

/**
 * Ensures the 500ms debounce window survives polling-based evaluation without duplicating actions.
 */
function shouldRunScheduledTaskAction(
	entry: TrackedWorkspaceAutomation,
	taskId: string,
	action: RuntimeTaskAutoReviewMode,
	nowValue: number,
): boolean {
	const scheduled = entry.scheduledActionByTaskId.get(taskId);
	if (!scheduled || scheduled.action !== action) {
		entry.scheduledActionByTaskId.set(taskId, {
			action,
			scheduledAt: nowValue,
		});
		return false;
	}
	return nowValue - scheduled.scheduledAt >= AUTO_REVIEW_ACTION_DELAY_MS;
}

/**
 * Clears any scheduled action that is no longer valid for a task.
 */
function clearScheduledTaskAction(entry: TrackedWorkspaceAutomation, taskId: string): void {
	entry.scheduledActionByTaskId.delete(taskId);
}

/**
 * Evaluates review-column tasks and runs the runtime-owned auto-review state machine.
 */
async function evaluateWorkspaceAutoReview(input: {
	entry: TrackedWorkspaceAutomation;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	taskGitActionCoordinator: RuntimeTaskGitActionCoordinator;
	workspaceId: string;
	workspacePath: string;
	state: RuntimeWorkspaceStateResponse;
	nowValue: number;
}): Promise<void> {
	const reviewColumn = input.state.board.columns.find((column) => column.id === "review");
	const reviewCards = reviewColumn?.cards ?? [];
	const reviewTaskIds = new Set(reviewCards.map((card) => card.id));
	const inProgressCleanupTaskIds = new Set<string>();
	for (const column of input.state.board.columns) {
		if (column.id === "review") {
			continue;
		}
		for (const task of column.cards) {
			const autoCleanupAction = input.taskGitActionCoordinator.getAutoCleanupTaskGitAction(
				input.workspaceId,
				task.id,
			);
			const preserveAutoCleanupState = autoCleanupAction !== null && column.id === "in_progress";
			if (preserveAutoCleanupState) {
				inProgressCleanupTaskIds.add(task.id);
			}
			if (preserveAutoCleanupState) {
				clearScheduledTaskAction(input.entry, task.id);
				input.entry.moveToTrashInFlightTaskIds.delete(task.id);
				continue;
			}
			input.taskGitActionCoordinator.clearTaskGitAction(input.workspaceId, task.id);
			clearScheduledTaskAction(input.entry, task.id);
			input.entry.moveToTrashInFlightTaskIds.delete(task.id);
		}
	}

	for (const taskId of Array.from(input.entry.scheduledActionByTaskId.keys())) {
		if (!reviewTaskIds.has(taskId) && !inProgressCleanupTaskIds.has(taskId)) {
			clearScheduledTaskAction(input.entry, taskId);
			input.taskGitActionCoordinator.clearTaskGitAction(input.workspaceId, taskId);
		}
	}
	for (const taskId of Array.from(input.entry.moveToTrashInFlightTaskIds)) {
		if (!reviewTaskIds.has(taskId)) {
			input.entry.moveToTrashInFlightTaskIds.delete(taskId);
		}
	}

	for (const task of reviewCards) {
		if (task.autoReviewEnabled !== true) {
			input.taskGitActionCoordinator.clearTaskGitAction(input.workspaceId, task.id);
			input.entry.moveToTrashInFlightTaskIds.delete(task.id);
			clearScheduledTaskAction(input.entry, task.id);
			continue;
		}

		const autoReviewMode = resolveTaskAutoReviewMode(task.autoReviewMode);
		const autoCleanupAction = input.taskGitActionCoordinator.getAutoCleanupTaskGitAction(input.workspaceId, task.id);
		if (autoCleanupAction) {
			const changedFiles = await loadTaskChangedFileCount(task, input.workspacePath);
			if (changedFiles === 0 && !input.entry.moveToTrashInFlightTaskIds.has(task.id)) {
				if (!shouldRunScheduledTaskAction(input.entry, task.id, "move_to_trash", input.nowValue)) {
					continue;
				}
				clearScheduledTaskAction(input.entry, task.id);
				input.entry.moveToTrashInFlightTaskIds.add(task.id);
				const moved = await trashTaskAndStartLinkedTasks({
					runtimeClient: input.runtimeClient,
					workspacePath: input.workspacePath,
					taskId: task.id,
					sourceColumnId: "review",
				}).catch(() => false);
				if (!moved) {
					input.entry.moveToTrashInFlightTaskIds.delete(task.id);
				} else {
					input.taskGitActionCoordinator.clearTaskGitAction(input.workspaceId, task.id);
				}
			} else {
				clearScheduledTaskAction(input.entry, task.id);
			}
			continue;
		}

		if (autoReviewMode === "move_to_trash") {
			if (input.entry.moveToTrashInFlightTaskIds.has(task.id)) {
				continue;
			}
			if (!shouldRunScheduledTaskAction(input.entry, task.id, autoReviewMode, input.nowValue)) {
				continue;
			}
			clearScheduledTaskAction(input.entry, task.id);
			input.entry.moveToTrashInFlightTaskIds.add(task.id);
			const moved = await trashTaskAndStartLinkedTasks({
				runtimeClient: input.runtimeClient,
				workspacePath: input.workspacePath,
				taskId: task.id,
				sourceColumnId: "review",
			}).catch(() => false);
			if (!moved) {
				input.entry.moveToTrashInFlightTaskIds.delete(task.id);
			}
			continue;
		}

		const changedFiles = await loadTaskChangedFileCount(task, input.workspacePath);
		if (
			(changedFiles ?? 0) <= 0 ||
			input.taskGitActionCoordinator.isTaskGitActionBlocked(input.workspaceId, task.id)
		) {
			clearScheduledTaskAction(input.entry, task.id);
			continue;
		}

		if (!shouldRunScheduledTaskAction(input.entry, task.id, autoReviewMode, input.nowValue)) {
			continue;
		}

		clearScheduledTaskAction(input.entry, task.id);
		await runTaskGitAction({
			runtimeClient: input.runtimeClient,
			task,
			action: autoReviewMode,
		}).catch(() => false);
	}
}

/**
 * Creates the runtime-owned automation controller that survives hidden tabs and websocket churn.
 */
export function createRuntimeTaskAutomation(deps: CreateRuntimeTaskAutomationDependencies): RuntimeTaskAutomation {
	const trackedWorkspaces = new Map<string, TrackedWorkspaceAutomation>();

	/**
	 * Returns the tracked workspace entry for an id, creating it on first use.
	 */
	function getTrackedWorkspace(workspaceId: string): TrackedWorkspaceAutomation {
		const existing = trackedWorkspaces.get(workspaceId);
		if (existing) {
			return existing;
		}
		const created = createTrackedWorkspaceAutomation(workspaceId);
		trackedWorkspaces.set(workspaceId, created);
		return created;
	}

	/**
	 * Runs one serialized automation pass for a workspace and reruns once more if new work arrives mid-pass.
	 */
	function queueWorkspaceTick(workspaceId: string): void {
		const entry = trackedWorkspaces.get(workspaceId);
		if (!entry) {
			return;
		}
		if (entry.runningTick) {
			entry.rerunRequested = true;
			return;
		}
		entry.runningTick = (async () => {
			do {
				entry.rerunRequested = false;
				const workspacePath = deps.getWorkspacePathById(workspaceId);
				if (!workspacePath) {
					disposeWorkspace(workspaceId);
					return;
				}
				const runtimeClient = createRuntimeTrpcClient(workspaceId);
				const persistedState = await loadWorkspaceState(workspacePath).catch(() => null);
				if (!persistedState) {
					return;
				}
				const liveSessions = collectAutomationTaskSessionSummaries(
					entry.terminalManager,
					entry.clineTaskSessionService,
				);
				const automationState = deriveAutomationWorkspaceState({
					state: persistedState,
					liveSessions,
				});
				await evaluateWorkspaceAutoReview({
					entry,
					runtimeClient,
					taskGitActionCoordinator: deps.taskGitActionCoordinator,
					workspaceId,
					workspacePath,
					state: automationState,
					nowValue: Date.now(),
				});
			} while (entry.rerunRequested);
		})().finally(() => {
			entry.runningTick = null;
		});
	}

	/**
	 * Ensures a tracked workspace has a background poller even when no browser clients are connected.
	 */
	function ensureWorkspacePoller(entry: TrackedWorkspaceAutomation): void {
		if (entry.pollTimer) {
			return;
		}
		const timer = setInterval(() => {
			queueWorkspaceTick(entry.workspaceId);
		}, WORKSPACE_AUTOMATION_POLL_INTERVAL_MS);
		timer.unref();
		entry.pollTimer = timer;
	}

	/**
	 * Disposes all subscriptions, timers, and queued task state for one workspace.
	 */
	function disposeWorkspace(workspaceId: string): void {
		const entry = trackedWorkspaces.get(workspaceId);
		if (!entry) {
			return;
		}
		if (entry.pollTimer) {
			clearInterval(entry.pollTimer);
		}
		entry.terminalSummaryUnsubscribe?.();
		entry.clineSummaryUnsubscribe?.();
		deps.taskGitActionCoordinator.disposeWorkspace(workspaceId);
		trackedWorkspaces.delete(workspaceId);
	}

	return {
		trackWorkspace: (workspaceId) => {
			const entry = getTrackedWorkspace(workspaceId);
			ensureWorkspacePoller(entry);
			queueWorkspaceTick(workspaceId);
		},
		trackTerminalManager: (workspaceId, manager) => {
			const entry = getTrackedWorkspace(workspaceId);
			entry.terminalManager = manager;
			entry.terminalSummaryUnsubscribe?.();
			entry.terminalSummaryUnsubscribe = manager.onSummary(() => {
				queueWorkspaceTick(workspaceId);
			});
			ensureWorkspacePoller(entry);
			queueWorkspaceTick(workspaceId);
		},
		trackClineTaskSessionService: (workspaceId, service) => {
			const entry = getTrackedWorkspace(workspaceId);
			entry.clineTaskSessionService = service;
			entry.clineSummaryUnsubscribe?.();
			entry.clineSummaryUnsubscribe = service.onSummary(() => {
				queueWorkspaceTick(workspaceId);
			});
			ensureWorkspacePoller(entry);
			queueWorkspaceTick(workspaceId);
		},
		disposeWorkspace,
		close: () => {
			for (const workspaceId of Array.from(trackedWorkspaces.keys())) {
				disposeWorkspace(workspaceId);
			}
		},
	};
}
