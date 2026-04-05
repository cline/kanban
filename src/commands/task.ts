import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import type { Command } from "commander";

import type {
	RuntimeBoardCard,
	RuntimeBoardColumnId,
	RuntimeBoardDependency,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract";
import { buildKanbanRuntimeUrl, getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import {
	addTaskDependency,
	addTaskToColumn,
	deleteTasksFromBoard,
	getTaskColumnId,
	moveTaskToColumn,
	type RuntimeAddTaskDependencyResult,
	removeTaskDependency,
	trashTaskAndGetReadyLinkedTaskIds,
	updateTask,
} from "../core/task-board-mutations";
import { resolveProjectInputPath } from "../projects/project-path";
import { loadWorkspaceContext, loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state";
import type { RuntimeAppRouter } from "../trpc/app-router";

const LIST_TASK_COLUMNS = ["backlog", "in_progress", "review", "trash"] as const;
type ListTaskColumn = (typeof LIST_TASK_COLUMNS)[number];
type TaskCommandTarget = { taskId?: string; column?: ListTaskColumn };

type ResolvedTaskCommandTarget =
	| {
			kind: "task";
			taskId: string;
	  }
	| {
			kind: "column";
			column: ListTaskColumn;
	  };

interface RuntimeWorkspaceMutationResult<T> {
	board: RuntimeWorkspaceStateResponse["board"];
	value: T;
}

type JsonRecord = Record<string, unknown>;
type RuntimeClient = ReturnType<typeof createRuntimeTrpcClient>;

interface TaskCommandRuntimeAccess {
	runtimeAvailable: boolean;
	runtimeClient: RuntimeClient | null;
	warnings: string[];
}

const LOCAL_RUNTIME_WARNING =
	"Kanban runtime is unreachable from this session; command completed using local workspace state only.";

/**
 * Parses a process environment boolean flag using the same truthy/falsey conventions as CLI options.
 */
function parseEnvironmentBooleanFlag(value: string | undefined): boolean {
	if (value === undefined) {
		return false;
	}
	const normalized = value.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Detects when the current Codex task session explicitly advertises that networking is sandbox-disabled.
 */
function isCodexSandboxNetworkDisabled(): boolean {
	return parseEnvironmentBooleanFlag(process.env.CODEX_SANDBOX_NETWORK_DISABLED);
}

/**
 * Converts an unknown thrown value into a readable error message for CLI output.
 */
function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

/**
 * Prints a JSON payload to stdout using stable pretty formatting for CLI consumers.
 */
function printJson(payload: unknown): void {
	process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

/**
 * Parses the optional list-column flag into a strongly typed Kanban board column.
 */
function parseListColumn(value: string | undefined): ListTaskColumn | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "backlog" || value === "in_progress" || value === "review" || value === "trash") {
		return value;
	}
	throw new Error(`Invalid column "${value}". Expected one of: ${LIST_TASK_COLUMNS.join(", ")}.`);
}

/**
 * Parses the optional auto-review mode flag into the supported runtime enum values.
 */
function parseAutoReviewMode(value: string | undefined): "commit" | "pr" | "move_to_trash" | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "commit" || value === "pr" || value === "move_to_trash") {
		return value;
	}
	throw new Error(`Invalid auto review mode "${value}". Expected: commit, pr, move_to_trash.`);
}

/**
 * Resolves whether a task command is targeting a single task or a whole column.
 */
function resolveTaskCommandTarget(input: TaskCommandTarget, commandName: string): ResolvedTaskCommandTarget {
	const taskId = input.taskId?.trim();
	const column = input.column;
	if (taskId && column) {
		throw new Error(`${commandName} accepts exactly one of --task-id or --column.`);
	}
	if (taskId) {
		return {
			kind: "task",
			taskId,
		};
	}
	if (column) {
		return {
			kind: "column",
			column,
		};
	}
	throw new Error(`${commandName} requires either --task-id or --column.`);
}

/**
 * Creates the workspace-scoped TRPC client used by task commands when the runtime is reachable.
 */
function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: buildKanbanRuntimeUrl("/api/trpc"),
				headers: () => (workspaceId ? { "x-kanban-workspace-id": workspaceId } : {}),
			}),
		],
	});
}

/**
 * Resolves the local workspace context for a task command, optionally creating its local Kanban state.
 */
async function resolveRuntimeWorkspace(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
) {
	const normalizedProjectPath = (projectPath ?? "").trim();
	const resolvedPath = normalizedProjectPath ? resolveProjectInputPath(normalizedProjectPath, cwd) : cwd;
	return await loadWorkspaceContext(resolvedPath, {
		autoCreateIfMissing: options.autoCreateIfMissing ?? true,
	});
}

/**
 * Resolves the repository path that backs the current task command workspace.
 */
