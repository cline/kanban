import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { join } from "node:path";
import type { Duplex } from "node:stream";

import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { handleClineMcpOauthCallback } from "../cline-sdk/cline-mcp-runtime-service";
import {
	type ClineTaskSessionService,
	createInMemoryClineTaskSessionService,
} from "../cline-sdk/cline-task-session-service";
import { createClineWatcherRegistry } from "../cline-sdk/cline-watcher-registry";
import { getSdkProviderSettings } from "../cline-sdk/sdk-provider-boundary";
import type { RuntimeCommandRunResponse, RuntimeWorkspaceStateResponse } from "../core/api-contract";
import {
	buildKanbanRuntimeUrl,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getKanbanRuntimeTls,
} from "../core/runtime-endpoint";
import type { CallerIdentity } from "../remote/types";
import { loadWorkspaceContextById } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import { createTerminalWebSocketBridge } from "../terminal/ws-server";
import { type RuntimeTrpcContext, type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "../trpc/app-router";
import { createHooksApi } from "../trpc/hooks-api";
import { createProjectsApi } from "../trpc/projects-api";
import { createRuntimeApi } from "../trpc/runtime-api";
import { createWorkspaceApi } from "../trpc/workspace-api";
import { getWebUiDir, normalizeRequestPath, readAsset } from "./assets";
import { createLoginHandler } from "./login-handler";
import { createRemoteAuth, isLocalRequest } from "./remote-auth";
import type { RuntimeStateHub } from "./runtime-state-hub";
import type { WorkspaceRegistry } from "./workspace-registry";

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

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(json);
}

