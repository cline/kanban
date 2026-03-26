import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { join } from "node:path";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { handleClineMcpOauthCallback } from "../cline-sdk/cline-mcp-runtime-service.js";
import {
	type ClineTaskSessionService,
	createInMemoryClineTaskSessionService,
} from "../cline-sdk/cline-task-session-service.js";
import type { RuntimeConfigState } from "../config/runtime-config.js";
import type {
	RuntimeAgentId,
	RuntimeBoardData,
	RuntimeBoardColumnId,
	RuntimeCommandRunResponse,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "../core/api-contract.js";
import { moveTaskToColumn } from "../core/task-board-mutations.js";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
} from "../core/runtime-endpoint.js";
import { loadWorkspaceContextById, loadWorkspaceState, mutateWorkspaceState } from "../state/workspace-state.js";
import type { TerminalSessionManager } from "../terminal/session-manager.js";
import { resolveAgentCommand, resolveAgentCommandForAgentId } from "../terminal/agent-registry.js";
import { createTerminalWebSocketBridge } from "../terminal/ws-server.js";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router.js";
import { createHooksApi } from "../trpc/hooks-api.js";
import { createProjectsApi } from "../trpc/projects-api.js";
import { createRuntimeApi } from "../trpc/runtime-api.js";
import { createWorkspaceApi } from "../trpc/workspace-api.js";
import {
	buildCodeReviewPrompt,
	createAgentReviewCoordinator,
	ensureCodeReviewDocument,
	readCodeReviewDocument,
	resolveAgentReviewGitRange,
	type AgentReviewRunnerResult,
	type AgentReviewState,
} from "../review/index.js";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets.js";
import type { RuntimeStateHub } from "./runtime-state-hub.js";
import type { WorkspaceRegistry } from "./workspace-registry.js";
import { getWorkspaceChanges } from "../workspace/get-workspace-changes.js";
import { resolveTaskCwd } from "../workspace/task-worktree.js";
import { stripAnsi } from "../terminal/output-utils.js";

interface DisposeTrackedWorkspaceResult {
	terminalManager: TerminalSessionManager | null;
	workspacePath: string | null;
}

export interface CreateRuntimeServerDependencies {
	workspaceRegistry: WorkspaceRegistry;
	runtimeStateHub: RuntimeStateHub;
	warn: (message: string) => void;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	resolveInteractiveShellCommand: () => { binary: string; args: string[] };
	runCommand: (command: string, cwd: string) => Promise<RuntimeCommandRunResponse>;
	resolveProjectInputPath: (inputPath: string, basePath: string) => string;
	assertPathIsDirectory: (targetPath: string) => Promise<void>;
	hasGitRepository: (path: string) => boolean;
	disposeWorkspace: (
		workspaceId: string,
		options?: {
			stopTerminalSessions?: boolean;
		},
	) => DisposeTrackedWorkspaceResult;
	collectProjectWorktreeTaskIdsForRemoval: (board: RuntimeWorkspaceStateResponse["board"]) => Set<string>;
	pickDirectoryPathFromSystemDialog: () => string | null;
}

export interface RuntimeServer {
	url: string;
	close: () => Promise<void>;
}