async function resolveWorkspaceRepoPath(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
): Promise<string> {
	const workspace = await resolveRuntimeWorkspace(projectPath, cwd, options);
	return workspace.repoPath;
}

/**
 * Ensures the current workspace is registered with the runtime so TRPC calls can be scoped correctly.
 */
async function ensureRuntimeWorkspace(workspaceRepoPath: string): Promise<string> {
	const runtimeClient = createRuntimeTrpcClient(null);
	const added = await runtimeClient.projects.add.mutate({
		path: workspaceRepoPath,
	});
	if (!added.ok || !added.project) {
		throw new Error(added.error ?? `Could not register project ${workspaceRepoPath} in Kanban runtime.`);
	}
	return added.project.id;
}

/**
 * Best-effort notifies the runtime that persisted workspace state changed on disk.
 */
async function notifyRuntimeWorkspaceStateUpdated(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
): Promise<void> {
	await runtimeClient.workspace.notifyStateUpdated.mutate().catch(() => null);
}

/**
 * Recursively collects nested error messages so transport classification can inspect wrapped failures.
 */
function collectErrorMessages(error: unknown): string[] {
	const messages: string[] = [];
	const visited = new Set<unknown>();

	const visit = (value: unknown): void => {
		if (value === null || value === undefined || visited.has(value)) {
			return;
		}
		visited.add(value);
		if (typeof value === "string") {
			messages.push(value);
			return;
		}
		if (value instanceof Error) {
			messages.push(value.message);
			visit((value as Error & { cause?: unknown }).cause);
			return;
		}
		if (typeof value === "object") {
			const record = value as Record<string, unknown>;
			if (typeof record.message === "string") {
				messages.push(record.message);
			}
			visit(record.cause);
		}
	};

	visit(error);
	return messages.map((message) => message.trim()).filter((message) => message.length > 0);
}

/**
 * Detects transport-layer runtime failures so task commands can fall back to local board state when safe.
 */
function isRuntimeTransportError(error: unknown): boolean {
	const haystack = collectErrorMessages(error).join("\n").toLowerCase();
	return [
		"fetch failed",
		"failed to fetch",
		"network disabled",
		"operation not permitted",
		"econnrefused",
		"connect econnrefused",
		"socket hang up",
		"other side closed",
	].some((fragment) => haystack.includes(fragment));
}

/**
 * Builds the explicit runtime-unavailable error used for commands that cannot safely fall back to local state.
 */
function buildRuntimeRequiredError(commandName: string): Error {
	return new Error(
		`${commandName} requires the Kanban runtime, but it is unreachable from this session ` +
			`(current runtime: ${getKanbanRuntimeOrigin()}). This can happen inside sandboxed Codex task sessions with network disabled.`,
	);
}

/**
 * Attempts to register the workspace with the runtime, returning a local-only mode descriptor when transport is unavailable.
 */
async function tryEnsureRuntimeWorkspace(workspaceRepoPath: string): Promise<TaskCommandRuntimeAccess> {
	if (isCodexSandboxNetworkDisabled()) {
		return {
			runtimeAvailable: false,
			runtimeClient: null,
			warnings: [LOCAL_RUNTIME_WARNING],
		};
	}

	try {
		const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
		return {
			runtimeAvailable: true,
			runtimeClient: createRuntimeTrpcClient(workspaceId),
			warnings: [],
		};
	} catch (error) {
		if (!isRuntimeTransportError(error)) {
			throw error;
		}
		return {
			runtimeAvailable: false,
			runtimeClient: null,
			warnings: [LOCAL_RUNTIME_WARNING],
		};
	}
}

/**
 * Loads the latest workspace state from the runtime when available, otherwise from the local persisted workspace files.
 */
async function loadTaskCommandWorkspaceState(
	workspaceRepoPath: string,
	runtimeClient: RuntimeClient | null,
): Promise<{ state: RuntimeWorkspaceStateResponse; runtimeAvailable: boolean; warnings: string[] }> {
	if (!runtimeClient || isCodexSandboxNetworkDisabled()) {
		return {
			state: await loadWorkspaceState(workspaceRepoPath),
			runtimeAvailable: false,
			warnings: [LOCAL_RUNTIME_WARNING],
		};
	}

	try {
		return {
			state: await runtimeClient.workspace.getState.query(),
			runtimeAvailable: true,
			warnings: [],
		};
	} catch (error) {
		if (!isRuntimeTransportError(error)) {
			throw error;
		}
		return {
			state: await loadWorkspaceState(workspaceRepoPath),
			runtimeAvailable: false,
			warnings: [LOCAL_RUNTIME_WARNING],
		};
	}
}

/**
 * Persists workspace state mutations and only emits runtime change notifications when a live runtime is available.
 */