export async function createRuntimeServer(deps: CreateRuntimeServerDependencies): Promise<RuntimeServer> {
	const webUiDir = getWebUiDir();

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		throw new Error("Could not find web UI assets. Run `npm run build` to generate and package the web UI.");
	}

	// Initialise remote auth (opens/creates the SQLite DB, loads signing secret).
	const remoteAuth = await createRemoteAuth();
	const loginHandler = createLoginHandler({ remoteAuth });

	// Resolve the localhost user's identity from the stored Cline account credentials.
	// Awaited before the server starts so the first request always has caller context.
	// Falls back to locally-stored email/accountId if the network call fails.
	let localCaller: CallerIdentity | null = null;
	try {
		const clineSettings = getSdkProviderSettings("cline");
		const rawToken = clineSettings?.auth?.accessToken?.trim() ?? "";
		if (rawToken) {
			// Try to get full profile from the network first.
			let resolved = false;
			try {
				const prefixed = rawToken.toLowerCase().startsWith("workos:") ? rawToken : `workos:${rawToken}`;
				const res = await fetch("https://api.cline.bot/v1/users/me", {
					headers: { Authorization: `Bearer ${prefixed}` },
					signal: AbortSignal.timeout(5_000),
				});
				if (res.ok) {
					const body = (await res.json()) as { id?: string; sub?: string; email?: string; displayName?: string };
					const userId = (body.id ?? body.sub ?? "").trim();
					const email = (body.email ?? "").trim();
					if (userId && email) {
						const displayName = body.displayName?.trim() || email.split("@")[0] || email;
						const userRecord = remoteAuth.getOrCreateUserRecord(email, displayName);
						localCaller = { uuid: userRecord.uuid, email, displayName, isLocal: true };
						resolved = true;
					}
				}
			} catch {
				// Network unavailable — fall through to local fallback.
			}
			// Fallback: use locally stored accountId if network call failed.
			if (!resolved) {
				const accountId = clineSettings?.auth?.accountId?.trim() ?? "";
				if (accountId) {
					const fallbackEmail = `${accountId}@cline`;
					const displayName = accountId;
					const userRecord = remoteAuth.getOrCreateUserRecord(fallbackEmail, displayName);
					localCaller = { uuid: userRecord.uuid, email: fallbackEmail, displayName, isLocal: true };
				}
			}
		}
	} catch {
		// No Cline account on this machine — localhost requests have no identity.
	}

	// ── Push notification helpers ──────────────────────────────────────────
	// These fire-and-forget helpers send push notifications alongside the
	// existing WebSocket broadcasts. They are defined here because they need
	// access to both pushManager and workspaceRegistry.

	const pushReadyForReview = (workspaceId: string, taskId: string): void => {
		const push = remoteAuth.pushManager;
		void (async () => {
			try {
				// Find the card to determine visibility.
				const workspacePath = deps.workspaceRegistry.getWorkspacePathById(workspaceId);
				if (!workspacePath) return;
				const snapshot = await deps.workspaceRegistry.buildWorkspaceStateSnapshot(workspaceId, workspacePath);
				const card = snapshot.board.columns.flatMap((c) => c.cards).find((c) => c.id === taskId);
				const isPrivate = card?.visibility === "private";
				const ownerUuid = card?.createdBy?.uuid;

				await push.send({
					event: "ready_for_review",
					workspaceId,
					title: "Task ready for review",
					body: card?.prompt ? card.prompt.slice(0, 80) : `Task ${taskId} is awaiting review`,
					data: { taskId, url: `/${workspaceId}` },
					targetUserUuids: isPrivate && ownerUuid ? [ownerUuid] : undefined,
				});
			} catch {
				// Push failures are non-fatal.
			}
		})();
	};

	const pushAgentQuestion = (workspaceId: string, taskId: string): void => {
		const push = remoteAuth.pushManager;
		void (async () => {
			try {
				const workspacePath = deps.workspaceRegistry.getWorkspacePathById(workspaceId);
				if (!workspacePath) return;
				const snapshot = await deps.workspaceRegistry.buildWorkspaceStateSnapshot(workspaceId, workspacePath);
				const card = snapshot.board.columns.flatMap((c) => c.cards).find((c) => c.id === taskId);
				const isPrivate = card?.visibility === "private";
				const ownerUuid = card?.createdBy?.uuid;

				await push.send({
					event: "agent_question",
					workspaceId,
					title: "Agent needs your input",
					body: card?.prompt ? card.prompt.slice(0, 80) : `Task ${taskId} needs your attention`,
					data: { taskId, url: `/${workspaceId}` },
					targetUserUuids: isPrivate && ownerUuid ? [ownerUuid] : undefined,
				});
			} catch {
				// Push failures are non-fatal.
			}
		})();
	};
	// ── End push notification helpers ──────────────────────────────────────

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
	const clineWatcherRegistry = createClineWatcherRegistry();
	const getScopedClineTaskSessionService = async (
		scope: RuntimeTrpcWorkspaceScope,
	): Promise<ClineTaskSessionService> => {
		let service = clineTaskSessionServiceByWorkspaceId.get(scope.workspaceId);
		if (!service) {
			service = createInMemoryClineTaskSessionService({
				watcherRegistry: clineWatcherRegistry,
			});
			clineTaskSessionServiceByWorkspaceId.set(scope.workspaceId, service);
			deps.runtimeStateHub.trackClineTaskSessionService(scope.workspaceId, scope.workspacePath, service);

			// Parallel onSummary listener for push notifications.
			// The hub's own listener handles ready_for_review; this one handles
			// agent_question (attention) and session_started.
			const previousStateByTaskId = new Map<string, string>();
			service.onSummary((summary) => {
				const prev = previousStateByTaskId.get(summary.taskId);
				previousStateByTaskId.set(summary.taskId, summary.state);
				// Agent question: transition to awaiting_review with reason "attention".
				if (
					prev &&
					prev !== "awaiting_review" &&
					summary.state === "awaiting_review" &&
					summary.reviewReason === "attention"
				) {
					pushAgentQuestion(scope.workspaceId, summary.taskId);
				}
				// Session started: transition from idle/undefined to running.
				if ((!prev || prev === "idle" || prev === "interrupted") && summary.state === "running") {
					void remoteAuth.pushManager.send({
						event: "session_started",
						workspaceId: scope.workspaceId,
						title: "Task session started",
						body: `A task session has started`,
						data: { taskId: summary.taskId, url: `/${scope.workspaceId}` },
					});
				}
			});
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

		// Resolve caller identity: local users get the cached WorkOS profile;
		// remote users get identity from their validated session cookie.
		let caller: CallerIdentity | null = null;
		if (isLocalRequest(req)) {
			caller = localCaller;
		} else {
			const session = await remoteAuth.validateSession(req.headers.cookie ?? "");
			if (session) {
				caller = {
					uuid: session.userUuid,
					email: session.email,
					displayName: session.displayName,
					isLocal: false,
				};
			}
		}

		return {
			req,
			remoteAuth,
			pushManager: remoteAuth.pushManager,
			caller,
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
				broadcastClineMcpAuthStatusesUpdated: deps.runtimeStateHub.broadcastClineMcpAuthStatusesUpdated,
				broadcastTaskChatCleared: deps.runtimeStateHub.broadcastTaskChatCleared,
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
				broadcastTaskReadyForReview: (workspaceId, taskId) => {
					deps.runtimeStateHub.broadcastTaskReadyForReview(workspaceId, taskId);
					pushReadyForReview(workspaceId, taskId);
				},
			}),
			broadcastTeamChatMessage: deps.runtimeStateHub.broadcastTeamChatMessage,
		};
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => await createTrpcContext(req),
	});

	const tlsConfig = getKanbanRuntimeTls();
	const requestHandler = async (req: IncomingMessage, res: import("node:http").ServerResponse) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			// ── Auth gate ─────────────────────────────────────────────────────
			// Localhost connections bypass auth entirely.
			// Login/auth/logout routes are always reachable (needed to obtain a session).
			// All other remote requests require a valid session cookie.
			if (!isLocalRequest(req)) {
				const isAuthRoute =
					pathname === "/login" ||
					pathname.startsWith("/login/") ||
					pathname === "/logout" ||
					pathname === "/auth/start" ||
					pathname === "/auth/callback";

				if (isAuthRoute) {
					await loginHandler.handle(req, res);
					return;
				}

				const session = await remoteAuth.validateSession(req.headers.cookie ?? "");
				if (!session) {
					const acceptsHtml = (req.headers.accept ?? "").includes("text/html");
					if (acceptsHtml) {
						res.writeHead(302, { Location: "/login" });
						res.end();
					} else {
						jsonResponse(res, 401, { error: "Unauthorized." });
					}
					return;
				}

				// Touch the session on every authenticated request (refreshes rolling expiry).
				await remoteAuth.touchSession(session.sessionId);
			}
			// ── End auth gate ─────────────────────────────────────────────────

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
	};
	const server = tlsConfig
		? createHttpsServer({ key: tlsConfig.key, cert: tlsConfig.cert }, requestHandler)
		: createServer(requestHandler);

	server.on("upgrade", (request, socket, head) => {
		let requestUrl: URL;
		try {
			requestUrl = new URL(request.url ?? "/", getKanbanRuntimeOrigin());
		} catch {
			socket.destroy();
			return;
		}

		// Auth gate for WebSocket upgrades — same logic as HTTP requests.
		if (!isLocalRequest(request)) {
			const cookieHeader = request.headers.cookie ?? "";
			// validateSession is async; we must await before proceeding.
			// Use a void-returning IIFE to keep the synchronous upgrade handler signature.
			void (async () => {
				const session = await remoteAuth.validateSession(cookieHeader);
				if (!session) {
					socket.destroy();
					return;
				}
				await remoteAuth.touchSession(session.sessionId);
				doUpgrade(request, socket, head, requestUrl);
			})();
			return;
		}

		doUpgrade(request, socket, head, requestUrl);
	});

	function doUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, requestUrl: URL): void {
		if (normalizeRequestPath(requestUrl.pathname) !== "/api/runtime/ws") {
			return;
		}
		(request as IncomingMessage & { __kanbanUpgradeHandled?: boolean }).__kanbanUpgradeHandled = true;
		const requestedWorkspaceId = requestUrl.searchParams.get("workspaceId")?.trim() || null;
		deps.runtimeStateHub.handleUpgrade(request, socket, head, { requestedWorkspaceId });
	}

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
			await clineWatcherRegistry.close();
			await deps.runtimeStateHub.close();
			await terminalWebSocketBridge.close();
			remoteAuth.close();
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