function readWorkspaceIdFromRequest(request: IncomingMessage, requestUrl: URL): string | null {
	const headerValue = request.headers["x-kanban-workspace-id"];
	const headerWorkspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof headerWorkspaceId === "string") {
		const normalized = headerWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	const queryWorkspaceId = requestUrl.searchParams.get("workspaceId");
	if (typeof queryWorkspaceId === "string") {
		const normalized = queryWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

function findBoardCard(
	board: RuntimeBoardData,
	taskId: string,
): { columnId: RuntimeBoardColumnId; card: RuntimeBoardData["columns"][number]["cards"][number] } | null {
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

function selectPreferredTaskSummary(input: {
	persisted: RuntimeTaskSessionSummary | null;
	terminal: RuntimeTaskSessionSummary | null;
	cline: RuntimeTaskSessionSummary | null;
}): RuntimeTaskSessionSummary | null {
	const candidates = [input.cline, input.terminal, input.persisted].filter(
		(summary): summary is RuntimeTaskSessionSummary => summary !== null,
	);
	if (candidates.length === 0) {
		return null;
	}
	return candidates.sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
}

const REVIEWER_TASK_SESSION_PREFIX = "__agent_reviewer__:";

function buildAgentReviewTaskSessionId(taskId: string, runId: string): string {
	return `${REVIEWER_TASK_SESSION_PREFIX}${taskId}:${runId}`;
}

async function waitForAgentReviewRoundDocument(
	workspacePath: string,
	roundNumber: number,
): Promise<{
	document: NonNullable<Awaited<ReturnType<typeof readCodeReviewDocument>>>;
	latestRound: NonNullable<Awaited<ReturnType<typeof readCodeReviewDocument>>>["rounds"][number];
}> {
	for (let attempt = 0; attempt < 40; attempt += 1) {
		const document = await readCodeReviewDocument(workspacePath);
		const latestRound = document?.rounds.find((round) => round.round === roundNumber) ?? document?.rounds.at(-1) ?? null;
		if (document && latestRound) {
			return {
				document,
				latestRound,
			};
		}
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
	}

	throw new Error(`Reviewer did not produce a parseable CODE_REVIEW.md entry for round ${roundNumber}.`);
}

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	const webUiDir = getWebUiDir();

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		throw new Error("Could not find web UI assets. Run `npm run build` to generate and package the web UI.");
	}

	const resolveWorkspaceScopeFromRequest = async (
		request: IncomingMessage,
		requestUrl: URL,
	): Promise<{
		requestedWorkspaceId: string | null;
		workspaceScope: RuntimeTrpcWorkspaceScope | null;
	}> => {
		const requestedWorkspaceId = readWorkspaceIdFromRequest(request, requestUrl);
		if (!requestedWorkspaceId) {
			return {
				requestedWorkspaceId: null,
				workspaceScope: null,
			};
		}
		const requestedWorkspaceContext = await loadWorkspaceContextById(requestedWorkspaceId);
		if (!requestedWorkspaceContext) {
			return {
				requestedWorkspaceId,
				workspaceScope: null,
			};
		}
		return {
			requestedWorkspaceId,
			workspaceScope: {
				workspaceId: requestedWorkspaceContext.workspaceId,
				workspacePath: requestedWorkspaceContext.repoPath,
			},
		};
	};

	const getScopedTerminalManager = async (scope: RuntimeTrpcWorkspaceScope): Promise<TerminalSessionManager> =>
		await deps.ensureTerminalManagerForWorkspace(scope.workspaceId, scope.workspacePath);
	const clineTaskSessionServiceByWorkspaceId = new Map<string, ClineTaskSessionService>();
	const getScopedClineTaskSessionService = async (
		scope: RuntimeTrpcWorkspaceScope,
	): Promise<ClineTaskSessionService> => {
		let service = clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryClineTaskSessionService();
			clineTaskSessionServiceByWorkspaceId.set(scope.workspaceId, service);
			deps.runtimeStateHub.trackClineTaskSessionService(scope.workspaceId, scope.workspacePath, service);
		}
		return service;
	};
	const disposeClineTaskSessionServiceAsync = async (workspaceId: string): Promise<void> => {
		const service = clineTaskSessionServiceByWorkspaceId.get(workspaceId);
		if (!service) {
			return;
		}
		clineTaskSessionServiceByWorkspaceId.delete(workspaceId);
		await service.dispose();
	};
	const disposeClineTaskSessionService = (workspaceId: string): void => {
		void disposeClineTaskSessionServiceAsync(workspaceId);
	};
	const persistAgentReviewState = async (input: {
		workspaceId: string;
		taskId: string;
		state: AgentReviewState;
	}): Promise<void> => {
		const workspacePath = deps.workspaceRegistry.getWorkspacePathById(input.workspaceId);
		if (!workspacePath) {
			throw new Error(`Workspace "${input.workspaceId}" is not available.`);
		}
		await mutateWorkspaceState(workspacePath, (currentState) => {
			const nextColumns = currentState.board.columns.map((column) => ({
				...column,
				cards: column.cards.map((card) =>
					card.id === input.taskId ? { ...card, agentReview: { ...input.state } } : card,
				),
			}));
			return {
				board: {
					...currentState.board,
					columns: nextColumns,
				},
				value: null,
			};
		});
		void deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated(input.workspaceId, workspacePath);
		void deps.runtimeStateHub.broadcastRuntimeProjectsUpdated(input.workspaceId);
	};
	const ensureTaskMovedToReviewForAgentReview = async (input: {
		workspaceId: string;
		workspacePath: string;
		taskId: string;
	}): Promise<void> => {
		await mutateWorkspaceState(input.workspacePath, (currentState) => {
			const moved = moveTaskToColumn(currentState.board, input.taskId, "review");
			return {
				board: moved.board,
				value: null,
				save: moved.moved,
			};
		});
		void deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated(input.workspaceId, input.workspacePath);
		void deps.runtimeStateHub.broadcastRuntimeProjectsUpdated(input.workspaceId);
	};
	const sendAgentReviewFollowUp = async (input: {
		workspaceId: string;
		taskId: string;
		text: string;
	}): Promise<{ ok: boolean; message?: string }> => {
		const workspacePath = deps.workspaceRegistry.getWorkspacePathById(input.workspaceId);
		if (!workspacePath) {
			return { ok: false, message: `Workspace "${input.workspaceId}" is not available.` };
		}
		const scope = {
			workspaceId: input.workspaceId,
			workspacePath,
		} satisfies RuntimeTrpcWorkspaceScope;
		const payloadText = `${input.text}\n`;
		const clineTaskSessionService = await getScopedClineTaskSessionService(scope);
		const clineSummary = await clineTaskSessionService.sendTaskSessionInput(input.taskId, payloadText);
		if (clineSummary) {
			return { ok: true };
		}
		const terminalManager = await getScopedTerminalManager(scope);
		const summary = terminalManager.writeInput(input.taskId, Buffer.from(payloadText, "utf8"));
		if (!summary) {
			return {
				ok: false,
				message: "Task session is not running.",
			};
		}
		return { ok: true };
	};
	const refreshAgentReviewSnapshot = async (input: {
		workspaceId: string;
		taskId: string;
	}): Promise<{ currentColumnId: RuntimeBoardColumnId; policy: RuntimeConfigState["agentReviewPolicy"] } | null> => {
		const workspacePath = deps.workspaceRegistry.getWorkspacePathById(input.workspaceId);
		if (!workspacePath) {
			return null;
		}
		const state = await loadWorkspaceState(workspacePath);
		const taskRecord = findBoardCard(state.board, input.taskId);
		if (!taskRecord) {
			return null;
		}
		const policy = (await deps.workspaceRegistry.loadScopedRuntimeConfig({
			workspaceId: input.workspaceId,
			workspacePath,
		})).agentReviewPolicy;
		return {
			currentColumnId: taskRecord.columnId,
			policy,
		};
	};
	const runManagedAgentReviewRound = async (input: {
		workspaceId: string;
		taskId: string;
		runId: string;
		round: number;
		workspacePath: string;
		baseRef: string;
		reviewer: {
			agentId: RuntimeAgentId;
			binary: string;
			args: string[];
			autonomousModeEnabled?: boolean;
		};
		whatWasImplemented: string;
		requirementsReference: string;
	}): Promise<AgentReviewRunnerResult> => {
		const gitRange = await resolveAgentReviewGitRange(input.workspacePath, input.baseRef);
		const reportPath = await ensureCodeReviewDocument(input.workspacePath, input.taskId, input.runId);
		const reviewerTaskId = buildAgentReviewTaskSessionId(input.taskId, input.runId);
		const prompt = buildCodeReviewPrompt({
			taskId: input.taskId,
			round: input.round,
			reportPath,
			workspacePath: input.workspacePath,
			reviewerAgentId: input.reviewer.agentId,
			baseSha: gitRange.baseSha,
			headSha: gitRange.headSha,
			whatWasImplemented: input.whatWasImplemented,
			requirementsReference: input.requirementsReference,
		});
		const scope = {
			workspaceId: input.workspaceId,
			workspacePath: input.workspacePath,
		} satisfies RuntimeTrpcWorkspaceScope;
		const terminalManager = await getScopedTerminalManager(scope);
		const outputChunks: Buffer[] = [];
		let latestSummary = terminalManager.getSummary(reviewerTaskId);
		let settled = false;
		let resolveCompletion!: () => void;
		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});
		const detach = terminalManager.attach(reviewerTaskId, {
			onOutput: (chunk) => {
				outputChunks.push(chunk);
			},
			onState: (summary) => {
				latestSummary = summary;
				if (!settled && summary.state !== "running") {
					settled = true;
					resolveCompletion();
				}
			},
		});

		try {
			const startedSummary = await terminalManager.startTaskSession({
				taskId: reviewerTaskId,
				agentId: input.reviewer.agentId,
				binary: input.reviewer.binary,
				args: input.reviewer.args,
				autonomousModeEnabled: input.reviewer.autonomousModeEnabled,
				cwd: input.workspacePath,
				prompt,
				workspaceId: input.workspaceId,
				autoRestartEnabled: false,
			});
			latestSummary = startedSummary;
			if (!settled && startedSummary.state !== "running") {
				settled = true;
				resolveCompletion();
			}
			await completionPromise;
		} catch (error) {
			if (!settled) {
				settled = true;
			}
			throw error;
		} finally {
			detach?.();
		}

		const { document, latestRound } = await waitForAgentReviewRoundDocument(input.workspacePath, input.round);
		return {
			reportPath,
			baseSha: gitRange.baseSha,
			headSha: gitRange.headSha,
			reviewedRef: latestRound.reviewedRef,
			output: stripAnsi(Buffer.concat(outputChunks).toString("utf8")),
			exitCode: latestSummary?.exitCode ?? 0,
			document,
			latestRound,
		};
	};
	const resolveAgentReviewTaskSnapshot = async (input: {
		workspaceId: string;
		workspacePath: string;
		taskId: string;
	}) => {
		const scope = {
			workspaceId: input.workspaceId,
			workspacePath: input.workspacePath,
		} satisfies RuntimeTrpcWorkspaceScope;
		const runtimeConfig = await deps.workspaceRegistry.loadScopedRuntimeConfig(scope);
		const state = await loadWorkspaceState(input.workspacePath);
		const taskRecord = findBoardCard(state.board, input.taskId);
		if (!taskRecord) {
			return null;
		}
		const terminalManager = await getScopedTerminalManager(scope);
		const clineTaskSessionService = await getScopedClineTaskSessionService(scope);
		const summary = selectPreferredTaskSummary({
			persisted: state.sessions[input.taskId] ?? null,
			terminal: terminalManager.getSummary(input.taskId),
			cline: clineTaskSessionService.getSummary(input.taskId),
		});
		const taskWorkspacePath = await resolveTaskCwd({
			cwd: input.workspacePath,
			taskId: input.taskId,
			baseRef: taskRecord.card.baseRef,
			ensure: false,
		}).catch(() => null);
		const workspaceChanges =
			taskWorkspacePath !== null
				? await getWorkspaceChanges(taskWorkspacePath).catch(() => null)
				: null;
		const hasReviewableChanges = workspaceChanges !== null && workspaceChanges.files.length > 0;
		const existingState = taskRecord.card.agentReview ?? null;
		const originalAgentId =
			hasReviewableChanges && summary?.agentId
				? summary.agentId
				: (existingState?.originalAgentId ?? null);

		return {
			workspaceId: input.workspaceId,
			workspacePath: taskWorkspacePath ?? input.workspacePath,
			taskId: input.taskId,
			taskPrompt: taskRecord.card.prompt,
			baseRef: taskRecord.card.baseRef,
			currentColumnId: taskRecord.columnId,
			originalAgentId: hasReviewableChanges ? originalAgentId : null,
			existingState,
			policy: runtimeConfig.agentReviewPolicy,
			requirementsReference: `Task prompt:\n${taskRecord.card.prompt}`,
		};
	};
	const baseAgentReviewCoordinator = createAgentReviewCoordinator({
		resolveLaunchCommand: async (input) => {
			if (input.preferredAgentId) {
				const preferred = resolveAgentCommandForAgentId(input.preferredAgentId);
				if (preferred) {
					return preferred;
				}
			}
			const workspacePath = deps.workspaceRegistry.getWorkspacePathById(input.workspaceId);
			if (!workspacePath) {
				return null;
			}
			const runtimeConfig = await deps.workspaceRegistry.loadScopedRuntimeConfig({
				workspaceId: input.workspaceId,
				workspacePath,
			});
			return resolveAgentCommand(runtimeConfig);
		},
		persistState: persistAgentReviewState,
		sendFollowUpToOriginalAgent: sendAgentReviewFollowUp,
		refreshSnapshotAfterRound: refreshAgentReviewSnapshot,
		runReviewRound: async (input) =>
			await runManagedAgentReviewRound({
				workspaceId: input.workspaceId,
				taskId: input.taskId,
				runId: input.runId,
				round: input.round,
				workspacePath: input.workspacePath,
				baseRef: input.baseRef,
				reviewer: input.reviewer,
				whatWasImplemented: input.whatWasImplemented,
				requirementsReference: input.requirementsReference,
			}),
	});
	const agentReviewCoordinator = {
		async triggerTaskReview(input: {
			workspaceId: string;
			workspacePath: string;
			taskId: string;
			triggerSource: "automatic" | "manual";
		}) {
			let snapshot = await resolveAgentReviewTaskSnapshot(input);
			if (!snapshot) {
				return {
					ok: false,
					taskId: input.taskId,
					state: null,
					error: `Task "${input.taskId}" was not found.`,
				};
			}
			if (input.triggerSource === "automatic") {
				if (snapshot.policy.enabled !== true) {
					return {
						ok: true,
						taskId: input.taskId,
						state: snapshot.existingState,
					};
				}
				if (snapshot.currentColumnId !== "review") {
					await ensureTaskMovedToReviewForAgentReview(input);
					const refreshedSnapshot = await resolveAgentReviewTaskSnapshot(input);
					if (!refreshedSnapshot) {
						return {
							ok: false,
							taskId: input.taskId,
							state: null,
							error: `Task "${input.taskId}" was not found after moving to Review.`,
						};
					}
					snapshot = refreshedSnapshot;
				}
			} else if (snapshot.currentColumnId !== "review") {
				return {
					ok: false,
					taskId: input.taskId,
					state: snapshot.existingState,
					error: "Agent review can only be triggered for tasks in Review.",
				};
			}
			const result = await baseAgentReviewCoordinator.executeRound(snapshot, input.triggerSource);
			return {
				ok: result.ok,
				taskId: input.taskId,
				state: result.state,
				...(result.error ? { error: result.error } : {}),
			};
		},
		async reconcilePolicyUpdate(): Promise<void> {
			// The coordinator re-reads policy after each completed round, so no eager action is required here.
		},
	};
	deps.runtimeStateHub.setTaskReadyHandler((input) => {
		const workspacePath = deps.workspaceRegistry.getWorkspacePathById(input.workspaceId);
		if (!workspacePath) {
			return;
		}
		void agentReviewCoordinator.triggerTaskReview({
			workspaceId: input.workspaceId,
			workspacePath,
			taskId: input.taskId,
			triggerSource: "automatic",
		});
	});
	const prepareForStateReset = async (): Promise<void> => {
		const workspaceIds = new Set<string>();
		for (const { workspaceId } of deps.workspaceRegistry.listManagedWorkspaces()) {
			workspaceIds.add(workspaceId);
		}
		for (const workspaceId of clineTaskSessionServiceByWorkspaceId.keys()) {
			workspaceIds.add(workspaceId);
		}
		const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
		if (activeWorkspaceId) {
			workspaceIds.add(activeWorkspaceId);
		}
		for (const workspaceId of workspaceIds) {
			await disposeClineTaskSessionServiceAsync(workspaceId);
			deps.disposeWorkspace(workspaceId, {
				stopTerminalSessions: true,
			});
		}
		deps.workspaceRegistry.clearActiveWorkspace();
	};

	const createTrpcContext = async (req: IncomingMessage): Promise<RuntimeTrpcContext> => {
		const requestUrl = new URL(req.url ?? "/", "http://localhost");
		const scope = await resolveWorkspaceScopeFromRequest(req, requestUrl);
		return {
			requestedWorkspaceId: scope.requestedWorkspaceId,
			workspaceScope: scope.workspaceScope,
			runtimeApi: createRuntimeApi({
				getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
				getActiveRuntimeConfig: deps.workspaceRegistry.getActiveRuntimeConfig,
				loadScopedRuntimeConfig: deps.workspaceRegistry.loadScopedRuntimeConfig,
				setActiveRuntimeConfig: deps.workspaceRegistry.setActiveRuntimeConfig,
				getScopedTerminalManager,
				getScopedClineTaskSessionService,
				resolveInteractiveShellCommand: deps.resolveInteractiveShellCommand,
				runCommand: deps.runCommand,
				agentReviewCoordinator,
				broadcastClineMcpAuthStatusesUpdated: deps.runtimeStateHub.broadcastClineMcpAuthStatusesUpdated,
				bumpClineSessionContextVersion: deps.runtimeStateHub.bumpClineSessionContextVersion,
				prepareForStateReset,
			}),
			workspaceApi: createWorkspaceApi({
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				getScopedClineTaskSessionService,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastRuntimeProjectsUpdated: deps.runtimeStateHub.broadcastRuntimeProjectsUpdated,
				buildWorkspaceStateSnapshot: deps.workspaceRegistry.buildWorkspaceStateSnapshot,
			}),
			projectsApi: createProjectsApi({
				getActiveWorkspacePath: deps.workspaceRegistry.getActiveWorkspacePath,
				getActiveWorkspaceId: deps.workspaceRegistry.getActiveWorkspaceId,
				rememberWorkspace: deps.workspaceRegistry.rememberWorkspace,
				setActiveWorkspace: deps.workspaceRegistry.setActiveWorkspace,
				clearActiveWorkspace: deps.workspaceRegistry.clearActiveWorkspace,
				resolveProjectInputPath: deps.resolveProjectInputPath,
				assertPathIsDirectory: deps.assertPathIsDirectory,
				hasGitRepository: deps.hasGitRepository,
				summarizeProjectTaskCounts: deps.workspaceRegistry.summarizeProjectTaskCounts,
				createProjectSummary: deps.workspaceRegistry.createProjectSummary,
				broadcastRuntimeProjectsUpdated: deps.runtimeStateHub.broadcastRuntimeProjectsUpdated,
				getTerminalManagerForWorkspace: deps.workspaceRegistry.getTerminalManagerForWorkspace,
				disposeWorkspace: (workspaceId, options) => {
					disposeClineTaskSessionService(workspaceId);
					return deps.disposeWorkspace(workspaceId, options);
				},
				collectProjectWorktreeTaskIdsForRemoval: deps.collectProjectWorktreeTaskIdsForRemoval,
				warn: deps.warn,
				buildProjectsPayload: deps.workspaceRegistry.buildProjectsPayload,
				pickDirectoryPathFromSystemDialog: deps.pickDirectoryPathFromSystemDialog,
			}),
			hooksApi: createHooksApi({
				getWorkspacePathById: deps.workspaceRegistry.getWorkspacePathById,
				ensureTerminalManagerForWorkspace: deps.ensureTerminalManagerForWorkspace,
				broadcastRuntimeWorkspaceStateUpdated: deps.runtimeStateHub.broadcastRuntimeWorkspaceStateUpdated,
				broadcastTaskReadyForReview: deps.runtimeStateHub.broadcastTaskReadyForReview,
			}),
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

	const server = createServer(async (req, res) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);
			const oauthCallbackResponse = await handleClineMcpOauthCallback(requestUrl);
			if (oauthCallbackResponse) {
				res.writeHead(oauthCallbackResponse.statusCode, {
					"Content-Type": "text/html; charset=utf-8",
					"Cache-Control": "no-store",
				});
				res.end(oauthCallbackResponse.body);
				return;
			}
			if (pathname.startsWith("/api/trpc")) {
				await trpcHttpHandler(req, res);
				return;
			}
			if (pathname.startsWith("/api/")) {
				res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
				res.end('{"error":"Not found"}');
				return;
			}

			const asset = await readAsset(webUiDir, pathname);
			res.writeHead(200, {
				"Content-Type": asset.contentType,
				"Cache-Control": "no-store",
			});
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not Found");
		}
	});
	server.on("upgrade", (request, socket, head) => {
		let requestUrl: URL;
		try {
			requestUrl = new URL(request.url ?? "/", getKanbanRuntimeOrigin());
		} catch {
			socket.destroy();
			return;
		}
		if (normalizeRequestPath(requestUrl.pathname) !== "/api/runtime/ws") {
			return;
		}
		(request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled = true;
		const requestedWorkspaceId = requestUrl.searchParams.get("workspaceId")?.trim() || null;
		deps.runtimeStateHub.handleUpgrade(request, socket, head, { requestedWorkspaceId });
	});
	const terminalWebSocketBridge = createTerminalWebSocketBridge({
		server,
		resolveTerminalManager: (workspaceId) => deps.workspaceRegistry.getTerminalManagerForWorkspace(workspaceId),
		isTerminalIoWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/io",
		isTerminalControlWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/control",
	});
	server.on("upgrade", (request, socket) => {
		const handled = (request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled;
		if (handled) {
			return;
		}
		socket.destroy();
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(getKanbanRuntimePort(), getKanbanRuntimeHost(), () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to start local server.");
	}
	const activeWorkspaceId = deps.workspaceRegistry.getActiveWorkspaceId();
	const url = activeWorkspaceId
		? buildKanbanRuntimeUrl(`/${encodeURIComponent(activeWorkspaceId)}`)
		: getKanbanRuntimeOrigin();

	return {
		url,
		close: async () => {
			await Promise.all(
				Array.from(clineTaskSessionServiceByWorkspaceId.values()).map(async (service) => {
					await service.dispose();
				}),
			);
			clineTaskSessionServiceByWorkspaceId.clear();
			await deps.runtimeStateHub.close();
			await terminalWebSocketBridge.close();
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			});
		},
	};
}
