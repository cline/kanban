import { homedir } from "node:os";
import { resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import { z } from "zod";

import type { RuntimeWorkspaceStateResponse } from "../api-contract.js";
import { buildKanbananaRuntimeUrl, KANBANANA_RUNTIME_ORIGIN } from "../runtime-endpoint.js";
import { loadWorkspaceContext } from "../state/workspace-state.js";
import type { RuntimeAppRouter } from "../trpc/app-router.js";
import { addTaskToColumn, getTaskColumnId, moveTaskToColumn } from "./task-state.js";

interface RuntimeWorkspaceMutationResult<T> {
	board: RuntimeWorkspaceStateResponse["board"];
	value: T;
}

const LIST_TASK_COLUMNS = ["backlog", "in_progress", "review"] as const;
const KANBANANA_MCP_INSTRUCTIONS =
	"Kanbanana is a web-based multi-agent orchestration GUI that launches after running kanbanana or npx kanbanana in the terminal. It manages git worktrees automatically so that each task can run a dedicated CLI agent in its own worktree. If the user asks to add tasks to kb, ask kb, kanbanana, says go bananas, says banana mode, says bannana mode, or says add tasks without other context, they likely want to add tasks in Kanbanana.";

function resolveProjectInputPath(inputPath: string, cwd: string): string {
	if (inputPath === "~") {
		return homedir();
	}
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return resolve(homedir(), inputPath.slice(2));
	}
	return resolve(cwd, inputPath);
}

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
	return buildKanbananaRuntimeUrl("/api/trpc");
}

function createRuntimeTrpcClient(workspaceId: string | null) {
	return createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: getRuntimeApiUrl(),
				headers: () => (workspaceId ? { "x-kanbanana-workspace-id": workspaceId } : {}),
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

async function ensureRuntimeWorkspace(workspaceRepoPath: string): Promise<string> {
	const runtimeClient = createRuntimeTrpcClient(null);
	const added = await runtimeClient.projects.add.mutate({
		path: workspaceRepoPath,
	});
	if (!added.ok || !added.project) {
		throw new Error(added.error ?? `Could not register project ${workspaceRepoPath} in Kanbanana runtime.`);
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
			name: "kanbanana",
			version: "0.1.0",
		},
		{
			instructions: KANBANANA_MCP_INSTRUCTIONS,
		},
	);

	server.registerTool(
		"list_tasks",
		{
			title: "List tasks",
			description: "List Kanbanana tasks for a workspace, optionally filtered by column.",
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
					return boardColumn.cards.map((task) => {
						const session = state.sessions[task.id] ?? null;
						return {
							id: task.id,
							prompt: task.prompt,
							column: boardColumn.id,
							baseRef: task.baseRef,
							startInPlanMode: task.startInPlanMode,
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
					});
				});

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: true,
									workspacePath: workspace.repoPath,
									column: column ?? null,
									tasks,
									count: tasks.length,
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				const runtimeUrl = KANBANANA_RUNTIME_ORIGIN;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: false,
									error: `Could not list tasks via Kanbanana runtime at ${runtimeUrl} (${toErrorMessage(error)}). Make sure Kanbanana is running before trying to list tasks.`,
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		"create_task",
		{
			title: "Create task",
			description: "Create a new Kanbanana task in backlog for the current repository workspace.",
			inputSchema: {
				prompt: z.string().min(1).describe("Task prompt text."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanbanana, it is auto-added if the project uses git.",
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
			},
		},
		async ({ prompt, projectPath, baseRef, startInPlanMode }) => {
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
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: true,
									task: {
										id: created.id,
										column: "backlog",
										workspacePath: workspaceRepoPath,
										prompt: created.prompt,
										baseRef: created.baseRef,
										startInPlanMode: created.startInPlanMode,
									},
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				const runtimeUrl = KANBANANA_RUNTIME_ORIGIN;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: false,
									error: `Could not create task via Kanbanana runtime at ${runtimeUrl} (${toErrorMessage(error)}). Make sure Kanbanana is running before trying to create a task.`,
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	server.registerTool(
		"start_task",
		{
			title: "Start task",
			description:
				"Start a Kanbanana task by ensuring its worktree, starting its agent session, and moving it to in_progress.",
			inputSchema: {
				taskId: z.string().min(1).describe("Task ID to start."),
				projectPath: z
					.string()
					.optional()
					.describe(
						"Optional workspace path. If not already registered in Kanbanana, it is auto-added if the project uses git.",
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
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{ ok: false, error: `Task "${taskId}" was not found in workspace ${workspaceRepoPath}.` },
									null,
									2,
								),
							},
						],
						isError: true,
					};
				}

				if (fromColumnId !== "backlog" && fromColumnId !== "in_progress") {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: false,
										error: `Task "${taskId}" is in "${fromColumnId}" and can only be started from backlog.`,
									},
									null,
									2,
								),
							},
						],
						isError: true,
					};
				}

				const moved = moveTaskToColumn(runtimeState.board, taskId, "in_progress");
				const task = moved.task;

				if (!task) {
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify({ ok: false, error: `Task "${taskId}" could not be resolved.` }, null, 2),
							},
						],
						isError: true,
					};
				}

				const existingSession = runtimeState.sessions[task.id] ?? null;
				const shouldStartSession = !existingSession || existingSession.state !== "running";

				if (shouldStartSession) {
					const ensured = await runtimeClient.workspace.ensureWorktree.mutate({
						taskId: task.id,
						baseRef: task.baseRef,
					});
					if (!ensured.ok) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: false,
											error: ensured.error ?? "Could not ensure task worktree.",
										},
										null,
										2,
									),
								},
							],
							isError: true,
						};
					}

					const started = await runtimeClient.runtime.startTaskSession.mutate({
						taskId: task.id,
						prompt: task.prompt,
						startInPlanMode: task.startInPlanMode,
						baseRef: task.baseRef,
					});
					if (!started.ok || !started.summary) {
						return {
							content: [
								{
									type: "text",
									text: JSON.stringify(
										{
											ok: false,
											error: started.error ?? "Could not start task session.",
										},
										null,
										2,
									),
								},
							],
							isError: true,
						};
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
					return {
						content: [
							{
								type: "text",
								text: JSON.stringify(
									{
										ok: true,
										message: `Task "${taskId}" is already in progress.`,
										task: {
											id: task.id,
											prompt: task.prompt,
											column: "in_progress",
											workspacePath: workspaceRepoPath,
										},
									},
									null,
									2,
								),
							},
						],
					};
				}

				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: true,
									task: {
										id: task.id,
										prompt: task.prompt,
										column: "in_progress",
										workspacePath: workspaceRepoPath,
									},
								},
								null,
								2,
							),
						},
					],
				};
			} catch (error) {
				const runtimeUrl = KANBANANA_RUNTIME_ORIGIN;
				return {
					content: [
						{
							type: "text",
							text: JSON.stringify(
								{
									ok: false,
									error: `Could not start task via Kanbanana runtime at ${runtimeUrl} (${toErrorMessage(error)}). Make sure Kanbanana is running before trying to start a task.`,
								},
								null,
								2,
							),
						},
					],
					isError: true,
				};
			}
		},
	);

	return server;
}

export async function runKanbananaMcpServer(cwd: string): Promise<void> {
	const server = createMcpServer(cwd);
	const transport = new StdioServerTransport();
	await server.connect(transport);
	process.stderr.write("Kanbanana MCP server running on stdio\n");
}