async function updateRuntimeWorkspaceState<T>(
	runtimeClient: RuntimeClient | null,
	workspaceRepoPath: string,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceMutationResult<T>,
): Promise<T> {
	const mutationResponse = await mutateWorkspaceState(workspaceRepoPath, (state) => {
		const mutation = mutate(state);
		return {
			board: mutation.board,
			value: mutation.value,
		};
	});

	if (mutationResponse.saved && runtimeClient) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	return mutationResponse.value;
}

/**
 * Resolves the base branch used for new tasks when the caller does not provide one explicitly.
 */
function resolveTaskBaseRef(state: RuntimeWorkspaceStateResponse): string {
	return state.git.currentBranch ?? state.git.defaultBranch ?? state.git.branches[0] ?? "";
}

/**
 * Finds a task and its containing column inside the current board state.
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
 * Formats a task record into the stable JSON payload returned by task CLI commands.
 */
function formatTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	task: RuntimeBoardCard,
	columnId: RuntimeBoardColumnId,
): JsonRecord {
	const session = state.sessions[task.id] ?? null;
	return {
		id: task.id,
		prompt: task.prompt,
		column: columnId,
		baseRef: task.baseRef,
		startInPlanMode: task.startInPlanMode,
		autoReviewEnabled: task.autoReviewEnabled === true,
		autoReviewMode: task.autoReviewMode ?? "commit",
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
		session: session
			? {
					state: session.state,
					agentId: session.agentId,
					pid: session.pid,
					startedAt: session.startedAt,
					updatedAt: session.updatedAt,
					lastOutputAt: session.lastOutputAt,
					reviewReason: session.reviewReason,
					exitCode: session.exitCode,
				}
			: null,
	};
}

/**
 * Formats a dependency link into the JSON representation returned by task CLI commands.
 */
function formatDependencyRecord(
	state: RuntimeWorkspaceStateResponse,
	dependency: RuntimeBoardDependency,
): Record<string, unknown> {
	return {
		id: dependency.id,
		backlogTaskId: dependency.fromTaskId,
		backlogTaskColumn: getTaskColumnId(state.board, dependency.fromTaskId),
		linkedTaskId: dependency.toTaskId,
		linkedTaskColumn: getTaskColumnId(state.board, dependency.toTaskId),
		createdAt: dependency.createdAt,
	};
}

/**
 * Converts dependency creation failure codes into user-facing CLI error messages.
 */
function getLinkFailureMessage(reason: RuntimeAddTaskDependencyResult["reason"]): string {
	if (reason === "same_task") {
		return "A task cannot be linked to itself.";
	}
	if (reason === "duplicate") {
		return "These tasks are already linked.";
	}
	if (reason === "trash_task") {
		return "Links cannot include trashed tasks.";
	}
	if (reason === "non_backlog") {
		return "Links require at least one backlog task.";
	}
	return "One or both tasks could not be found.";
}

/**
 * Returns every task record currently present in the requested board column.
 */
function findTasksInColumn(
	state: RuntimeWorkspaceStateResponse,
	columnId: ListTaskColumn,
): Array<{ task: RuntimeBoardCard; columnId: RuntimeBoardColumnId }> {
	const column = state.board.columns.find((candidate) => candidate.id === columnId);
	if (!column) {
		return [];
	}
	return column.cards.map((task) => ({
		task,
		columnId: column.id,
	}));
}

/**
 * Lists tasks for a workspace, falling back to local persisted board state when runtime transport is unavailable.
 */
async function listTasks(input: { cwd: string; projectPath?: string; column?: ListTaskColumn }): Promise<JsonRecord> {
	const workspace = await resolveRuntimeWorkspace(input.projectPath, input.cwd, {
		autoCreateIfMissing: false,
	});
	const runtimeAccess = await tryEnsureRuntimeWorkspace(workspace.repoPath);
	const loadedState = await loadTaskCommandWorkspaceState(workspace.repoPath, runtimeAccess.runtimeClient);
	const state = loadedState.state;

	const tasks = state.board.columns.flatMap((boardColumn) => {
		if (!input.column && boardColumn.id === "trash") {
			return [];
		}
		if (input.column && boardColumn.id !== input.column) {
			return [];
		}
		return boardColumn.cards.map((task) => formatTaskRecord(state, task, boardColumn.id));
	});

	return {
		ok: true,
		workspacePath: workspace.repoPath,
		column: input.column ?? null,
		tasks,
		dependencies: state.board.dependencies.map((dependency) => formatDependencyRecord(state, dependency)),
		count: tasks.length,
		runtimeAvailable: loadedState.runtimeAvailable,
		warnings: loadedState.warnings,
	};
}

