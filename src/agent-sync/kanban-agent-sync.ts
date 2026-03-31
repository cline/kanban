// Syncs multi-agent team tasks and sub-agent lifecycle events to the kanban board.
//
// Usage — wire into CoreSessionConfig when starting a session that may use
// agent teams or the spawn_agent tool:
//
//   import { createKanbanAgentSync } from "./agent-sync/kanban-agent-sync";
//
//   const sync = createKanbanAgentSync({ workspacePath: "/path/to/repo" });
//
//   // In CoreSessionConfig:
//   onTeamEvent: sync.onTeamEvent,
//
//   // On the session service object (for handleSubAgentStart / handleSubAgentEnd):
//   Object.assign(sessionService, sync.sessionServicePlugin);

import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData } from "../core/api-contract";
import { addTaskToColumn, deleteTasksFromBoard, moveTaskToColumn, updateTask } from "../core/task-board-mutations";
import { loadWorkspaceContext, mutateWorkspaceState } from "../state/workspace-state";

// Minimal local shapes — mirrors @clinebot/agents types without a direct import.
// The caller (who has CoreSessionConfig in scope) passes the real TeamEvent.

// TeamMessageType.TeamTaskUpdated = "team_task_updated" in @clinebot/agents
const TEAM_TASK_UPDATED = "team_task_updated" as const;
const TEAMMATE_SPAWNED = "teammate_spawned" as const;
const TEAMMATE_SHUTDOWN = "teammate_shutdown" as const;
const TASK_START = "task_start" as const;
const TASK_END = "task_end" as const;
const AGENT_EVENT = "agent_event" as const;
const RUN_QUEUED = "run_queued" as const;
const RUN_STARTED = "run_started" as const;
const RUN_PROGRESS = "run_progress" as const;
const RUN_COMPLETED = "run_completed" as const;
const RUN_FAILED = "run_failed" as const;
const RUN_CANCELLED = "run_cancelled" as const;
const RUN_INTERRUPTED = "run_interrupted" as const;

type TeamTaskStatus = "pending" | "in_progress" | "blocked" | "completed";

interface TeamTask {
	id: string;
	title: string;
	description: string;
	status: TeamTaskStatus;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
	assignee?: string;
	dependsOn: string[];
	summary?: string;
}

interface TeammateLifecycleSpec {
	rolePrompt: string;
	modelId?: string;
	maxIterations?: number;
	runtimeAgentId?: string;
	conversationId?: string;
	parentAgentId?: string | null;
}

interface TeamRunRecord {
	id: string;
	agentId: string;
	taskId?: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
	message: string;
	lastProgressMessage?: string;
	currentActivity?: string;
	error?: string;
}

interface TeammateSpawnedEvent extends OpaqueTeamEvent {
	type: typeof TEAMMATE_SPAWNED;
	agentId: string;
	role?: string;
	teammate: TeammateLifecycleSpec;
}

interface TeammateShutdownEvent extends OpaqueTeamEvent {
	type: typeof TEAMMATE_SHUTDOWN;
	agentId: string;
	reason?: string;
}

interface TeamRunEvent extends OpaqueTeamEvent {
	type:
		| typeof RUN_QUEUED
		| typeof RUN_STARTED
		| typeof RUN_PROGRESS
		| typeof RUN_COMPLETED
		| typeof RUN_FAILED
		| typeof RUN_CANCELLED
		| typeof RUN_INTERRUPTED;
	run: TeamRunRecord;
	message?: string;
	reason?: string;
}

// Opaque event type — the real type is TeamEvent from @clinebot/agents,
// but we accept unknown so callers can assign it from CoreSessionConfig.onTeamEvent
// without this file importing @clinebot/agents directly.
type OpaqueTeamEvent = { type: string; [key: string]: unknown };

// ── Column mapping ─────────────────────────────────────────────────────────────
//
// team_task status → kanban column:
//   pending      → backlog
//   in_progress  → in_progress
//   blocked      → in_progress  (stays, prompt updated to reflect blocked reason)
//   completed    → trash
//
// spawn_agent lifecycle → kanban column:
//   started      → in_progress
//   ended/ok     → trash
//   ended/error  → review

const AGENT_SYNC_CARD_PREFIX = "agent-";
const TEAMMATE_SYNC_CARD_PREFIX = "teammate-";
const LEGACY_TEAM_RUN_SYNC_CARD_PREFIX = "team-run-";

/**
 * Formats the synthetic task id used for spawned sub-agent cards.
 */
