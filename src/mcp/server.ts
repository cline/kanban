import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { z } from "zod";

import type { RuntimeBoardCard, RuntimeBoardDependency, RuntimeWorkspaceStateResponse } from "../core/api-contract.js";
import { resolveProjectInputPath } from "../projects/project-path.js";
import { buildKanbanRuntimeUrl, KANBAN_RUNTIME_ORIGIN } from "../core/runtime-endpoint.js";
import { loadWorkspaceContext } from "../state/workspace-state.js";
import type { RuntimeAppRouter } from "../trpc/app-router.js";
import {
	addTaskDependency,
	addTaskToColumn,
	getTaskColumnId,
	type McpAddTaskDependencyResult,
	moveTaskToColumn,
	removeTaskDependency,
	updateTask,
} from "./task-state.js";

interface RuntimeWorkspaceMutationResult<T> {
	board: RuntimeWorkspaceStateResponse["board"];
	value: T;
}

const LIST_TASK_COLUMNS = ["backlog", "in_progress", "review"] as const;
const KANBAN_MCP_INSTRUCTIONS =
	"Kanban is a web-based multi-agent orchestration GUI that launches after running kanban or npx kanban in the terminal. It manages git worktrees automatically so that each task can run a dedicated CLI agent in its own worktree. If the user asks to add tasks to kb, ask kb, kanban, says go bananas, says banana mode, says bannana mode, or says add tasks without other context, they likely want to add tasks in Kanban. Kanban also supports linking tasks. Linking is useful both for parallelization and for dependencies: when work is easy to decompose into multiple pieces that can be done in parallel, link multiple backlog tasks to the same dependency so they all become ready to start once that dependency finishes; when one piece of work depends on another, use links to represent that follow-on dependency. A link requires at least one backlog task, and when the linked review task is moved to trash, that backlog task becomes ready to start. Tasks can also enable automatic review actions: auto-commit, auto-open-PR, or auto-move-to-trash once they reach review.";

async function resolveWorkspaceRepoPath(
	projectPath: string | undefined,
	cwd: string,
	options: { autoCreateIfMissing?: boolean } = {},
): Promise<string> {
	const workspace = await resolveWorkspaceContext(projectPath, cwd, options);
	return workspace.repoPath;
}

async function resolveWorkspaceContext(
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

function resolveTaskBaseRef(state: RuntimeWorkspaceStateResponse): string {
	return state.git.currentBranch ?? state.git.defaultBranch ?? state.git.branches[0] ?? "";
}

function getRuntimeApiUrl(): string {
	return buildKanbanRuntimeUrl("/api/trpc");
}

function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: getRuntimeApiUrl(),
				headers: () => (workspaceId ? { "x-kanban-workspace-id": workspaceId } : {}),
			}),
		],
	});
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message;
	}
	return String(error);
}

function createJsonToolResult(payload: unknown, options: { isError?: boolean } = {}) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(payload, null, 2),
			},
		],
		...(options.isError ? { isError: true } : {}),
	};
}

function createRuntimeToolError(toolName: string, message: string) {
	return createJsonToolResult(
		{
			ok: false,
			error: `Tool "${toolName}" at ${KANBAN_RUNTIME_ORIGIN} failed with message: ${message}`,
		},
		{ isError: true },
	);
}

function findTaskRecord(
	state: RuntimeWorkspaceStateResponse,
	taskId: string,
): { task: RuntimeBoardCard; columnId: string } | null {
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

function formatTaskRecord(state: RuntimeWorkspaceStateResponse, task: RuntimeBoardCard, columnId: string) {
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
					activityPreview: session.activityPreview,
					reviewReason: session.reviewReason,
					exitCode: session.exitCode,
				}
			: null,
	};
}

function formatDependencyRecord(state: RuntimeWorkspaceStateResponse, dependency: RuntimeBoardDependency) {
	return {
		id: dependency.id,
		backlogTaskId: dependency.fromTaskId,
		backlogTaskColumn: getTaskColumnId(state.board, dependency.fromTaskId),
		linkedTaskId: dependency.toTaskId,
		linkedTaskColumn: getTaskColumnId(state.board, dependency.toTaskId),
		createdAt: dependency.createdAt,
	};
}