async function stopTaskRuntimeSession(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<void> {
	await runtimeClient.runtime.stopTaskSession
		.mutate({
			taskId,
		})
		.catch(() => null);
}

async function deleteTaskWorkspace(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	taskId: string,
): Promise<{ removed: boolean; error?: string }> {
	try {
		const deleted = await runtimeClient.workspace.deleteWorktree.mutate({
			taskId,
		});
		return {
			removed: deleted.removed,
			error: deleted.ok ? undefined : deleted.error,
		};
	} catch (error) {
		return {
			removed: false,
			error: toErrorMessage(error),
		};
	}
}

/**
 * Creates a new backlog task, using local-only workspace mutation when runtime transport is unavailable.
 */
async function createTask(input: {
	cwd: string;
	prompt: string;
	projectPath?: string;
	baseRef?: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: "commit" | "pr" | "move_to_trash";
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const runtimeAccess = await tryEnsureRuntimeWorkspace(workspaceRepoPath);
	const created = await updateRuntimeWorkspaceState(runtimeAccess.runtimeClient, workspaceRepoPath, (state) => {
		const resolvedBaseRef = (input.baseRef ?? "").trim() || resolveTaskBaseRef(state);
		if (!resolvedBaseRef) {
			throw new Error("Could not determine task base branch for this workspace.");
		}
		const result = addTaskToColumn(
			state.board,
			"backlog",
			{
				prompt: input.prompt,
				startInPlanMode: input.startInPlanMode,
				autoReviewEnabled: input.autoReviewEnabled,
				autoReviewMode: input.autoReviewMode,
				baseRef: resolvedBaseRef,
			},
			() => globalThis.crypto.randomUUID(),
		);
		return {
			board: result.board,
			value: result.task,
		};
	});

	return {
		ok: true,
		task: {
			id: created.id,
			column: "backlog",
			workspacePath: workspaceRepoPath,
			prompt: created.prompt,
			baseRef: created.baseRef,
			startInPlanMode: created.startInPlanMode,
			autoReviewEnabled: created.autoReviewEnabled === true,
			autoReviewMode: created.autoReviewMode ?? "commit",
		},
		runtimeAvailable: runtimeAccess.runtimeAvailable,
		warnings: runtimeAccess.warnings,
	};
}

/**
 * Updates a task in place, falling back to local persisted workspace mutation when runtime transport is unavailable.
 */
async function updateTaskCommand(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	prompt?: string;
	baseRef?: string;
	startInPlanMode?: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: "commit" | "pr" | "move_to_trash";
}): Promise<JsonRecord> {
	if (
		input.prompt === undefined &&
		input.baseRef === undefined &&
		input.startInPlanMode === undefined &&
		input.autoReviewEnabled === undefined &&
		input.autoReviewMode === undefined
	) {
		throw new Error("task update requires at least one field to change.");
	}

	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const runtimeAccess = await tryEnsureRuntimeWorkspace(workspaceRepoPath);
	const updated = await updateRuntimeWorkspaceState(runtimeAccess.runtimeClient, workspaceRepoPath, (runtimeState) => {
		const taskRecord = findTaskRecord(runtimeState, input.taskId);
		if (!taskRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
		}

		const updatedTask = updateTask(runtimeState.board, input.taskId, {
			prompt: input.prompt ?? taskRecord.task.prompt,
			baseRef: input.baseRef ?? taskRecord.task.baseRef,
			startInPlanMode: input.startInPlanMode ?? taskRecord.task.startInPlanMode,
			autoReviewEnabled: input.autoReviewEnabled ?? taskRecord.task.autoReviewEnabled === true,
			autoReviewMode: input.autoReviewMode ?? taskRecord.task.autoReviewMode ?? "commit",
		});
		if (!updatedTask.updated || !updatedTask.task) {
			throw new Error(`Task "${input.taskId}" could not be updated.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: updatedTask.board,
		};

		return {
			board: updatedTask.board,
			value: formatTaskRecord(nextState, updatedTask.task, taskRecord.columnId),
		};
	});

	return {
		ok: true,
		task: updated,
		workspacePath: workspaceRepoPath,
		runtimeAvailable: runtimeAccess.runtimeAvailable,
		warnings: runtimeAccess.warnings,
	};
}

/**
 * Creates a dependency link between two tasks, falling back to local persisted workspace mutation when runtime transport is unavailable.
 */
async function linkTasks(input: {
	cwd: string;
	taskId: string;
	linkedTaskId: string;
	projectPath?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const runtimeAccess = await tryEnsureRuntimeWorkspace(workspaceRepoPath);
	const dependency = await updateRuntimeWorkspaceState(runtimeAccess.runtimeClient, workspaceRepoPath, (runtimeState) => {
		const linked = addTaskDependency(runtimeState.board, input.taskId, input.linkedTaskId);
		if (!linked.added || !linked.dependency) {
			throw new Error(getLinkFailureMessage(linked.reason));
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: linked.board,
		};
		return {
			board: linked.board,
			value: formatDependencyRecord(nextState, linked.dependency),
		};
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		dependency,
		runtimeAvailable: runtimeAccess.runtimeAvailable,
		warnings: runtimeAccess.warnings,
	};
}

/**
 * Removes a dependency link, falling back to local persisted workspace mutation when runtime transport is unavailable.
 */
async function unlinkTasks(input: { cwd: string; dependencyId: string; projectPath?: string }): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const runtimeAccess = await tryEnsureRuntimeWorkspace(workspaceRepoPath);
	const removedDependency = await updateRuntimeWorkspaceState(runtimeAccess.runtimeClient, workspaceRepoPath, (runtimeState) => {
		const dependency =
			runtimeState.board.dependencies.find((candidate) => candidate.id === input.dependencyId) ?? null;
		if (!dependency) {
			throw new Error(`Dependency "${input.dependencyId}" was not found in workspace ${workspaceRepoPath}.`);
		}

		const unlinked = removeTaskDependency(runtimeState.board, input.dependencyId);
		if (!unlinked.removed) {
			throw new Error(`Dependency "${input.dependencyId}" could not be removed.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...runtimeState,
			board: unlinked.board,
		};
		return {
			board: unlinked.board,
			value: formatDependencyRecord(nextState, dependency),
		};
	});
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		removedDependency,
		runtimeAvailable: runtimeAccess.runtimeAvailable,
		warnings: runtimeAccess.warnings,
	};
}

/**
 * Starts a task session and intentionally fails with a clear error when the runtime is unreachable.
 */
async function startTask(input: { cwd: string; taskId: string; projectPath?: string }): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const runtimeAccess = await tryEnsureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = runtimeAccess.runtimeClient;
	if (!runtimeClient) {
		throw buildRuntimeRequiredError("task start");
	}

	let runtimeState: RuntimeWorkspaceStateResponse;
	try {
		runtimeState = await runtimeClient.workspace.getState.query();
	} catch (error) {
		if (isRuntimeTransportError(error)) {
			throw buildRuntimeRequiredError("task start");
		}
		throw error;
	}
	const fromColumnId = getTaskColumnId(runtimeState.board, input.taskId);
	if (!fromColumnId) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	if (fromColumnId !== "backlog" && fromColumnId !== "in_progress") {
		throw new Error(
			`Task "${input.taskId}" is in "${fromColumnId}" and can only be started from backlog or in_progress.`,
		);
	}

	const currentRecord = findTaskRecord(runtimeState, input.taskId);
	const task = currentRecord?.task;
	if (!task) {
		throw new Error(`Task "${input.taskId}" could not be resolved.`);
	}

	const existingSession = runtimeState.sessions[task.id] ?? null;
	const shouldStartSession = !existingSession || existingSession.state !== "running";

	if (shouldStartSession) {
		const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
			taskId: task.id,
			baseRef: task.baseRef,
		});
		if (!ensured.ok) {
			throw new Error(ensured.error ?? "Could not ensure task worktree.");
		}

		const started = await runtimeClient.runtime.startTaskSession.mutate({
			taskId: task.id,
			prompt: task.prompt,
			startInPlanMode: task.startInPlanMode,
			baseRef: task.baseRef,
		});
		if (!started.ok || !started.summary) {
			throw new Error(started.error ?? "Could not start task session.");
		}
	}

	const moved = await updateRuntimeWorkspaceState(runtimeClient, workspaceRepoPath, (latestState) => {
		const movement = moveTaskToColumn(latestState.board, input.taskId, "in_progress");
		if (!movement.task) {
			throw new Error(`Task "${input.taskId}" could not be resolved.`);
		}
		if (!movement.moved) {
			return {
				board: latestState.board,
				value: movement,
			};
		}
		return {
			board: movement.board,
			value: movement,
		};
	});

	if (!moved.moved) {
		return {
			ok: true,
			message: `Task "${input.taskId}" is already in progress.`,
			task: {
				id: task.id,
				prompt: task.prompt,
				column: "in_progress",
				workspacePath: workspaceRepoPath,
			},
		};
	}

	return {
		ok: true,
		task: {
			id: task.id,
			prompt: task.prompt,
			column: "in_progress",
			workspacePath: workspaceRepoPath,
		},
	};
}