function makeAgentCardId(agentId: string): string {
	// Strip characters not valid in a task ID (keep alphanumeric + hyphens)
	return `${AGENT_SYNC_CARD_PREFIX}${agentId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
}

/**
 * Formats the synthetic task id used for teammate lifecycle cards.
 */
function makeTeammateCardId(agentId: string): string {
	return `${TEAMMATE_SYNC_CARD_PREFIX}${agentId.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 40)}`;
}

/**
 * Resolves the synthetic task id associated with a team event when available.
 */
function getSyntheticTaskIdForEvent(event: OpaqueTeamEvent): string | null {
	switch (event.type) {
		case TEAMMATE_SPAWNED:
		case TEAMMATE_SHUTDOWN:
		case TASK_START:
		case TASK_END:
		case AGENT_EVENT: {
			const agentId = typeof event.agentId === "string" ? event.agentId.trim() : "";
			return agentId ? makeTeammateCardId(agentId) : null;
		}
		case RUN_QUEUED:
		case RUN_STARTED:
		case RUN_PROGRESS:
		case RUN_COMPLETED:
		case RUN_FAILED:
		case RUN_CANCELLED:
		case RUN_INTERRUPTED: {
			const run = event.run;
			const agentId =
				run && typeof run === "object" && "agentId" in run && typeof run.agentId === "string"
					? run.agentId.trim()
					: "";
			return agentId ? makeTeammateCardId(agentId) : null;
		}
		default:
			return null;
	}
}

/**
 * Finds the current board location for a synthetic card.
 */
function findCard(
	board: RuntimeBoardData,
	taskId: string,
): { columnId: RuntimeBoardColumnId; card: RuntimeBoardCard } | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return {
				columnId: column.id,
				card,
			};
		}
	}
	return null;
}

/**
 * Removes stale split-model delegated run cards so the one-card teammate model stays consistent.
 */
function cleanupLegacyTeamRunCards(board: RuntimeBoardData): { board: RuntimeBoardData; changed: boolean } {
	const legacyTaskIds = board.columns.flatMap((column) =>
		column.cards.filter((card) => card.id.startsWith(LEGACY_TEAM_RUN_SYNC_CARD_PREFIX)).map((card) => card.id),
	);
	if (legacyTaskIds.length === 0) {
		return { board, changed: false };
	}
	const result = deleteTasksFromBoard(board, legacyTaskIds);
	return {
		board: result.board,
		changed: result.deleted,
	};
}

/**
 * Creates or updates a synthetic board card so team lifecycle events stay visible in the UI.
 */
function syncSyntheticCard(input: {
	board: RuntimeBoardData;
	taskId: string;
	targetColumn: RuntimeBoardColumnId;
	prompt: string;
	baseRef: string;
	parentTaskId?: string;
	role?: string;
}): { board: RuntimeBoardData; changed: boolean } {
	const existing = findCard(input.board, input.taskId);
	if (!existing) {
		const { board } = addTaskToColumn(
			input.board,
			input.targetColumn,
			{
				taskId: input.taskId,
				prompt: input.prompt,
				baseRef: input.baseRef,
				startInPlanMode: false,
				parentTaskId: input.parentTaskId,
				role: input.role,
			},
			() => input.taskId,
		);
		return { board, changed: true };
	}

	let nextBoard = input.board;
	let changed = false;
	if (existing.columnId !== input.targetColumn) {
		nextBoard = moveTaskToColumn(nextBoard, input.taskId, input.targetColumn).board;
		changed = true;
	}
	if (existing.card.prompt !== input.prompt || existing.card.baseRef !== input.baseRef) {
		const updateResult = updateTask(nextBoard, input.taskId, {
			prompt: input.prompt,
			baseRef: input.baseRef,
			startInPlanMode: false,
			autoReviewEnabled: existing.card.autoReviewEnabled,
			autoReviewMode: existing.card.autoReviewMode,
			images: existing.card.images,
		});
		if (updateResult.updated) {
			nextBoard = updateResult.board;
			changed = true;
		}
	}
	return { board: nextBoard, changed };
}

async function resolveBaseRef(workspacePath: string): Promise<string> {
	try {
		const ctx = await loadWorkspaceContext(workspacePath);
		return ctx.git.currentBranch ?? ctx.git.defaultBranch ?? "main";
	} catch {
		return "main";
	}
}

// ── Team event sink ─────────────────────────────────────────────────────────

/**
 * Creates a team-event handler that mirrors agent team tasks onto the Kanban board.
 */
export function createTeamEventSink(
	workspacePath: string,
	options: KanbanAgentSyncNotificationOptions = {},
): (event: OpaqueTeamEvent) => void {
	let baseRefPromise: Promise<string> | null = null;

	const getBaseRef = (): Promise<string> => {
		if (!baseRefPromise) {
			baseRefPromise = resolveBaseRef(workspacePath);
		}
		return baseRefPromise;
	};

	return (event: OpaqueTeamEvent): void => {
		void (async () => {
			try {
				const baseRef = await getBaseRef();
				const mutation = await mutateWorkspaceState(workspacePath, (state) => {
					const cleanup = cleanupLegacyTeamRunCards(state.board);
					const board = cleanup.board;

					switch (event.type) {
						case TEAM_TASK_UPDATED: {
							const task = event["task"] as TeamTask;
							const result = syncSyntheticCard({
								board,
								taskId: `team-${task.id}`,
								targetColumn: teamTaskStatusToColumn(task.status),
								prompt: buildTeamTaskPrompt(task),
								baseRef,
							});
							return result.changed || cleanup.changed
								? { board: result.board, value: null }
								: { board, value: null, save: false };
						}
						case TEAMMATE_SPAWNED: {
							const teammateEvent = event as TeammateSpawnedEvent;
							const teammateTaskId = makeTeammateCardId(teammateEvent.agentId);
							const teammateRole =
								teammateEvent.role ??
								teammateEvent.teammate.rolePrompt?.split("\n")[0]?.slice(0, 80);
							const result = syncSyntheticCard({
								board,
								taskId: teammateTaskId,
								targetColumn: "backlog",
								prompt: buildTeammatePrompt(teammateEvent),
								baseRef,
								parentTaskId: options.rootTaskId,
								role: teammateRole,
							});
							return result.changed || cleanup.changed
								? { board: result.board, value: null }
								: { board, value: null, save: false };
						}
						case TEAMMATE_SHUTDOWN: {
							const shutdownEvent = event as TeammateShutdownEvent;
							const existing = findCard(board, makeTeammateCardId(shutdownEvent.agentId));
							if (!existing) {
								return { board, value: null, save: false };
							}
							const result = syncSyntheticCard({
								board,
								taskId: makeTeammateCardId(shutdownEvent.agentId),
								targetColumn: "trash",
								prompt: buildTeammateShutdownPrompt(existing.card.prompt, shutdownEvent),
								baseRef,
							});
							return result.changed || cleanup.changed
								? { board: result.board, value: null }
								: { board, value: null, save: false };
						}
						case RUN_QUEUED:
						case RUN_STARTED:
						case RUN_PROGRESS:
						case RUN_COMPLETED:
						case RUN_FAILED:
						case RUN_CANCELLED:
						case RUN_INTERRUPTED: {
							const runEvent = event as TeamRunEvent;
							const teammateTaskId = makeTeammateCardId(runEvent.run.agentId);
							const existing = findCard(board, teammateTaskId);
							if (!existing) {
								return { board, value: null, save: false };
							}
							const result = syncSyntheticCard({
								board,
								taskId: teammateTaskId,
								targetColumn: teamRunStatusToColumn(runEvent.type),
								prompt: buildTeammateRunPrompt(existing.card.prompt, runEvent),
								baseRef,
							});
							return result.changed || cleanup.changed
								? { board: result.board, value: null }
								: { board, value: null, save: false };
						}
						default:
							return cleanup.changed ? { board, value: null } : { board, value: null, save: false };
					}
				});
				if (event.type === TEAMMATE_SPAWNED) {
					const teammateEvent = event as TeammateSpawnedEvent;
					const conversationId = teammateEvent.teammate.conversationId?.trim() || "";
					if (conversationId) {
						await options.onTeammateDiscovered?.({
							taskId: makeTeammateCardId(teammateEvent.agentId),
							agentId: teammateEvent.agentId,
							conversationId,
							workspacePath,
						});
					}
				}
				const syntheticTaskId = getSyntheticTaskIdForEvent(event);
				if (syntheticTaskId) {
					await options.onTeammateEvent?.({
						taskId: syntheticTaskId,
						event,
						workspacePath,
					});
				}
				await notifyBoardChanged(mutation.saved, options);
			} catch {
				// Swallow errors — kanban sync is best-effort and must not crash the agent
			}
		})();
	};
}

/**
 * Maps a team-task status into the board column used for synced cards.
 */
function teamTaskStatusToColumn(status: TeamTaskStatus): "backlog" | "in_progress" | "trash" {
	switch (status) {
		case "pending":
			return "backlog";
		case "in_progress":
		case "blocked":
			return "in_progress";
		case "completed":
			return "trash";
	}
}

/**
 * Formats the synthetic board card prompt for a synced team task.
 */
function buildTeamTaskPrompt(task: TeamTask): string {
	const lines: string[] = [`[${task.id}] ${task.title}`];
	if (task.description) {
		lines.push(task.description);
	}
	if (task.assignee) {
		lines.push(`Assigned to: ${task.assignee}`);
	}
	if (task.status === "blocked" && task.summary) {
		lines.push(`Blocked: ${task.summary}`);
	}
	return lines.join("\n");
}

/**
 * Maps a delegated team run lifecycle event into the board column used for its synthetic card.
 */
function teamRunStatusToColumn(eventType: TeamRunEvent["type"]): RuntimeBoardColumnId {
	switch (eventType) {
		case RUN_QUEUED:
			return "in_progress";
		case RUN_STARTED:
		case RUN_PROGRESS:
			return "in_progress";
		case RUN_FAILED:
		case RUN_INTERRUPTED:
			return "review";
		case RUN_COMPLETED:
		case RUN_CANCELLED:
			return "backlog";
	}
}

/**
 * Formats the synthetic board card prompt for a spawned teammate.
 */
function buildTeammatePrompt(event: TeammateSpawnedEvent): string {
	const lines = [`Teammate: ${event.agentId}`];
	if (event.role) {
		lines.push(`Role: ${event.role}`);
	}
	if (event.teammate.modelId) {
		lines.push(`Model: ${event.teammate.modelId}`);
	}
	if (event.teammate.rolePrompt) {
		lines.push(event.teammate.rolePrompt);
	}
	return lines.join("\n");
}

/**
 * Appends shutdown context to the teammate card prompt when the teammate stops.
 */
function buildTeammateShutdownPrompt(existingPrompt: string, event: TeammateShutdownEvent): string {
	if (!event.reason?.trim()) {
		return existingPrompt;
	}
	return `${existingPrompt}\nStopped: ${event.reason.trim()}`;
}

/**
 * Formats the teammate card prompt with the latest delegated run status.
 */
function buildTeammateRunPrompt(existingPrompt: string, event: TeamRunEvent): string {
	const lines = existingPrompt
		.split("\n")
		.filter(
			(line) =>
				!line.startsWith("Run: ") &&
				!line.startsWith("Status: ") &&
				!line.startsWith("Team task: ") &&
				!line.startsWith("Progress: ") &&
				!line.startsWith("Result: "),
		);
	lines.push(`Run: ${event.run.id}`);
	lines.push(`Status: ${event.run.status}`);
	if (event.run.taskId) {
		lines.push(`Team task: ${event.run.taskId}`);
	}
	const progress = event.message?.trim() || event.run.currentActivity?.trim() || event.run.lastProgressMessage?.trim();
	if (progress) {
		lines.push(`Progress: ${progress}`);
	}
	const failure = event.reason?.trim() || event.run.error?.trim();
	if (failure) {
		lines.push(`Result: ${failure}`);
	}
	return lines.join("\n");
}

// ── Sub-agent plugin ────────────────────────────────────────────────────────
//
// Implements the optional plugin methods that DefaultSessionManager calls via
// invokeOptional("handleSubAgentStart", ...) and
// invokeOptional("handleSubAgentEnd", ...).
//
// Mix into your session service object:
//   Object.assign(mySessionService, createSubAgentPlugin(workspacePath));

export interface SubAgentStartContext {
	subAgentId: string;
	conversationId: string;
	parentAgentId: string;
	input: {
		task?: string;
		[key: string]: unknown;
	};
}

export interface SubAgentEndContext {
	subAgentId: string;
	conversationId: string;
	parentAgentId: string;
	input: {
		task?: string;
		[key: string]: unknown;
	};
	result?: { text?: string; finishReason?: string };
	error?: Error;
}

export interface SubAgentPlugin {
	handleSubAgentStart(rootSessionId: string, context: unknown): Promise<void>;
	handleSubAgentEnd(rootSessionId: string, context: unknown): Promise<void>;
}

interface KanbanAgentSyncNotificationOptions {
	rootTaskId?: string;
	onBoardChanged?: () => Promise<void> | void;
	onTeammateDiscovered?: (input: {
		taskId: string;
		agentId: string;
		conversationId: string;
		workspacePath: string;
	}) => Promise<void> | void;
	onTeammateEvent?: (input: { taskId: string; event: OpaqueTeamEvent; workspacePath: string }) => Promise<void> | void;
}

/**
 * Broadcasts a board-change notification only when a workspace mutation persisted.
 */
async function notifyBoardChanged(mutationSaved: boolean, options: KanbanAgentSyncNotificationOptions): Promise<void> {
	if (!mutationSaved) {
		return;
	}
	await options.onBoardChanged?.();
}

/**
 * Creates the sub-agent lifecycle plugin that mirrors spawned agents onto the board.
 */
export function createSubAgentPlugin(
	workspacePath: string,
	options: KanbanAgentSyncNotificationOptions = {},
): SubAgentPlugin {
	let baseRefPromise: Promise<string> | null = null;

	const getBaseRef = (): Promise<string> => {
		if (!baseRefPromise) {
			baseRefPromise = resolveBaseRef(workspacePath);
		}
		return baseRefPromise;
	};

	return {
		async handleSubAgentStart(_rootSessionId: string, context: unknown): Promise<void> {
			const ctx = context as SubAgentStartContext;
			try {
				const baseRef = await getBaseRef();
				const kanbanTaskId = makeAgentCardId(ctx.subAgentId);
				const prompt = buildSubAgentPrompt(ctx);

				const mutation = await mutateWorkspaceState(workspacePath, (state) => {
					const { board } = state;

					// Skip if card already exists (idempotent)
					for (const column of board.columns) {
						if (column.cards.some((c) => c.id === kanbanTaskId)) {
							return { board, value: null, save: false };
						}
					}

					const { board: updatedBoard } = addTaskToColumn(
						board,
						"in_progress",
						{
							taskId: kanbanTaskId,
							prompt,
							baseRef,
							startInPlanMode: false,
						},
						() => kanbanTaskId,
					);
					return { board: updatedBoard, value: null };
				});
				await notifyBoardChanged(mutation.saved, options);
			} catch {
				// Best-effort — do not crash the agent
			}
		},

		async handleSubAgentEnd(_rootSessionId: string, context: unknown): Promise<void> {
			const ctx = context as SubAgentEndContext;
			try {
				const kanbanTaskId = makeAgentCardId(ctx.subAgentId);
				const targetColumn = ctx.error ? "review" : "trash";

				const mutation = await mutateWorkspaceState(workspacePath, (state) => {
					const { board } = state;

					// Only move if the card exists
					let existingColumn: string | null = null;
					for (const column of board.columns) {
						if (column.cards.some((c) => c.id === kanbanTaskId)) {
							existingColumn = column.id;
							break;
						}
					}

					if (!existingColumn || existingColumn === targetColumn) {
						return { board, value: null, save: false };
					}

					const { board: updatedBoard } = moveTaskToColumn(board, kanbanTaskId, targetColumn);
					return { board: updatedBoard, value: null };
				});
				await notifyBoardChanged(mutation.saved, options);
			} catch {
				// Best-effort — do not crash the agent
			}
		},
	};
}

/**
 * Formats the synthetic board card prompt for a spawned sub-agent.
 */
function buildSubAgentPrompt(context: SubAgentStartContext): string {
	const lines: string[] = [`Sub-agent: ${context.subAgentId}`];
	lines.push(`Parent: ${context.parentAgentId}`);
	if (context.input.task) {
		lines.push(String(context.input.task));
	}
	return lines.join("\n");
}

// ── Combined factory ────────────────────────────────────────────────────────

export interface KanbanAgentSync {
	/**
	 * Pass as CoreSessionConfig.onTeamEvent to sync team_task events.
	 * Typed as (event: unknown) => void so it's assignable to the real
	 * CoreSessionConfig.onTeamEvent: (event: TeamEvent) => void without
	 * importing @clinebot/agents here.
	 */
	onTeamEvent: (event: OpaqueTeamEvent) => void;
	/**
	 * Mix into your session service to receive sub-agent lifecycle hooks.
	 * Example:
	 *   Object.assign(sessionService, sync.sessionServicePlugin);
	 */
	sessionServicePlugin: SubAgentPlugin;
}

/**
 * Creates the board sync bridge for team-task events and spawned sub-agent lifecycle hooks.
 */
export function createKanbanAgentSync(options: {
	workspacePath: string;
	rootTaskId?: string;
	onBoardChanged?: () => Promise<void> | void;
	onTeammateDiscovered?: (input: {
		taskId: string;
		agentId: string;
		conversationId: string;
		workspacePath: string;
	}) => Promise<void> | void;
	onTeammateEvent?: (input: { taskId: string; event: OpaqueTeamEvent; workspacePath: string }) => Promise<void> | void;
}): KanbanAgentSync {
	const { workspacePath, rootTaskId, onBoardChanged, onTeammateDiscovered, onTeammateEvent } = options;
	return {
		onTeamEvent: createTeamEventSink(workspacePath, { rootTaskId, onBoardChanged, onTeammateDiscovered, onTeammateEvent }),
		sessionServicePlugin: createSubAgentPlugin(workspacePath, { onBoardChanged }),
	};
}
