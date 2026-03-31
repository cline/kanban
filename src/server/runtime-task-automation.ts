import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";

import type { ClineTaskSessionService } from "../cline-sdk/cline-task-session-service";
import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { buildKanbanRuntimeUrl } from "../core/runtime-endpoint";
import { moveTaskToColumn, trashTaskAndGetReadyLinkedTaskIds } from "../core/task-board-mutations";
import { loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import type { RuntimeAppRouter } from "../trpc/app-router";
import { getGitSyncSummary } from "../workspace/git-sync";
import { resolveTaskCwd } from "../workspace/task-worktree";

const AUTO_REVIEW_ACTION_DELAY_MS = 500;
const WORKSPACE_AUTOMATION_POLL_INTERVAL_MS = 1_000;

type TaskGitAction = Extract<RuntimeTaskAutoReviewMode, "commit" | "pr">;

interface TaskGitPromptTemplates {
	commitPromptTemplate?: string | null;
	openPrPromptTemplate?: string | null;
	commitPromptTemplateDefault?: string | null;
	openPrPromptTemplateDefault?: string | null;
}

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
	awaitingCleanActionByTaskId: Map<string, TaskGitAction>;
	inFlightGitActionByTaskId: Map<string, TaskGitAction>;
	moveToTrashInFlightTaskIds: Set<string>;
	terminalSummaryUnsubscribe: (() => void) | null;
	clineSummaryUnsubscribe: (() => void) | null;
}

export interface RuntimeTaskAutomation {
	trackTerminalManager: (workspaceId: string, manager: TerminalSessionManager) => void;
	trackClineTaskSessionService: (workspaceId: string, service: ClineTaskSessionService) => void;
	disposeWorkspace: (workspaceId: string) => void;
	close: () => void;
}