function getLinkFailureMessage(reason: McpAddTaskDependencyResult["reason"]): string {
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

async function updateRuntimeWorkspaceState<T>(
	runtimeClient: ReturnType<typeof createRuntimeTrpcClient>,
	mutate: (state: RuntimeWorkspaceStateResponse) => RuntimeWorkspaceMutationResult<T>,
): Promise<T> {
	const state = await runtimeClient.workspace.getState.query();
	const mutation = mutate(state);
	await runtimeClient.workspace.saveState.mutate({
		board: mutation.board,
		sessions: state.sessions,
		expectedRevision: state.revision,
	});
	return mutation.value;
}

export function createMcpServer(cwd: string): McpServer {
	const server = new McpServer(
		{
			name: "kanban",
			version: "0.1.0",
		},
		{
			instructions: KANBAN_MCP_INSTRUCTIONS,
		},
	);

	server.registerTool(
		"list_tasks",
		{
			title: "List tasks",
			description: "List Kanban tasks for a workspace, including auto-review settings and task links.",
			inputSchema: {
				projectPath: z
					.string()
					.optional()
					.describe("Optional workspace path. Omit to return tasks for current working directory."),
				column: z
					.enum(LIST_TASK_COLUMNS)
					.optional()
					.describe("Optional task column filter. Omit to return tasks across backlog, in_progress, and review."),
			},
		},
		async ({ projectPath, column }) => {
			try {
				const workspace = await resolveWorkspaceContext(projectPath, cwd, {
					autoCreateIfMissing: false,
				});
				const runtimeClient = createRuntimeTrpcClient(workspace.workspaceId);
				const state = await runtimeClient.workspace.getState.query();

				const tasks = state.board.columns.flatMap((boardColumn) => {
					if (boardColumn.id === "trash") {
						return [];
					}
					if (column && boardColumn.id !== column) {
						return [];
					}
					return boardColumn.cards.map((task) => formatTaskRecord(state, task, boardColumn.id));
				});

				return createJsonToolResult({
					ok: true,
					workspacePath: workspace.repoPath,
					column: column ?? null,
					tasks,
					dependencies: state.board.dependencies.map((dependency) => formatDependencyRecord(state, dependency)),
					count: tasks.length,
				});
			} catch (error) {
				return createRuntimeToolError("list_tasks", toErrorMessage(error));
			}
		},
	);

	server.registerTool(
		"create_task",
		{
			title: "Create task",
			description: "Create a new Kanban task in backlog with optional plan mode and auto-review settings.",
			inputSchema: {
				prompt: z.string().min(1).describe("Task prompt text."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanban, it is auto-added if the project uses git.",
					),
				baseRef: z
					.string()
					.optional()
					.describe(
						"Optional base branch ref. Defaults to current branch, default branch, then first known branch.",
					),
				startInPlanMode: z
					.boolean()
					.optional()
					.default(false)
					.describe(
						"Optional, defaults to false. Set to true only when the user explicitly asks to start in plan mode.",
					),
				autoReviewEnabled: z
					.boolean()
					.optional()
					.default(false)
					.describe(
						"Optional, defaults to false. When true, the task will automatically run its configured review action after entering review.",
					),
				autoReviewMode: z
					.enum(["commit", "pr", "move_to_trash"])
					.optional()
					.describe(
						"Optional auto-review action. Defaults to commit. Use pr to open a PR or move_to_trash to trash review tasks automatically.",
					),
			},
		},
		async ({ prompt, projectPath, baseRef, startInPlanMode, autoReviewEnabled, autoReviewMode }) => {
			try {
				const workspaceRepoPath = await resolveWorkspaceRepoPath(projectPath, cwd);
				const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
				const runtimeClient = createRuntimeTrpcClient(workspaceId);
				const created = await updateRuntimeWorkspaceState(runtimeClient, (state) => {
					const resolvedBaseRef = (baseRef ?? "").trim() || resolveTaskBaseRef(state);
					if (!resolvedBaseRef) {
						throw new Error("Could not determine task base branch for this workspace.");
					}
					const result = addTaskToColumn(
						state.board,
						"backlog",
						{
							prompt,
							startInPlanMode,
							autoReviewEnabled,
							autoReviewMode,
							baseRef: resolvedBaseRef,
						},
						() => globalThis.crypto.randomUUID(),
					);
					return {
						board: result.board,
						value: result.task,
					};
				});

				return createJsonToolResult({
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
				});
			} catch (error) {
				return createRuntimeToolError("create_task", toErrorMessage(error));
			}
		},
	);

	server.registerTool(
		"update_task",
		{
			title: "Update task",
			description: "Update an existing Kanban task, including auto-review settings.",
			inputSchema: {
				taskId: z.string().min(1).describe("Task ID to update."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanban, it is auto-added if the project uses git.",
					),
				prompt: z.string().optional().describe("Optional replacement prompt text."),
				baseRef: z.string().optional().describe("Optional replacement worktree base ref."),
				startInPlanMode: z
					.boolean()
					.optional()
					.describe("Optional replacement for whether this task should start in plan mode."),
				autoReviewEnabled: z
					.boolean()
					.optional()
					.describe(
						"Optional replacement for whether this task should auto-run a review action. Set to false to cancel pending automatic review actions for the task.",
					),
				autoReviewMode: z
					.enum(["commit", "pr", "move_to_trash"])
					.optional()
					.describe("Optional replacement auto-review action."),
			},
		},
		async ({ taskId, projectPath, prompt, baseRef, startInPlanMode, autoReviewEnabled, autoReviewMode }) => {
			try {
				if (
					prompt === undefined &&
					baseRef === undefined &&
					startInPlanMode === undefined &&
					autoReviewEnabled === undefined &&
					autoReviewMode === undefined
				) {
					return createJsonToolResult(
						{
							ok: false,
							error: "update_task requires at least one field to change.",
						},
						{ isError: true },
					);
				}

				const workspaceRepoPath = await resolveWorkspaceRepoPath(projectPath, cwd);
				const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
				const runtimeClient = createRuntimeTrpcClient(workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const taskRecord = findTaskRecord(runtimeState, taskId);
				if (!taskRecord) {
					return createJsonToolResult(
						{
							ok: false,
							error: `Task "${taskId}" was not found in workspace ${workspaceRepoPath}.`,
						},
						{ isError: true },
					);
				}

				const updated = updateTask(runtimeState.board, taskId, {
					prompt: prompt ?? taskRecord.task.prompt,
					baseRef: baseRef ?? taskRecord.task.baseRef,
					startInPlanMode: startInPlanMode ?? taskRecord.task.startInPlanMode,
					autoReviewEnabled: autoReviewEnabled ?? taskRecord.task.autoReviewEnabled === true,
					autoReviewMode: autoReviewMode ?? taskRecord.task.autoReviewMode ?? "commit",
				});
				if (!updated.updated || !updated.task) {
					return createJsonToolResult(
						{
							ok: false,
							error: `Task "${taskId}" could not be updated.`,
						},
						{ isError: true },
					);
				}

				await runtimeClient.workspace.saveState.mutate({
					board: updated.board,
					sessions: runtimeState.sessions,
					expectedRevision: runtimeState.revision,
				});

				const nextState: RuntimeWorkspaceStateResponse = {
					...runtimeState,
					board: updated.board,
				};
				return createJsonToolResult({
					ok: true,
					task: formatTaskRecord(nextState, updated.task, taskRecord.columnId),
					workspacePath: workspaceRepoPath,
				});
			} catch (error) {
				return createRuntimeToolError("update_task", toErrorMessage(error));
			}
		},
	);

	server.registerTool(
		"link_tasks",
		{
			title: "Link tasks",
			description:
				"Link two Kanban tasks so one task can wait on another task. At least one task must be in backlog.",
			inputSchema: {
				taskId: z.string().min(1).describe("First task ID."),
				linkedTaskId: z.string().min(1).describe("Second task ID to link."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanban, it is auto-added if the project uses git.",
					),
			},
		},
		async ({ taskId, linkedTaskId, projectPath }) => {
			try {
				const workspaceRepoPath = await resolveWorkspaceRepoPath(projectPath, cwd);
				const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
				const runtimeClient = createRuntimeTrpcClient(workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const linked = addTaskDependency(runtimeState.board, taskId, linkedTaskId);
				if (!linked.added || !linked.dependency) {
					return createJsonToolResult(
						{
							ok: false,
							error: getLinkFailureMessage(linked.reason),
						},
						{ isError: true },
					);
				}

				await runtimeClient.workspace.saveState.mutate({
					board: linked.board,
					sessions: runtimeState.sessions,
					expectedRevision: runtimeState.revision,
				});

				const nextState: RuntimeWorkspaceStateResponse = {
					...runtimeState,
					board: linked.board,
				};
				return createJsonToolResult({
					ok: true,
					workspacePath: workspaceRepoPath,
					dependency: formatDependencyRecord(nextState, linked.dependency),
				});
			} catch (error) {
				return createRuntimeToolError("link_tasks", toErrorMessage(error));
			}
		},
	);

	server.registerTool(
		"unlink_tasks",
		{
			title: "Unlink tasks",
			description: "Remove a Kanban task link by dependency ID.",
			inputSchema: {
				dependencyId: z
					.string()
					.min(1)
					.describe("Dependency ID to remove. Use list_tasks to inspect current links."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanban, it is auto-added if the project uses git.",
					),
			},
		},
		async ({ dependencyId, projectPath }) => {
			try {
				const workspaceRepoPath = await resolveWorkspaceRepoPath(projectPath, cwd);
				const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
				const runtimeClient = createRuntimeTrpcClient(workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const dependency =
					runtimeState.board.dependencies.find((candidate) => candidate.id === dependencyId) ?? null;
				if (!dependency) {
					return createJsonToolResult(
						{
							ok: false,
							error: `Dependency "${dependencyId}" was not found in workspace ${workspaceRepoPath}.`,
						},
						{ isError: true },
					);
				}

				const unlinked = removeTaskDependency(runtimeState.board, dependencyId);
				if (!unlinked.removed) {
					return createJsonToolResult(
						{
							ok: false,
							error: `Dependency "${dependencyId}" could not be removed.`,
						},
						{ isError: true },
					);
				}

				await runtimeClient.workspace.saveState.mutate({
					board: unlinked.board,
					sessions: runtimeState.sessions,
					expectedRevision: runtimeState.revision,
				});

				const nextState: RuntimeWorkspaceStateResponse = {
					...runtimeState,
					board: unlinked.board,
				};
				return createJsonToolResult({
					ok: true,
					workspacePath: workspaceRepoPath,
					removedDependency: formatDependencyRecord(nextState, dependency),
				});
			} catch (error) {
				return createRuntimeToolError("unlink_tasks", toErrorMessage(error));
			}
		},
	);

	server.registerTool(
		"start_task",
		{
			title: "Start task",
			description:
				"Start a Kanban task by ensuring its worktree, starting its agent session, and moving it to in_progress.",
			inputSchema: {
				taskId: z.string().min(1).describe("Task ID to start."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanban, it is auto-added if the project uses git.",
					),
			},
		},
		async ({ taskId, projectPath }) => {
			try {
				const workspaceRepoPath = await resolveWorkspaceRepoPath(projectPath, cwd);
				const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
				const runtimeClient = createRuntimeTrpcClient(workspaceId);
				const runtimeState = await runtimeClient.workspace.getState.query();
				const fromColumnId = getTaskColumnId(runtimeState.board, taskId);
				if (!fromColumnId) {
					return createJsonToolResult(
						{ ok: false, error: `Task "${taskId}" was not found in workspace ${workspaceRepoPath}.` },
						{ isError: true },
					);
				}

				if (fromColumnId !== "backlog" && fromColumnId !== "in_progress") {
					return createJsonToolResult(
						{
							ok: false,
							error: `Task "${taskId}" is in "${fromColumnId}" and can only be started from backlog or in_progress.`,
						},
						{ isError: true },
					);
				}

				const moved = moveTaskToColumn(runtimeState.board, taskId, "in_progress");
				const task = moved.task;

				if (!task) {
					return createJsonToolResult(
						{ ok: false, error: `Task "${taskId}" could not be resolved.` },
						{ isError: true },
					);
				}

				const existingSession = runtimeState.sessions[task.id] ?? null;
				const shouldStartSession = !existingSession || existingSession.state !== "running";

				if (shouldStartSession) {
					const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
						taskId: task.id,
						baseRef: task.baseRef,
					});
					if (!ensured.ok) {
						return createRuntimeToolError("start_task", ensured.error ?? "Could not ensure task worktree.");
					}

					const started = await runtimeClient.runtime.startTaskSession.mutate({
						taskId: task.id,
						prompt: task.prompt,
						startInPlanMode: task.startInPlanMode,
						baseRef: task.baseRef,
					});
					if (!started.ok || !started.summary) {
						return createRuntimeToolError("start_task", started.error ?? "Could not start task session.");
					}
				}

				if (moved.moved) {
					await runtimeClient.workspace.saveState.mutate({
						board: moved.board,
						sessions: runtimeState.sessions,
						expectedRevision: runtimeState.revision,
					});
				}

				if (!moved.moved) {
					return createJsonToolResult({
						ok: true,
						message: `Task "${taskId}" is already in progress.`,
						task: {
							id: task.id,
							prompt: task.prompt,
							column: "in_progress",
							workspacePath: workspaceRepoPath,
						},
					});
				}

				return createJsonToolResult({
					ok: true,
					task: {
						id: task.id,
						prompt: task.prompt,
						column: "in_progress",
						workspacePath: workspaceRepoPath,
					},
				});
			} catch (error) {
				return createRuntimeToolError("start_task", toErrorMessage(error));
			}
		},
	);

	return server;
}

export async function runKanbanMcpServer(cwd: string): Promise<void> {
	const server = createMcpServer(cwd);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	process.stderr.write("Kanban MCP server running on stdio\n");
}