interface TrashTaskExecutionResult {
	task: JsonRecord;
	taskId: string;
	previousColumnId: ListTaskColumn;
	readyTaskIds: string[];
	autoStartedTasks: JsonRecord[];
	worktreeDeleted: boolean;
	worktreeDeleteError?: string;
	alreadyInTrash: boolean;
}

interface TrashTaskMutationValue {
	task: JsonRecord;
	previousColumnId: ListTaskColumn;
	readyTaskIds: string[];
	alreadyInTrash: boolean;
}

function columnCanHaveLiveTaskSession(columnId: ListTaskColumn): boolean {
	return columnId === "in_progress" || columnId === "review";
}

async function trashTaskById(input: {
	cwd: string;
	taskId: string;
	projectPath?: string;
	workspaceRepoPath: string;
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>;
}): Promise<TrashTaskExecutionResult> {
	const mutation = await mutateWorkspaceState<TrashTaskMutationValue>(input.workspaceRepoPath, (latestState) => {
		const latestRecord = findTaskRecord(latestState, input.taskId);
		if (!latestRecord) {
			throw new Error(`Task "${input.taskId}" was not found in workspace ${input.workspaceRepoPath}.`);
		}
		if (latestRecord.columnId === "trash") {
			return {
				board: latestState.board,
				value: {
					task: formatTaskRecord(latestState, latestRecord.task, latestRecord.columnId),
					previousColumnId: latestRecord.columnId,
					readyTaskIds: [] as string[],
					alreadyInTrash: true,
				},
				save: false,
			};
		}

		const trashed = trashTaskAndGetReadyLinkedTaskIds(latestState.board, input.taskId);
		if (!trashed.moved || !trashed.task) {
			throw new Error(`Task "${input.taskId}" could not be moved to trash.`);
		}

		const nextState: RuntimeWorkspaceStateResponse = {
			...latestState,
			board: trashed.board,
		};
		return {
			board: trashed.board,
			value: {
				task: formatTaskRecord(nextState, trashed.task, "trash"),
				previousColumnId: latestRecord.columnId,
				readyTaskIds: trashed.readyTaskIds,
				alreadyInTrash: false,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(input.runtimeClient);
	}

	if (mutation.value.alreadyInTrash) {
		return {
			task: mutation.value.task,
			taskId: input.taskId,
			previousColumnId: mutation.value.previousColumnId,
			readyTaskIds: [],
			autoStartedTasks: [],
			worktreeDeleted: false,
			alreadyInTrash: true,
		};
	}

	if (columnCanHaveLiveTaskSession(mutation.value.previousColumnId)) {
		await stopTaskRuntimeSession(input.runtimeClient, input.taskId);
	}

	const autoStartedTasks: JsonRecord[] = [];
	for (const readyTaskId of mutation.value.readyTaskIds) {
		const started = await startTask({
			cwd: input.cwd,
			taskId: readyTaskId,
			projectPath: input.projectPath,
		});
		autoStartedTasks.push(started);
	}

	const deletedWorkspace = await deleteTaskWorkspace(input.runtimeClient, input.taskId);

	return {
		task: mutation.value.task,
		taskId: input.taskId,
		previousColumnId: mutation.value.previousColumnId,
		readyTaskIds: mutation.value.readyTaskIds,
		autoStartedTasks,
		worktreeDeleted: deletedWorkspace.removed,
		worktreeDeleteError: deletedWorkspace.error,
		alreadyInTrash: false,
	};
}

async function trashTask(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const target = resolveTaskCommandTarget(input, "task trash");
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);

	if (target.kind === "task") {
		const trashed = await trashTaskById({
			cwd: input.cwd,
			taskId: target.taskId,
			projectPath: input.projectPath,
			workspaceRepoPath,
			runtimeClient,
		});
		if (trashed.alreadyInTrash) {
			return {
				ok: true,
				message: `Task "${target.taskId}" is already in trash.`,
				task: trashed.task,
				workspacePath: workspaceRepoPath,
				readyTaskIds: [],
				autoStartedTasks: [],
			};
		}
		return {
			ok: true,
			task: trashed.task,
			workspacePath: workspaceRepoPath,
			readyTaskIds: trashed.readyTaskIds,
			autoStartedTasks: trashed.autoStartedTasks,
			worktreeDeleted: trashed.worktreeDeleted,
			worktreeDeleteError: trashed.worktreeDeleteError,
		};
	}

	const initialState = await runtimeClient.workspace.getState.query();
	const targetTasks = findTasksInColumn(initialState, target.column);
	if (targetTasks.length === 0) {
		return {
			ok: true,
			column: target.column,
			workspacePath: workspaceRepoPath,
			trashedTasks: [],
			alreadyTrashedTasks: [],
			readyTaskIds: [],
			autoStartedTasks: [],
			worktreeCleanup: [],
			count: 0,
		};
	}

	const results: TrashTaskExecutionResult[] = [];
	for (const { task } of targetTasks) {
		results.push(
			await trashTaskById({
				cwd: input.cwd,
				taskId: task.id,
				projectPath: input.projectPath,
				workspaceRepoPath,
				runtimeClient,
			}),
		);
	}

	const trashedTasks = results.filter((result) => !result.alreadyInTrash);
	const alreadyTrashedTasks = results.filter((result) => result.alreadyInTrash);

	return {
		ok: true,
		column: target.column,
		workspacePath: workspaceRepoPath,
		trashedTasks: trashedTasks.map((result) => result.task),
		alreadyTrashedTasks: alreadyTrashedTasks.map((result) => result.task),
		readyTaskIds: [...new Set(trashedTasks.flatMap((result) => result.readyTaskIds))],
		autoStartedTasks: trashedTasks.flatMap((result) => result.autoStartedTasks),
		worktreeCleanup: trashedTasks.map((result) => ({
			taskId: result.taskId,
			removed: result.worktreeDeleted,
			error: result.worktreeDeleteError,
		})),
		count: trashedTasks.length,
	};
}

async function deleteTaskCommand(input: {
	cwd: string;
	taskId?: string;
	column?: ListTaskColumn;
	projectPath?: string;
}): Promise<JsonRecord> {
	const target = resolveTaskCommandTarget(input, "task delete");
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
	const runtimeClient = createRuntimeTrpcClient(workspaceId);
	const mutation = await mutateWorkspaceState(workspaceRepoPath, (latestState) => {
		const latestTargetRecords =
			target.kind === "task"
				? (() => {
						const record = findTaskRecord(latestState, target.taskId);
						if (!record) {
							throw new Error(`Task "${target.taskId}" was not found in workspace ${workspaceRepoPath}.`);
						}
						return [record];
					})()
				: findTasksInColumn(latestState, target.column);

		if (latestTargetRecords.length === 0) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deleted = deleteTasksFromBoard(
			latestState.board,
			latestTargetRecords.map(({ task }) => task.id),
		);
		if (!deleted.deleted) {
			return {
				board: latestState.board,
				value: {
					deletedTaskIds: [] as string[],
					taskIdsRequiringStop: [] as string[],
					deletedTasks: [] as JsonRecord[],
				},
				save: false,
			};
		}

		const deletedTasks = latestTargetRecords.map(({ task, columnId }) =>
			formatTaskRecord(latestState, task, columnId),
		);
		const taskIdsRequiringStop = latestTargetRecords
			.filter(({ columnId }) => columnCanHaveLiveTaskSession(columnId))
			.map(({ task }) => task.id);
		return {
			board: deleted.board,
			value: {
				deletedTaskIds: deleted.deletedTaskIds,
				taskIdsRequiringStop,
				deletedTasks,
			},
		};
	});

	if (mutation.saved) {
		await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
	}

	if (mutation.value.deletedTaskIds.length === 0) {
		return {
			ok: true,
			workspacePath: workspaceRepoPath,
			column: target.kind === "column" ? target.column : null,
			deletedTasks: [],
			count: 0,
		};
	}

	await Promise.all(
		mutation.value.taskIdsRequiringStop.map(async (taskId) => await stopTaskRuntimeSession(runtimeClient, taskId)),
	);

	const workspaceCleanupResults = await Promise.all(
		mutation.value.deletedTaskIds.map(async (taskId) => ({
			taskId,
			...(await deleteTaskWorkspace(runtimeClient, taskId)),
		})),
	);

	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		column: target.kind === "column" ? target.column : null,
		deletedTasks: mutation.value.deletedTasks,
		count: mutation.value.deletedTaskIds.length,
		worktreeCleanup: workspaceCleanupResults,
	};
}

function parseOptionalBooleanOption(value: unknown, flagName: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === true || value === false) {
		return value;
	}
	if (typeof value !== "string") {
		throw new Error(`Invalid boolean value for ${flagName}. Use true or false.`);
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes") {
		return true;
	}
	if (normalized === "false" || normalized === "0" || normalized === "no") {
		return false;
	}
	throw new Error(`Invalid boolean value for ${flagName}: "${value}". Use true or false.`);
}