export interface CreateRuntimeTaskAutomationDependencies {
	getWorkspacePathById: (workspaceId: string) => string | null;
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
 * Resolves the prompt template string that should drive a commit or PR agent action.
 */
function resolveTaskGitActionTemplate(
	action: TaskGitAction,
	templates: TaskGitPromptTemplates | null | undefined,
): string {
	if (action === "commit") {
		const template = templates?.commitPromptTemplate?.trim();
		if (template) {
			return template;
		}
		const defaultTemplate = templates?.commitPromptTemplateDefault?.trim();
		if (defaultTemplate) {
			return defaultTemplate;
		}
		return "Handle this commit action using the provided git context.";
	}
	const template = templates?.openPrPromptTemplate?.trim();
	if (template) {
		return template;
	}
	const defaultTemplate = templates?.openPrPromptTemplateDefault?.trim();
	if (defaultTemplate) {
		return defaultTemplate;
	}
	return "Handle this pull request action using the provided git context.";
}

/**
 * Builds the agent prompt used for commit and PR automation.
 */
function buildTaskGitActionPrompt(input: {
	action: TaskGitAction;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
	templates?: TaskGitPromptTemplates | null;
}): string {
	const template = resolveTaskGitActionTemplate(input.action, input.templates);
	return template.replaceAll("{{base_ref}}", input.workspaceInfo.baseRef);
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
 * Merges the persisted session map with the latest live terminal and Cline summaries.
 */
function mergeLiveTaskSessionSummaries(
	persistedSessions: Record<string, RuntimeTaskSessionSummary>,
	terminalManager: TerminalSessionManager | null,
	clineTaskSessionService: ClineTaskSessionService | null,
): Record<string, RuntimeTaskSessionSummary> {
	const mergedSessions: Record<string, RuntimeTaskSessionSummary> = { ...persistedSessions };
	for (const summary of terminalManager?.listSummaries() ?? []) {
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
		awaitingCleanActionByTaskId: new Map(),
		inFlightGitActionByTaskId: new Map(),
		moveToTrashInFlightTaskIds: new Set(),
		terminalSummaryUnsubscribe: null,
		clineSummaryUnsubscribe: null,
	};
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
 * Sends the existing commit/PR prompt through the same runtime APIs the web UI already uses.
 */
async function sendTaskGitActionPrompt(input: {
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	task: RuntimeBoardCard;
	action: TaskGitAction;
	summary: RuntimeTaskSessionSummary | null;
}): Promise<boolean> {
	try {
		const [config, workspaceInfo] = await Promise.all([
			input.runtimeClient.runtime.getConfig.query(),
			input.runtimeClient.workspace.getTaskContext.query({
				taskId: input.task.id,
				baseRef: input.task.baseRef,
			}),
		]);
		const prompt = buildTaskGitActionPrompt({
			action: input.action,
			workspaceInfo,
			templates: {
				commitPromptTemplate: config.commitPromptTemplate,
				openPrPromptTemplate: config.openPrPromptTemplate,
				commitPromptTemplateDefault: config.commitPromptTemplateDefault,
				openPrPromptTemplateDefault: config.openPrPromptTemplateDefault,
			},
		});

		if (input.summary?.agentId === "cline") {
			const sent = await input.runtimeClient.runtime.sendTaskChatMessage.mutate({
				taskId: input.task.id,
				text: prompt,
				mode: "act",
			});
			return sent.ok === true;
		}

		const typed = await input.runtimeClient.runtime.sendTaskSessionInput.mutate({
			taskId: input.task.id,
			text: prompt,
			appendNewline: false,
		});
		if (!typed.ok) {
			return false;
		}

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 200);
		});

		const submitted = await input.runtimeClient.runtime.sendTaskSessionInput.mutate({
			taskId: input.task.id,
			text: "\r",
			appendNewline: false,
		});
		return submitted.ok === true;
	} catch {
		return false;
	}
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
		const trashed = trashTaskAndGetReadyLinkedTaskIds(latestState.board, input.taskId);
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
		await input.runtimeClient.runtime.stopTaskSession
			.mutate({
				taskId: input.taskId,
			})
			.catch(() => null);
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
 * Reconciles the persisted board columns with the live session summaries owned by the runtime.
 */
async function reconcileBoardWithLiveSessions(input: {
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
	workspacePath: string;
	state: RuntimeWorkspaceStateResponse;
	liveSessions: Record<string, RuntimeTaskSessionSummary>;
}): Promise<RuntimeWorkspaceStateResponse> {
	const mutation = await mutateWorkspaceState(input.workspacePath, (latestState) => {
		let nextBoard = latestState.board;
		let changed = false;

		for (const summary of Object.values(input.liveSessions)) {
			const record = findTaskRecord(
				{
					...latestState,
					board: nextBoard,
				},
				summary.taskId,
			);
			if (!record) {
				continue;
			}
			if (summary.state === "awaiting_review" && record.columnId === "in_progress") {
				const moved = moveTaskToColumn(nextBoard, summary.taskId, "review");
				if (moved.moved) {
					nextBoard = moved.board;
					changed = true;
				}
				continue;
			}
			if (summary.state === "running" && record.columnId === "review") {
				const moved = moveTaskToColumn(nextBoard, summary.taskId, "in_progress");
				if (moved.moved) {
					nextBoard = moved.board;
					changed = true;
				}
			}
		}

		return {
			board: changed ? nextBoard : latestState.board,
			value: changed,
			save: changed,
		};
	}).catch(() => null);

	if (!mutation) {
		return {
			...input.state,
			sessions: input.liveSessions,
		};
	}
	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
		return {
			...mutation.state,
			sessions: input.liveSessions,
		};
	}
	return {
		...input.state,
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
	workspacePath: string;
	state: RuntimeWorkspaceStateResponse;
	liveSessions: Record<string, RuntimeTaskSessionSummary>;
	nowValue: number;
}): Promise<void> {
	const reviewColumn = input.state.board.columns.find((column) => column.id === "review");
	const reviewCards = reviewColumn?.cards ?? [];
	const reviewTaskIds = new Set(reviewCards.map((card) => card.id));

	for (const taskId of Array.from(input.entry.awaitingCleanActionByTaskId.keys())) {
		if (!reviewTaskIds.has(taskId)) {
			input.entry.awaitingCleanActionByTaskId.delete(taskId);
			clearScheduledTaskAction(input.entry, taskId);
			input.entry.inFlightGitActionByTaskId.delete(taskId);
			input.entry.moveToTrashInFlightTaskIds.delete(taskId);
		}
	}
	for (const taskId of Array.from(input.entry.scheduledActionByTaskId.keys())) {
		if (!reviewTaskIds.has(taskId)) {
			clearScheduledTaskAction(input.entry, taskId);
		}
	}
	for (const taskId of Array.from(input.entry.moveToTrashInFlightTaskIds)) {
		if (!reviewTaskIds.has(taskId)) {
			input.entry.moveToTrashInFlightTaskIds.delete(taskId);
		}
	}

	for (const task of reviewCards) {
		if (task.autoReviewEnabled !== true) {
			input.entry.awaitingCleanActionByTaskId.delete(task.id);
			input.entry.inFlightGitActionByTaskId.delete(task.id);
			input.entry.moveToTrashInFlightTaskIds.delete(task.id);
			clearScheduledTaskAction(input.entry, task.id);
			continue;
		}

		const autoReviewMode = resolveTaskAutoReviewMode(task.autoReviewMode);
		const awaitingCleanAction = input.entry.awaitingCleanActionByTaskId.get(task.id) ?? null;
		if (awaitingCleanAction && awaitingCleanAction !== autoReviewMode) {
			input.entry.awaitingCleanActionByTaskId.delete(task.id);
			clearScheduledTaskAction(input.entry, task.id);
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
			}).catch(() => false);
			if (!moved) {
				input.entry.moveToTrashInFlightTaskIds.delete(task.id);
			}
			continue;
		}

		const changedFiles = await loadTaskChangedFileCount(task, input.workspacePath);
		if (input.entry.awaitingCleanActionByTaskId.has(task.id)) {
			if (
				changedFiles === 0 &&
				!input.entry.inFlightGitActionByTaskId.has(task.id) &&
				!input.entry.moveToTrashInFlightTaskIds.has(task.id)
			) {
				if (!shouldRunScheduledTaskAction(input.entry, task.id, "move_to_trash", input.nowValue)) {
					continue;
				}
				clearScheduledTaskAction(input.entry, task.id);
				input.entry.moveToTrashInFlightTaskIds.add(task.id);
				const moved = await trashTaskAndStartLinkedTasks({
					runtimeClient: input.runtimeClient,
					workspacePath: input.workspacePath,
					taskId: task.id,
				}).catch(() => false);
				if (!moved) {
					input.entry.moveToTrashInFlightTaskIds.delete(task.id);
				}
			} else {
				clearScheduledTaskAction(input.entry, task.id);
			}
			continue;
		}

		if ((changedFiles ?? 0) <= 0 || input.entry.inFlightGitActionByTaskId.has(task.id)) {
			clearScheduledTaskAction(input.entry, task.id);
			continue;
		}

		if (!shouldRunScheduledTaskAction(input.entry, task.id, autoReviewMode, input.nowValue)) {
			continue;
		}

		clearScheduledTaskAction(input.entry, task.id);
		input.entry.inFlightGitActionByTaskId.set(task.id, autoReviewMode);
		const summary = input.liveSessions[task.id] ?? null;
		const triggered = await sendTaskGitActionPrompt({
			runtimeClient: input.runtimeClient,
			task,
			action: autoReviewMode,
			summary,
		}).catch(() => false);
		input.entry.inFlightGitActionByTaskId.delete(task.id);
		if (triggered) {
			input.entry.awaitingCleanActionByTaskId.set(task.id, autoReviewMode);
		}
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
				const liveSessions = mergeLiveTaskSessionSummaries(
					persistedState.sessions,
					entry.terminalManager,
					entry.clineTaskSessionService,
				);
				const reconciledState = await reconcileBoardWithLiveSessions({
					runtimeClient,
					workspacePath,
					state: persistedState,
					liveSessions,
				});
				await evaluateWorkspaceAutoReview({
					entry,
					runtimeClient,
					workspacePath,
					state: reconciledState,
					liveSessions,
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
		trackedWorkspaces.delete(workspaceId);
	}

	return {
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