/**
 * Runs a task CLI handler and reports failures in a stable JSON envelope.
 */
async function runTaskCommand(handler: () => Promise<JsonRecord>): Promise<void> {
	try {
		printJson(await handler());
	} catch (error) {
		const errorMessage = toErrorMessage(error);
		const renderedError = errorMessage.includes("requires the Kanban runtime")
			? errorMessage
			: `Task command failed at ${getKanbanRuntimeOrigin()}: ${errorMessage}`;
		printJson({
			ok: false,
			error: renderedError,
		});
		process.exitCode = 1;
	}
}

export function registerTaskCommand(program: Command): void {
	const task = program.command("task").alias("tasks").description("Manage Kanban board tasks from the CLI.");

	task
		.command("list")
		.description("List Kanban tasks for a workspace.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--column <column>", "Filter column: backlog | in_progress | review | trash.", parseListColumn)
		.action(async (options: { projectPath?: string; column?: ListTaskColumn }) => {
			await runTaskCommand(
				async () =>
					await listTasks({
						cwd: process.cwd(),
						projectPath: options.projectPath,
						column: options.column,
					}),
			);
		});

	task
		.command("create")
		.description("Create a task in backlog.")
		.requiredOption("--prompt <text>", "Task prompt text.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Task base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--auto-review-enabled [value]", "Enable auto-review behavior (true|false). Flag-only implies true.")
		.option("--auto-review-mode <mode>", "Auto-review mode: commit | pr | move_to_trash.", parseAutoReviewMode)
		.action(
			async (options: {
				prompt: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				autoReviewEnabled?: unknown;
				autoReviewMode?: "commit" | "pr" | "move_to_trash";
			}) => {
				await runTaskCommand(
					async () =>
						await createTask({
							cwd: process.cwd(),
							prompt: options.prompt,
							projectPath: options.projectPath,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							autoReviewEnabled: parseOptionalBooleanOption(options.autoReviewEnabled, "--auto-review-enabled"),
							autoReviewMode: options.autoReviewMode,
						}),
				);
			},
		);

	task
		.command("update")
		.description("Update an existing task.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--prompt <text>", "Replacement task prompt.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.option("--base-ref <branch>", "Replacement base branch/ref.")
		.option("--start-in-plan-mode [value]", "Set plan mode (true|false). Flag-only implies true.")
		.option("--auto-review-enabled [value]", "Enable auto-review behavior (true|false). Flag-only implies true.")
		.option("--auto-review-mode <mode>", "Auto-review mode: commit | pr | move_to_trash.", parseAutoReviewMode)
		.action(
			async (options: {
				taskId: string;
				prompt?: string;
				projectPath?: string;
				baseRef?: string;
				startInPlanMode?: unknown;
				autoReviewEnabled?: unknown;
				autoReviewMode?: "commit" | "pr" | "move_to_trash";
			}) => {
				await runTaskCommand(
					async () =>
						await updateTaskCommand({
							cwd: process.cwd(),
							taskId: options.taskId,
							projectPath: options.projectPath,
							prompt: options.prompt,
							baseRef: options.baseRef,
							startInPlanMode: parseOptionalBooleanOption(options.startInPlanMode, "--start-in-plan-mode"),
							autoReviewEnabled: parseOptionalBooleanOption(options.autoReviewEnabled, "--auto-review-enabled"),
							autoReviewMode: options.autoReviewMode,
						}),
				);
			},
		);

	task
		.command("trash")
		.description("Move a task or an entire column to trash and clean up task workspaces.")
		.option("--task-id <id>", "Task ID.")
		.option("--column <column>", "Column to bulk-trash: backlog | in_progress | review | trash.", parseListColumn)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await trashTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("delete")
		.description("Permanently delete a task or every task in a column.")
		.option("--task-id <id>", "Task ID to permanently delete.")
		.option("--column <column>", "Column to bulk-delete: backlog | in_progress | review | trash.", parseListColumn)
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId?: string; column?: ListTaskColumn; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await deleteTaskCommand({
						cwd: process.cwd(),
						taskId: options.taskId,
						column: options.column,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("link")
		.description("Link two tasks so one task waits on another.")
		.requiredOption("--task-id <id>", "One of the two task IDs to link.")
		.requiredOption("--linked-task-id <id>", "The other task ID to link.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.addHelpText(
			"after",
			[
				"",
				"Dependency direction:",
				"  If both linked tasks are in backlog, Kanban preserves the order you pass:",
				"  --task-id waits on --linked-task-id, and on the board the arrow points into",
				"  --linked-task-id.",
				"  Once only one linked task remains in backlog, Kanban reorients the saved link",
				"  so the backlog task is the waiting dependent task and the other task is the",
				"  prerequisite.",
				"  When the prerequisite finishes review and moves to trash, the waiting backlog",
				"  task becomes ready to start.",
				"",
			].join("\n"),
		)
		.action(async (options: { taskId: string; linkedTaskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await linkTasks({
						cwd: process.cwd(),
						taskId: options.taskId,
						linkedTaskId: options.linkedTaskId,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("unlink")
		.description("Remove an existing dependency link.")
		.requiredOption("--dependency-id <id>", "Dependency ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { dependencyId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await unlinkTasks({
						cwd: process.cwd(),
						dependencyId: options.dependencyId,
						projectPath: options.projectPath,
					}),
			);
		});

	task
		.command("start")
		.description("Start a task session and move task to in_progress.")
		.requiredOption("--task-id <id>", "Task ID.")
		.option("--project-path <path>", "Workspace path. Defaults to current directory workspace.")
		.action(async (options: { taskId: string; projectPath?: string }) => {
			await runTaskCommand(
				async () =>
					await startTask({
						cwd: process.cwd(),
						taskId: options.taskId,
						projectPath: options.projectPath,
					}),
			);
		});
}
