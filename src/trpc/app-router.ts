// Defines the typed TRPC boundary between the browser and the local runtime.
// Keep request and response contracts plus workspace-scoped procedures here,
// and delegate domain behavior to runtime-api.ts and lower-level services.

import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

import { decryptApiKey, encryptApiKey, loadRemoteConfig, saveRemoteConfig } from "../remote/config-store";
import type { CallerIdentity, RemoteConfig, RemoteUserRole } from "../remote/types";
import { callerCanSetVisibility, filterBoardForCaller } from "../server/board-visibility";
import type { PushManager } from "../server/push-manager";
import type { RemoteAuth } from "../server/remote-auth";
import { isLocalRequest } from "../server/remote-auth";
import { appendWorkspaceTeamChatMessage, readWorkspaceTeamChatMessages } from "../state/workspace-state";

// Generates a human-readable random password (adjective-noun-4digits pattern).
function generateReadablePassword(): string {
	const adjectives = [
		"amber",
		"brave",
		"calm",
		"dark",
		"eager",
		"fair",
		"gold",
		"jade",
		"kind",
		"lush",
		"mute",
		"nova",
		"opal",
		"pine",
		"quiet",
		"rose",
		"sage",
		"teal",
		"umber",
		"vivid",
	];
	const nouns = [
		"atlas",
		"birch",
		"cedar",
		"delta",
		"echo",
		"frost",
		"grove",
		"haze",
		"inlet",
		"jetty",
		"knoll",
		"ledge",
		"marsh",
		"nexus",
		"orbit",
		"prism",
		"quill",
		"ridge",
		"stone",
		"tower",
	];
	const buf = randomBytes(4);
	const adj = adjectives[buf[0]! % adjectives.length]!;
	const noun = nouns[buf[1]! % nouns.length]!;
	const digits = ((buf[2]! << 8) | buf[3]!).toString().slice(-4).padStart(4, "0");
	return `${adj}-${noun}-${digits}`;
}

import type {
	RuntimeClineAccountProfileResponse,
	RuntimeClineAddProviderRequest,
	RuntimeClineAddProviderResponse,
	RuntimeClineKanbanAccessResponse,
	RuntimeClineMcpAuthStatusResponse,
	RuntimeClineMcpOAuthRequest,
	RuntimeClineMcpOAuthResponse,
	RuntimeClineMcpSettingsResponse,
	RuntimeClineMcpSettingsSaveRequest,
	RuntimeClineMcpSettingsSaveResponse,
	RuntimeClineOauthLoginRequest,
	RuntimeClineOauthLoginResponse,
	RuntimeClineProviderCatalogResponse,
	RuntimeClineProviderModelsRequest,
	RuntimeClineProviderModelsResponse,
	RuntimeClineProviderSettingsSaveRequest,
	RuntimeClineProviderSettingsSaveResponse,
	RuntimeCommandRunRequest,
	RuntimeCommandRunResponse,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeDebugResetAllStateResponse,
	RuntimeGitCheckoutRequest,
	RuntimeGitCheckoutResponse,
	RuntimeGitCommitDiffRequest,
	RuntimeGitCommitDiffResponse,
	RuntimeGitDiscardResponse,
	RuntimeGitLogRequest,
	RuntimeGitLogResponse,
	RuntimeGitRefsResponse,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeHookIngestRequest,
	RuntimeHookIngestResponse,
	RuntimeOpenFileRequest,
	RuntimeOpenFileResponse,
	RuntimeProjectAddRequest,
	RuntimeProjectAddResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeProjectRemoveRequest,
	RuntimeProjectRemoveResponse,
	RuntimeProjectsResponse,
	RuntimeShellSessionStartRequest,
	RuntimeShellSessionStartResponse,
	RuntimeSlashCommandsResponse,
	RuntimeTaskChatAbortRequest,
	RuntimeTaskChatAbortResponse,
	RuntimeTaskChatCancelRequest,
	RuntimeTaskChatCancelResponse,
	RuntimeTaskChatMessagesRequest,
	RuntimeTaskChatMessagesResponse,
	RuntimeTaskChatReloadRequest,
	RuntimeTaskChatReloadResponse,
	RuntimeTaskChatSendRequest,
	RuntimeTaskChatSendResponse,
	RuntimeTaskSessionInputRequest,
	RuntimeTaskSessionInputResponse,
	RuntimeTaskSessionStartRequest,
	RuntimeTaskSessionStartResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceChangesResponse,
	RuntimeWorkspaceFileSearchRequest,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateNotifyResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureRequest,
	RuntimeWorktreeEnsureResponse,
} from "../core/api-contract";
import {
	type RuntimeCloneRepositoryRequest,
	type RuntimeCloneRepositoryResponse,
	type RuntimeCreateDirectoryRequest,
	type RuntimeCreateDirectoryResponse,
	type RuntimeDirectoryListRequest,
	type RuntimeDirectoryListResponse,
	runtimeClineAccountProfileResponseSchema,
	runtimeClineAddProviderRequestSchema,
	runtimeClineAddProviderResponseSchema,
	runtimeClineKanbanAccessResponseSchema,
	runtimeClineMcpAuthStatusResponseSchema,
	runtimeClineMcpOAuthRequestSchema,
	runtimeClineMcpOAuthResponseSchema,
	runtimeClineMcpSettingsResponseSchema,
	runtimeClineMcpSettingsSaveRequestSchema,
	runtimeClineMcpSettingsSaveResponseSchema,
	runtimeClineOauthLoginRequestSchema,
	runtimeClineOauthLoginResponseSchema,
	runtimeClineProviderCatalogResponseSchema,
	runtimeClineProviderModelsRequestSchema,
	runtimeClineProviderModelsResponseSchema,
	runtimeClineProviderSettingsSaveRequestSchema,
	runtimeClineProviderSettingsSaveResponseSchema,
	runtimeCloneRepositoryRequestSchema,
	runtimeCloneRepositoryResponseSchema,
	runtimeCommandRunRequestSchema,
	runtimeCommandRunResponseSchema,
	runtimeConfigResponseSchema,
	runtimeConfigSaveRequestSchema,
	runtimeCreateDirectoryRequestSchema,
	runtimeCreateDirectoryResponseSchema,
	runtimeDebugResetAllStateResponseSchema,
	runtimeDirectoryListRequestSchema,
	runtimeDirectoryListResponseSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeGitCheckoutResponseSchema,
	runtimeGitCommitDiffRequestSchema,
	runtimeGitCommitDiffResponseSchema,
	runtimeGitDiscardResponseSchema,
	runtimeGitLogRequestSchema,
	runtimeGitLogResponseSchema,
	runtimeGitRefsResponseSchema,
	runtimeGitSummaryResponseSchema,
	runtimeGitSyncActionSchema,
	runtimeGitSyncResponseSchema,
	runtimeHookIngestRequestSchema,
	runtimeHookIngestResponseSchema,
	runtimeOpenFileRequestSchema,
	runtimeOpenFileResponseSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectAddResponseSchema,
	runtimeProjectDirectoryPickerResponseSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeProjectRemoveResponseSchema,
	runtimeProjectsResponseSchema,
	runtimeProviderOverrideListResponseSchema,
	runtimeProviderOverrideOkResponseSchema,
	runtimeProviderOverrideRemoveRequestSchema,
	runtimeProviderOverrideSetEnforcedRequestSchema,
	runtimeProviderOverrideSetRequestSchema,
	runtimePushListSubscriptionsResponseSchema,
	runtimePushSendRequestSchema,
	runtimePushSendResponseSchema,
	runtimePushSubscribeRequestSchema,
	runtimePushSubscribeResponseSchema,
	runtimePushSubscriptionSchema,
	runtimePushUnsubscribeRequestSchema,
	runtimePushUnsubscribeResponseSchema,
	runtimePushUpdatePreferencesRequestSchema,
	runtimePushUpdatePreferencesResponseSchema,
	runtimePushVapidPublicKeyResponseSchema,
	runtimeRemoteDevicesListResponseSchema,
	runtimeRemoteDevicesRevokeRequestSchema,
	runtimeRemoteOkResponseSchema,
	runtimeRemotePushSubscribeResponseSchema,
	runtimeRemoteUsersBlockRequestSchema,
	runtimeRemoteUsersListResponseSchema,
	runtimeRemoteUsersSetRoleRequestSchema,
	runtimeShellSessionStartRequestSchema,
	runtimeShellSessionStartResponseSchema,
	runtimeSlashCommandsResponseSchema,
	runtimeTaskChatAbortRequestSchema,
	runtimeTaskChatAbortResponseSchema,
	runtimeTaskChatCancelRequestSchema,
	runtimeTaskChatCancelResponseSchema,
	runtimeTaskChatMessagesRequestSchema,
	runtimeTaskChatMessagesResponseSchema,
	runtimeTaskChatReloadRequestSchema,
	runtimeTaskChatReloadResponseSchema,
	runtimeTaskChatSendRequestSchema,
	runtimeTaskChatSendResponseSchema,
	runtimeTaskSessionInputRequestSchema,
	runtimeTaskSessionInputResponseSchema,
	runtimeTaskSessionStartRequestSchema,
	runtimeTaskSessionStartResponseSchema,
	runtimeTaskSessionStopRequestSchema,
	runtimeTaskSessionStopResponseSchema,
	runtimeTaskWorkspaceInfoRequestSchema,
	runtimeTaskWorkspaceInfoResponseSchema,
	runtimeTeamChatGetMessagesResponseSchema,
	runtimeTeamChatSendRequestSchema,
	runtimeTeamChatSendResponseSchema,
	runtimeTunnelStartResponseSchema,
	runtimeTunnelStatusResponseSchema,
	runtimeTunnelStopResponseSchema,
	runtimeWorkspaceChangesRequestSchema,
	runtimeWorkspaceChangesResponseSchema,
	runtimeWorkspaceFileSearchRequestSchema,
	runtimeWorkspaceFileSearchResponseSchema,
	runtimeWorkspaceStateNotifyResponseSchema,
	runtimeWorkspaceStateResponseSchema,
	runtimeWorkspaceStateSaveRequestSchema,
	runtimeWorktreeDeleteRequestSchema,
	runtimeWorktreeDeleteResponseSchema,
	runtimeWorktreeEnsureRequestSchema,
	runtimeWorktreeEnsureResponseSchema,
} from "../core/api-contract";
import { getTunnelUrl, startCloudflaredTunnel, stopCloudflaredTunnel } from "../server/cloudflare-tunnel";

export interface RuntimeTrpcWorkspaceScope {
	workspaceId: string;
	workspacePath: string;
}

export interface RuntimeTrpcContext {
	// The raw Node.js request — used by the localOnlyMiddleware to check origin.
	req: IncomingMessage;
	// Shared RemoteAuth instance — reused across all procedures, no new DB connections.
	remoteAuth: RemoteAuth;
	// VAPID push notification manager — accessed via ctx.pushManager in push procedures.
	pushManager: PushManager;
	// Resolved identity of whoever is making this request. Null if no identity
	// can be determined (e.g. localhost with no Cline account signed in).
	caller: CallerIdentity | null;
	requestedWorkspaceId: string | null;
	workspaceScope: RuntimeTrpcWorkspaceScope | null;
	runtimeApi: {
		loadConfig: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeConfigResponse>;
		saveConfig: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeConfigSaveRequest,
		) => Promise<RuntimeConfigResponse>;
		saveClineProviderSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineProviderSettingsSaveRequest,
		) => Promise<RuntimeClineProviderSettingsSaveResponse>;
		addClineProvider: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineAddProviderRequest,
		) => Promise<RuntimeClineAddProviderResponse>;
		startTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStartRequest,
			caller?: CallerIdentity | null,
		) => Promise<RuntimeTaskSessionStartResponse>;
		stopTaskSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionStopRequest,
		) => Promise<RuntimeTaskSessionStopResponse>;
		sendTaskSessionInput: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskSessionInputRequest,
		) => Promise<RuntimeTaskSessionInputResponse>;
		getTaskChatMessages: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatMessagesRequest,
		) => Promise<RuntimeTaskChatMessagesResponse>;
		getClineSlashCommands: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeSlashCommandsResponse>;
		sendTaskChatMessage: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatSendRequest,
			caller?: CallerIdentity | null,
		) => Promise<RuntimeTaskChatSendResponse>;
		reloadTaskChatSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatReloadRequest,
		) => Promise<RuntimeTaskChatReloadResponse>;
		abortTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatAbortRequest,
		) => Promise<RuntimeTaskChatAbortResponse>;
		cancelTaskChatTurn: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskChatCancelRequest,
		) => Promise<RuntimeTaskChatCancelResponse>;
		getClineProviderCatalog: (
			scope: RuntimeTrpcWorkspaceScope | null,
		) => Promise<RuntimeClineProviderCatalogResponse>;
		getClineAccountProfile: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineAccountProfileResponse>;
		getClineKanbanAccess: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineKanbanAccessResponse>;
		getClineProviderModels: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineProviderModelsRequest,
		) => Promise<RuntimeClineProviderModelsResponse>;
		runClineProviderOAuthLogin: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineOauthLoginRequest,
		) => Promise<RuntimeClineOauthLoginResponse>;
		getClineMcpAuthStatuses: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineMcpAuthStatusResponse>;
		runClineMcpServerOAuth: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineMcpOAuthRequest,
		) => Promise<RuntimeClineMcpOAuthResponse>;
		getClineMcpSettings: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeClineMcpSettingsResponse>;
		saveClineMcpSettings: (
			scope: RuntimeTrpcWorkspaceScope | null,
			input: RuntimeClineMcpSettingsSaveRequest,
		) => Promise<RuntimeClineMcpSettingsSaveResponse>;
		startShellSession: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeShellSessionStartRequest,
		) => Promise<RuntimeShellSessionStartResponse>;
		runCommand: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeCommandRunRequest,
		) => Promise<RuntimeCommandRunResponse>;
		resetAllState: (scope: RuntimeTrpcWorkspaceScope | null) => Promise<RuntimeDebugResetAllStateResponse>;
		openFile: (input: RuntimeOpenFileRequest) => Promise<RuntimeOpenFileResponse>;
	};
	workspaceApi: {
		loadGitSummary: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitSummaryResponse>;
		runGitSyncAction: (
			scope: RuntimeTrpcWorkspaceScope,
			input: { action: RuntimeGitSyncAction },
		) => Promise<RuntimeGitSyncResponse>;
		checkoutGitBranch: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCheckoutRequest,
		) => Promise<RuntimeGitCheckoutResponse>;
		discardGitChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitDiscardResponse>;
		loadChanges: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceChangesRequest,
		) => Promise<RuntimeWorkspaceChangesResponse>;
		ensureWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeEnsureRequest,
		) => Promise<RuntimeWorktreeEnsureResponse>;
		deleteWorktree: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorktreeDeleteRequest,
		) => Promise<RuntimeWorktreeDeleteResponse>;
		loadTaskContext: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest,
		) => Promise<RuntimeTaskWorkspaceInfoResponse>;
		searchFiles: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceFileSearchRequest,
		) => Promise<RuntimeWorkspaceFileSearchResponse>;
		loadState: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateResponse>;
		notifyStateUpdated: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceStateNotifyResponse>;
		saveState: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeWorkspaceStateSaveRequest,
		) => Promise<RuntimeWorkspaceStateResponse>;
		loadWorkspaceChanges: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeWorkspaceChangesResponse>;
		loadGitLog: (scope: RuntimeTrpcWorkspaceScope, input: RuntimeGitLogRequest) => Promise<RuntimeGitLogResponse>;
		loadGitRefs: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeTaskWorkspaceInfoRequest | null,
		) => Promise<RuntimeGitRefsResponse>;
		loadCommitDiff: (
			scope: RuntimeTrpcWorkspaceScope,
			input: RuntimeGitCommitDiffRequest,
		) => Promise<RuntimeGitCommitDiffResponse>;
	};
	projectsApi: {
		listProjects: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectsResponse>;
		addProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectAddRequest,
		) => Promise<RuntimeProjectAddResponse>;
		removeProject: (
			preferredWorkspaceId: string | null,
			input: RuntimeProjectRemoveRequest,
		) => Promise<RuntimeProjectRemoveResponse>;
		pickProjectDirectory: (preferredWorkspaceId: string | null) => Promise<RuntimeProjectDirectoryPickerResponse>;
		listDirectory: (input: RuntimeDirectoryListRequest) => Promise<RuntimeDirectoryListResponse>;
		createDirectory: (input: RuntimeCreateDirectoryRequest) => Promise<RuntimeCreateDirectoryResponse>;
		cloneRepository: (input: RuntimeCloneRepositoryRequest) => Promise<RuntimeCloneRepositoryResponse>;
	};
	hooksApi: {
		ingest: (input: RuntimeHookIngestRequest) => Promise<RuntimeHookIngestResponse>;
	};
	pushApi: import("../trpc/push-api").PushApi;
	// Used by team chat procedures to broadcast new messages to WebSocket clients.
	broadcastTeamChatMessage: (
		workspaceId: string,
		message: import("../core/api-contract").RuntimeTeamChatMessage,
	) => void;
}

interface RuntimeTrpcContextWithWorkspaceScope extends RuntimeTrpcContext {
	workspaceScope: RuntimeTrpcWorkspaceScope;
}

function readConflictRevision(cause: unknown): number | null {
	if (!cause || typeof cause !== "object" || !("currentRevision" in cause)) {
		return null;
	}
	const revision = (cause as { currentRevision?: unknown }).currentRevision;
	if (typeof revision !== "number") {
		return null;
	}
	return Number.isFinite(revision) ? revision : null;
}

const t = initTRPC.context<RuntimeTrpcContext>().create({
	errorFormatter({ shape, error }) {
		const conflictRevision = error.code === "CONFLICT" ? readConflictRevision(error.cause) : null;
		return {
			...shape,
			data: {
				...shape.data,
				conflictRevision,
			},
		};
	},
});

// Middleware that rejects requests from non-localhost origins.
// Used to protect configuration procedures that must only be callable locally.
const localOnlyMiddleware = t.middleware(({ ctx, next }) => {
	if (!isLocalRequest(ctx.req)) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "This operation is only available on localhost.",
		});
	}
	return next({ ctx });
});

const localOnlyProcedure = t.procedure.use(localOnlyMiddleware);

// Allows localhost OR authenticated admin-role users.
// Used for user/device management so remote admins can manage users.
const adminOrLocalProcedure = t.procedure.use(
	t.middleware(({ ctx, next }) => {
		if (isLocalRequest(ctx.req)) return next({ ctx });
		if (!ctx.caller) {
			throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in." });
		}
		if (ctx.caller.role !== "admin") {
			throw new TRPCError({ code: "FORBIDDEN", message: "This operation requires admin access." });
		}
		return next({ ctx });
	}),
);

// Blocks "viewer" role callers from performing write operations.
// Admins (localhost) and editors can pass through.
// Read-only procedures (queries) should NOT use this — viewers can still read.
const editorOrAdminMiddleware = t.middleware(({ ctx, next }) => {
	// Localhost is always admin.
	if (isLocalRequest(ctx.req)) return next({ ctx });
	// No identity = cannot mutate.
	if (!ctx.caller) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in." });
	}
	if (ctx.caller.role === "viewer") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Viewers cannot perform this action. Ask an admin to grant you editor access.",
		});
	}
	return next({ ctx });
});

const _editorProcedure = t.procedure.use(editorOrAdminMiddleware);

const workspaceProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.requestedWorkspaceId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Missing workspace scope. Include x-kanban-workspace-id header or workspaceId query parameter.",
		});
	}
	if (!ctx.workspaceScope) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Unknown workspace ID: ${ctx.requestedWorkspaceId}`,
		});
	}
	return next({
		ctx: {
			...ctx,
			workspaceScope: ctx.workspaceScope,
		} satisfies RuntimeTrpcContextWithWorkspaceScope,
	});
});

// Use assertEditorOrAdmin(ctx) at the start of any workspace mutation that viewers must not perform.
function assertEditorOrAdmin(ctx: { caller: CallerIdentity | null; req: IncomingMessage }): void {
	if (isLocalRequest(ctx.req)) return;
	if (!ctx.caller) {
		throw new TRPCError({ code: "UNAUTHORIZED", message: "You must be signed in." });
	}
	if (ctx.caller.role === "viewer") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Viewers cannot perform this action. Ask an admin to grant you editor access.",
		});
	}
}

// Alias — for procedures that don't need workspace scope (e.g. remote.push.subscribe).
const writerWorkspaceProcedure = workspaceProcedure;

const optionalTaskWorkspaceInfoRequestSchema = runtimeTaskWorkspaceInfoRequestSchema.nullable().optional();
const gitSyncActionInputSchema = z.object({
	action: runtimeGitSyncActionSchema,
});

export const runtimeAppRouter = t.router({
	runtime: t.router({
		getConfig: t.procedure.output(runtimeConfigResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.loadConfig(ctx.workspaceScope);
		}),
		saveConfig: t.procedure
			.input(runtimeConfigSaveRequestSchema)
			.output(runtimeConfigResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveConfig(ctx.workspaceScope, input);
			}),
		saveClineProviderSettings: t.procedure
			.input(runtimeClineProviderSettingsSaveRequestSchema)
			.output(runtimeClineProviderSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveClineProviderSettings(ctx.workspaceScope, input);
			}),
		addClineProvider: t.procedure
			.input(runtimeClineAddProviderRequestSchema)
			.output(runtimeClineAddProviderResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.addClineProvider(ctx.workspaceScope, input);
			}),
		startTaskSession: writerWorkspaceProcedure
			.input(runtimeTaskSessionStartRequestSchema)
			.output(runtimeTaskSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.startTaskSession(ctx.workspaceScope, input, ctx.caller);
			}),
		stopTaskSession: writerWorkspaceProcedure
			.input(runtimeTaskSessionStopRequestSchema)
			.output(runtimeTaskSessionStopResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.stopTaskSession(ctx.workspaceScope, input);
			}),
		sendTaskSessionInput: writerWorkspaceProcedure
			.input(runtimeTaskSessionInputRequestSchema)
			.output(runtimeTaskSessionInputResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.sendTaskSessionInput(ctx.workspaceScope, input);
			}),
		getTaskChatMessages: workspaceProcedure
			.input(runtimeTaskChatMessagesRequestSchema)
			.output(runtimeTaskChatMessagesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getTaskChatMessages(ctx.workspaceScope, input);
			}),
		getClineSlashCommands: t.procedure.output(runtimeSlashCommandsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineSlashCommands(ctx.workspaceScope);
		}),
		reloadTaskChatSession: writerWorkspaceProcedure
			.input(runtimeTaskChatReloadRequestSchema)
			.output(runtimeTaskChatReloadResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.reloadTaskChatSession(ctx.workspaceScope, input);
			}),
		sendTaskChatMessage: writerWorkspaceProcedure
			.input(runtimeTaskChatSendRequestSchema)
			.output(runtimeTaskChatSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.sendTaskChatMessage(ctx.workspaceScope, input, ctx.caller);
			}),
		abortTaskChatTurn: writerWorkspaceProcedure
			.input(runtimeTaskChatAbortRequestSchema)
			.output(runtimeTaskChatAbortResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.abortTaskChatTurn(ctx.workspaceScope, input);
			}),
		cancelTaskChatTurn: writerWorkspaceProcedure
			.input(runtimeTaskChatCancelRequestSchema)
			.output(runtimeTaskChatCancelResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				return await ctx.runtimeApi.cancelTaskChatTurn(ctx.workspaceScope, input);
			}),
		getClineProviderCatalog: t.procedure.output(runtimeClineProviderCatalogResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineProviderCatalog(ctx.workspaceScope);
		}),
		getClineAccountProfile: t.procedure.output(runtimeClineAccountProfileResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineAccountProfile(ctx.workspaceScope);
		}),
		getClineKanbanAccess: t.procedure.output(runtimeClineKanbanAccessResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineKanbanAccess(ctx.workspaceScope);
		}),
		getClineProviderModels: t.procedure
			.input(runtimeClineProviderModelsRequestSchema)
			.output(runtimeClineProviderModelsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.runtimeApi.getClineProviderModels(ctx.workspaceScope, input);
			}),
		getClineMcpAuthStatuses: t.procedure.output(runtimeClineMcpAuthStatusResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineMcpAuthStatuses(ctx.workspaceScope);
		}),
		runClineMcpServerOAuth: t.procedure
			.input(runtimeClineMcpOAuthRequestSchema)
			.output(runtimeClineMcpOAuthResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runClineMcpServerOAuth(ctx.workspaceScope, input);
			}),
		getClineMcpSettings: t.procedure.output(runtimeClineMcpSettingsResponseSchema).query(async ({ ctx }) => {
			return await ctx.runtimeApi.getClineMcpSettings(ctx.workspaceScope);
		}),
		saveClineMcpSettings: t.procedure
			.input(runtimeClineMcpSettingsSaveRequestSchema)
			.output(runtimeClineMcpSettingsSaveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.saveClineMcpSettings(ctx.workspaceScope, input);
			}),
		runClineProviderOAuthLogin: t.procedure
			.input(runtimeClineOauthLoginRequestSchema)
			.output(runtimeClineOauthLoginResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runClineProviderOAuthLogin(ctx.workspaceScope, input);
			}),
		startShellSession: workspaceProcedure
			.input(runtimeShellSessionStartRequestSchema)
			.output(runtimeShellSessionStartResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.startShellSession(ctx.workspaceScope, input);
			}),
		runCommand: workspaceProcedure
			.input(runtimeCommandRunRequestSchema)
			.output(runtimeCommandRunResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.runCommand(ctx.workspaceScope, input);
			}),
		resetAllState: t.procedure.output(runtimeDebugResetAllStateResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.runtimeApi.resetAllState(ctx.workspaceScope);
		}),
		openFile: t.procedure
			.input(runtimeOpenFileRequestSchema)
			.output(runtimeOpenFileResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.runtimeApi.openFile(input);
			}),
	}),
	workspace: t.router({
		getGitSummary: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitSummaryResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitSummary(ctx.workspaceScope, input ?? null);
			}),
		runGitSyncAction: workspaceProcedure
			.input(gitSyncActionInputSchema)
			.output(runtimeGitSyncResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.runGitSyncAction(ctx.workspaceScope, input);
			}),
		checkoutGitBranch: workspaceProcedure
			.input(runtimeGitCheckoutRequestSchema)
			.output(runtimeGitCheckoutResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.checkoutGitBranch(ctx.workspaceScope, input);
			}),
		discardGitChanges: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitDiscardResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.discardGitChanges(ctx.workspaceScope, input ?? null);
			}),
		getChanges: workspaceProcedure
			.input(runtimeWorkspaceChangesRequestSchema)
			.output(runtimeWorkspaceChangesResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadChanges(ctx.workspaceScope, input);
			}),
		ensureWorktree: workspaceProcedure
			.input(runtimeWorktreeEnsureRequestSchema)
			.output(runtimeWorktreeEnsureResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.ensureWorktree(ctx.workspaceScope, input);
			}),
		deleteWorktree: workspaceProcedure
			.input(runtimeWorktreeDeleteRequestSchema)
			.output(runtimeWorktreeDeleteResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.workspaceApi.deleteWorktree(ctx.workspaceScope, input);
			}),
		getTaskContext: workspaceProcedure
			.input(runtimeTaskWorkspaceInfoRequestSchema)
			.output(runtimeTaskWorkspaceInfoResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadTaskContext(ctx.workspaceScope, input);
			}),
		searchFiles: workspaceProcedure
			.input(runtimeWorkspaceFileSearchRequestSchema)
			.output(runtimeWorkspaceFileSearchResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.searchFiles(ctx.workspaceScope, input);
			}),
		getState: workspaceProcedure.output(runtimeWorkspaceStateResponseSchema).query(async ({ ctx }) => {
			const state = await ctx.workspaceApi.loadState(ctx.workspaceScope);
			return {
				...state,
				board: filterBoardForCaller(state.board, ctx.caller),
			};
		}),
		notifyStateUpdated: workspaceProcedure
			.output(runtimeWorkspaceStateNotifyResponseSchema)
			.mutation(async ({ ctx }) => {
				return await ctx.workspaceApi.notifyStateUpdated(ctx.workspaceScope);
			}),
		saveState: writerWorkspaceProcedure
			.input(runtimeWorkspaceStateSaveRequestSchema)
			.output(runtimeWorkspaceStateResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				// Load current board to check existing visibility values before the save.
				const currentState = await ctx.workspaceApi.loadState(ctx.workspaceScope);
				const currentCardsById = new Map(
					currentState.board.columns.flatMap((col) => col.cards.map((card) => [card.id, card])),
				);

				const processedColumns = input.board.columns.map((col) => ({
					...col,
					cards: col.cards.map((card) => {
						const current = currentCardsById.get(card.id);

						// 1. Stamp createdBy on new cards (no existing record).
						const createdBy =
							card.createdBy ??
							(ctx.caller && !current
								? { uuid: ctx.caller.uuid, displayName: ctx.caller.displayName, email: ctx.caller.email }
								: current?.createdBy);

						// 2. Enforce visibility rules: strip unauthorised visibility changes.
						//    If caller cannot set visibility, preserve the existing value.
						let visibility = card.visibility;
						if (visibility !== undefined && visibility !== (current?.visibility ?? "shared")) {
							if (!callerCanSetVisibility(card, ctx.caller)) {
								// Revert to existing visibility — the caller cannot change this.
								visibility = current?.visibility;
							}
						}

						return {
							...card,
							...(createdBy ? { createdBy } : {}),
							...(visibility !== undefined ? { visibility } : {}),
						};
					}),
				}));

				const processedInput = { ...input, board: { ...input.board, columns: processedColumns } };

				// Detect cards newly moved into the review column for push notifications.
				const prevReviewCardIds = new Set(
					(currentState.board.columns.find((c) => c.id === "review")?.cards ?? []).map((c) => c.id),
				);
				const nextReviewCards = processedColumns.find((c) => c.id === "review")?.cards ?? [];
				const movedToReviewCards = nextReviewCards.filter((c) => !prevReviewCardIds.has(c.id));

				// Filter the response so the saving caller only sees cards they're allowed to see.
				const response = await ctx.workspaceApi.saveState(ctx.workspaceScope, processedInput);

				// Fire push notifications for each card newly moved to review.
				for (const card of movedToReviewCards) {
					const isPrivate = card.visibility === "private";
					const ownerUuid = card.createdBy?.uuid;
					const callerUuid = ctx.caller?.uuid;
					// Don't notify the person who moved it.
					const targetUserUuids =
						isPrivate && ownerUuid
							? [ownerUuid]
							: ctx.pushManager
									.listAllSubscriptions()
									.filter((s) => s.userUuid !== callerUuid)
									.map((s) => s.userUuid)
									.filter((uuid, i, arr) => arr.indexOf(uuid) === i);
					void ctx.pushManager.send({
						event: "moved_to_review",
						workspaceId: ctx.workspaceScope.workspaceId,
						title: "Task moved to review",
						body: card.prompt ? card.prompt.slice(0, 80) : "A task is ready for review",
						data: { taskId: card.id, url: `/${ctx.workspaceScope.workspaceId}` },
						targetUserUuids,
					});
				}

				return {
					...response,
					board: filterBoardForCaller(response.board, ctx.caller),
				};
			}),
		getWorkspaceChanges: workspaceProcedure.output(runtimeWorkspaceChangesResponseSchema).query(async ({ ctx }) => {
			return await ctx.workspaceApi.loadWorkspaceChanges(ctx.workspaceScope);
		}),
		getGitLog: workspaceProcedure
			.input(runtimeGitLogRequestSchema)
			.output(runtimeGitLogResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitLog(ctx.workspaceScope, input);
			}),
		getGitRefs: workspaceProcedure
			.input(optionalTaskWorkspaceInfoRequestSchema)
			.output(runtimeGitRefsResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadGitRefs(ctx.workspaceScope, input ?? null);
			}),
		getCommitDiff: workspaceProcedure
			.input(runtimeGitCommitDiffRequestSchema)
			.output(runtimeGitCommitDiffResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.workspaceApi.loadCommitDiff(ctx.workspaceScope, input);
			}),
	}),
	projects: t.router({
		list: t.procedure.output(runtimeProjectsResponseSchema).query(async ({ ctx }) => {
			return await ctx.projectsApi.listProjects(ctx.requestedWorkspaceId);
		}),
		add: t.procedure
			.input(runtimeProjectAddRequestSchema)
			.output(runtimeProjectAddResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.addProject(ctx.requestedWorkspaceId, input);
			}),
		remove: t.procedure
			.input(runtimeProjectRemoveRequestSchema)
			.output(runtimeProjectRemoveResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.removeProject(ctx.requestedWorkspaceId, input);
			}),
		pickDirectory: t.procedure.output(runtimeProjectDirectoryPickerResponseSchema).mutation(async ({ ctx }) => {
			return await ctx.projectsApi.pickProjectDirectory(ctx.requestedWorkspaceId);
		}),
		// In-browser directory browser — used by the folder picker UI as a fallback
		// when the OS-native dialog is unavailable (e.g. Windows, remote instances).
		// Returns subdirectories only; hidden dirs (dot-prefixed) are excluded.
		listDirectory: t.procedure
			.input(runtimeDirectoryListRequestSchema)
			.output(runtimeDirectoryListResponseSchema)
			.query(async ({ ctx, input }) => {
				return await ctx.projectsApi.listDirectory(input);
			}),
		// Create a new directory (used by the folder picker "Create Folder" button).
		createDirectory: t.procedure
			.input(runtimeCreateDirectoryRequestSchema)
			.output(runtimeCreateDirectoryResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.createDirectory(input);
			}),
		// Clone a git repository into a subdirectory of the given parent path.
		cloneRepository: t.procedure
			.input(runtimeCloneRepositoryRequestSchema)
			.output(runtimeCloneRepositoryResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.projectsApi.cloneRepository(input);
			}),
	}),
	hooks: t.router({
		ingest: t.procedure
			.input(runtimeHookIngestRequestSchema)
			.output(runtimeHookIngestResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.hooksApi.ingest(input);
			}),
	}),

	push: t.router({
		getVapidPublicKey: t.procedure.output(runtimePushVapidPublicKeyResponseSchema).query(({ ctx }) => {
			return ctx.pushApi.getVapidPublicKey();
		}),
		subscribe: t.procedure
			.input(runtimePushSubscriptionSchema)
			.output(runtimePushSubscribeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.pushApi.subscribe(input);
			}),
		unsubscribe: t.procedure
			.input(runtimePushUnsubscribeRequestSchema)
			.output(runtimePushUnsubscribeResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.pushApi.unsubscribe(input);
			}),
		send: t.procedure
			.input(runtimePushSendRequestSchema)
			.output(runtimePushSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				return await ctx.pushApi.send(input);
			}),
	}),

	// Workspace-scoped inter-user team chat. Messages are NOT sent to any AI model.
	teamChat: t.router({
		// Returns all persisted team chat messages for the current workspace.
		getMessages: workspaceProcedure.output(runtimeTeamChatGetMessagesResponseSchema).query(async ({ ctx }) => {
			try {
				const messages = await readWorkspaceTeamChatMessages(ctx.workspaceScope.workspaceId);
				return { ok: true, messages };
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				return { ok: false, messages: [], error };
			}
		}),

		// Sends a new team chat message. Persists it and broadcasts to all workspace clients.
		sendMessage: writerWorkspaceProcedure
			.input(runtimeTeamChatSendRequestSchema)
			.output(runtimeTeamChatSendResponseSchema)
			.mutation(async ({ ctx, input }) => {
				assertEditorOrAdmin(ctx);
				if (!ctx.caller) {
					return { ok: false, error: "No identity available. Sign in to Cline to send team chat messages." };
				}
				const message = {
					id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
					workspaceId: ctx.workspaceScope.workspaceId,
					text: input.text.trim(),
					sender: {
						uuid: ctx.caller.uuid,
						displayName: ctx.caller.displayName,
						email: ctx.caller.email,
					},
					createdAt: Date.now(),
				};
				try {
					await appendWorkspaceTeamChatMessage(ctx.workspaceScope.workspaceId, message);
					ctx.broadcastTeamChatMessage(ctx.workspaceScope.workspaceId, message);
					// Push to all subscribers except the sender.
					void ctx.pushManager.send({
						event: "team_chat",
						workspaceId: ctx.workspaceScope.workspaceId,
						title: `${ctx.caller.displayName} in Team Chat`,
						body: input.text.slice(0, 120),
						data: { url: `/${ctx.workspaceScope.workspaceId}` },
						targetUserUuids: ctx.pushManager
							.listAllSubscriptions()
							.filter((s) => s.userUuid !== ctx.caller?.uuid)
							.map((s) => s.userUuid)
							.filter((uuid, i, arr) => arr.indexOf(uuid) === i),
					});
					return { ok: true, message };
				} catch (err) {
					const error = err instanceof Error ? err.message : String(err);
					return { ok: false, error };
				}
			}),
	}),

	// Remote access management — all procedures are localhost-only.
	// All procedures use ctx.remoteAuth (the shared singleton) — no new DB connections.
	remote: t.router({
		// Returns the caller's identity. Available to all users (local and remote).
		// Used by the frontend to stamp createdBy on newly created cards.
		getCallerIdentity: t.procedure.query(({ ctx }) => {
			return ctx.caller ?? null;
		}),

		// Returns current RemoteConfig. Password hash and localUser hashes are omitted.
		getConfig: localOnlyProcedure.query(async () => {
			const config = await loadRemoteConfig();
			const { password: _password, localUsers, ...rest } = config;
			const safeLocalUsers = localUsers.map(({ passwordHash: _hash, ...user }) => user);
			return { ...rest, localUsers: safeLocalUsers };
		}),

		// Saves updated RemoteConfig fields. Password is updated separately via setPassword.
		saveConfig: localOnlyProcedure
			.input(
				z.object({
					authMode: z.enum(["workos", "password", "both"]).optional(),
					allowedEmails: z.array(z.string()).optional(),
					allowedEmailDomains: z.array(z.string()).optional(),
					publicBaseUrl: z.string().optional(),
				}),
			)
			.mutation(async ({ input }) => {
				const current = await loadRemoteConfig();
				const next: RemoteConfig = {
					...current,
					...(input.authMode !== undefined && { authMode: input.authMode }),
					...(input.allowedEmails !== undefined && { allowedEmails: input.allowedEmails }),
					...(input.allowedEmailDomains !== undefined && { allowedEmailDomains: input.allowedEmailDomains }),
					...(input.publicBaseUrl !== undefined && { publicBaseUrl: input.publicBaseUrl }),
				};
				await saveRemoteConfig(next);
				return { ok: true };
			}),

		// Sets or updates the shared password. Pass empty string to disable password auth.
		// The password is stored as a scrypt hash — never in plaintext.
		setPassword: localOnlyProcedure.input(z.object({ password: z.string() })).mutation(async ({ input, ctx }) => {
			const hash = input.password ? await ctx.remoteAuth.hashPassword(input.password) : "";
			const current = await loadRemoteConfig();
			await saveRemoteConfig({ ...current, password: hash });
			return { ok: true };
		}),

		// Creates a new local user account and returns the one-time plaintext password.
		// The password is hashed immediately; it is never stored in plaintext.
		createUser: localOnlyProcedure.input(z.object({ email: z.string().email() })).mutation(async ({ input, ctx }) => {
			const password = generateReadablePassword();
			const passwordHash = await ctx.remoteAuth.hashPassword(password);
			const current = await loadRemoteConfig();
			const existing = current.localUsers.findIndex((u) => u.email.toLowerCase() === input.email.toLowerCase());
			const newUser = { email: input.email, passwordHash, createdAt: Date.now() };
			const localUsers =
				existing !== -1
					? current.localUsers.map((u, i) => (i === existing ? newUser : u))
					: [...current.localUsers, newUser];
			await saveRemoteConfig({ ...current, localUsers });
			return { email: input.email, password };
		}),

		// Removes a local user account and revokes all their active sessions.
		deleteUser: localOnlyProcedure.input(z.object({ email: z.string() })).mutation(async ({ input, ctx }) => {
			const current = await loadRemoteConfig();
			const localUsers = current.localUsers.filter((u) => u.email.toLowerCase() !== input.email.toLowerCase());
			await saveRemoteConfig({ ...current, localUsers });
			ctx.remoteAuth.revokeAllSessionsForEmail(input.email);
			return { ok: true };
		}),

		// Lists all active remote sessions (for the management UI).
		listSessions: adminOrLocalProcedure.query(({ ctx }) => {
			return { sessions: ctx.remoteAuth.listSessions() };
		}),

		// Revokes a specific session by ID.
		revokeSession: adminOrLocalProcedure.input(z.object({ sessionId: z.string() })).mutation(({ input, ctx }) => {
			ctx.remoteAuth.revokeSession(input.sessionId);
			return { ok: true };
		}),

		// ── Push notification procedures ───────────────────────────────────
		push: t.router({
			// Returns the VAPID public key. No auth required — needed to subscribe
			// before the user has a session cookie.
			getVapidPublicKey: t.procedure
				.output(runtimePushVapidPublicKeyResponseSchema)
				.query(({ ctx }) => ({ vapidPublicKey: ctx.pushManager.getPublicKey() })),

			// Register a push subscription. Requires a valid session (CallerIdentity).
			subscribe: t.procedure
				.input(runtimePushSubscribeRequestSchema)
				.output(runtimeRemotePushSubscribeResponseSchema)
				.mutation(({ ctx, input }) => {
					if (!ctx.caller) {
						return { ok: false, error: "Sign in to enable push notifications." };
					}
					const subscriptionId = ctx.pushManager.saveSubscription(ctx.caller.uuid, ctx.caller.email, {
						endpoint: input.endpoint,
						keys: input.keys,
					});
					return { ok: true, subscriptionId };
				}),

			// Remove a subscription by endpoint.
			unsubscribe: t.procedure
				.input(runtimePushUnsubscribeRequestSchema)
				.output(runtimePushUnsubscribeResponseSchema)
				.mutation(({ ctx, input }) => {
					ctx.pushManager.removeSubscription(input.endpoint);
					return { ok: true };
				}),

			// Returns the caller's own push subscriptions with their preferences.
			listSubscriptions: t.procedure.output(runtimePushListSubscriptionsResponseSchema).query(({ ctx }) => {
				if (!ctx.caller) return { subscriptions: [] };
				return { subscriptions: ctx.pushManager.listSubscriptionsForUser(ctx.caller.uuid) };
			}),

			// Update per-event notification preferences for a subscription.
			updatePreferences: t.procedure
				.input(runtimePushUpdatePreferencesRequestSchema)
				.output(runtimePushUpdatePreferencesResponseSchema)
				.mutation(({ ctx, input }) => {
					ctx.pushManager.updatePreferences(input.subscriptionId, input.preferences);
					return { ok: true };
				}),

			// Admin: list every subscription across all users.
			listAllSubscriptions: adminOrLocalProcedure
				.output(runtimePushListSubscriptionsResponseSchema)
				.query(({ ctx }) => ({ subscriptions: ctx.pushManager.listAllSubscriptions() })),

			// Admin: forcibly remove any subscription by ID.
			removeSubscription: adminOrLocalProcedure
				.input(z.object({ subscriptionId: z.string() }))
				.output(z.object({ ok: z.boolean() }))
				.mutation(({ ctx, input }) => {
					const subs = ctx.pushManager.listAllSubscriptions();
					const sub = subs.find((s) => s.id === input.subscriptionId);
					if (sub) ctx.pushManager.removeSubscription(sub.endpoint);
					return { ok: true };
				}),
		}),

		// ── User management (admin/localhost only) ─────────────────────────
		// Manage remote users and their permission levels.
		users: t.router({
			// List all users who have ever connected, with their current role and session count.
			list: adminOrLocalProcedure.output(runtimeRemoteUsersListResponseSchema).query(({ ctx }) => {
				const users = ctx.remoteAuth.listUsers();
				const sessions = ctx.remoteAuth.listSessions();
				const sessionCountByUuid = new Map<string, number>();
				for (const s of sessions) {
					sessionCountByUuid.set(s.userUuid, (sessionCountByUuid.get(s.userUuid) ?? 0) + 1);
				}
				return {
					users: users.map((u) => ({
						...u,
						displayName: u.displayName,
						activeSessions: sessionCountByUuid.get(u.uuid) ?? 0,
					})),
				};
			}),

			// Promote or demote a user's role.
			setRole: adminOrLocalProcedure
				.input(runtimeRemoteUsersSetRoleRequestSchema)
				.output(runtimeRemoteOkResponseSchema)
				.mutation(({ ctx, input }) => {
					ctx.remoteAuth.setUserRole(input.uuid, input.role);
					return { ok: true };
				}),

			// Block a user: reset to viewer and revoke all their sessions immediately.
			block: adminOrLocalProcedure
				.input(runtimeRemoteUsersBlockRequestSchema)
				.output(runtimeRemoteOkResponseSchema)
				.mutation(({ ctx, input }) => {
					ctx.remoteAuth.blockUser(input.uuid);
					return { ok: true };
				}),

			// Trust a user: promote to editor (shortcut for setRole with editor).
			trust: adminOrLocalProcedure
				.input(z.object({ uuid: z.string() }))
				.output(runtimeRemoteOkResponseSchema)
				.mutation(({ ctx, input }) => {
					ctx.remoteAuth.setUserRole(input.uuid, "editor");
					return { ok: true };
				}),
		}),

		// ── Device / session management (admin/localhost only) ─────────────
		// Each active browser session represents a "device" connection.
		devices: t.router({
			// List all active sessions across all users.
			list: adminOrLocalProcedure.output(runtimeRemoteDevicesListResponseSchema).query(({ ctx }) => {
				const sessions = ctx.remoteAuth.listSessions();
				return {
					sessions: sessions.map((s) => ({
						id: s.id,
						email: s.email,
						userUuid: s.userUuid,
						displayName: s.displayName,
						issuedAt: s.issuedAt,
						expiresAt: s.expiresAt,
						lastSeen: s.lastSeen,
						persistent: Number(s.persistent) === 1,
						// Resolve current role from user record.
						role: (ctx.remoteAuth.getUserRecord(s.userUuid)?.role ?? "viewer") as RemoteUserRole,
					})),
				};
			}),

			// Revoke a specific session — forces the device to re-authenticate.
			revoke: adminOrLocalProcedure
				.input(runtimeRemoteDevicesRevokeRequestSchema)
				.output(runtimeRemoteOkResponseSchema)
				.mutation(({ ctx, input }) => {
					ctx.remoteAuth.revokeSession(input.sessionId);
					return { ok: true };
				}),
		}),

		// ── Cloudflare tunnel (admin/localhost only) ────────────────────────
		// Start a temporary trycloudflare.com tunnel for remote access.
		// Installs cloudflared automatically if not present.
		tunnel: t.router({
			// Returns current tunnel state without starting anything.
			status: adminOrLocalProcedure.output(runtimeTunnelStatusResponseSchema).query(() => ({
				running: getTunnelUrl() !== null,
				url: getTunnelUrl(),
			})),

			// Installs cloudflared if needed, then opens a quick tunnel.
			// Resolves when the public URL is ready (up to ~30s).
			// `port` defaults to the Kanban server port if omitted.
			start: adminOrLocalProcedure
				.input(z.object({ port: z.number().int().min(1).max(65535) }))
				.output(runtimeTunnelStartResponseSchema)
				.mutation(async ({ input }) => {
					try {
						const url = await startCloudflaredTunnel(input.port);
						return { ok: true, url };
					} catch (err) {
						const error = err instanceof Error ? err.message : String(err);
						return { ok: false, error };
					}
				}),

			// Stops the running tunnel.
			stop: adminOrLocalProcedure.output(runtimeTunnelStopResponseSchema).mutation(async () => {
				await stopCloudflaredTunnel();
				return { ok: true };
			}),
		}),

		// ── Provider override management (admin/localhost only) ────────────
		// Admins can pre-configure API keys for specific providers.
		// When enforced=true, all task sessions use the admin's key.
		providers: t.router({
			// List all configured overrides. API keys are always masked.
			list: adminOrLocalProcedure.output(runtimeProviderOverrideListResponseSchema).query(async () => {
				const config = await loadRemoteConfig();
				return {
					overrides: config.providerOverrides.map((o) => ({
						providerId: o.providerId,
						modelId: o.modelId,
						apiKeyMasked: "***",
						baseUrl: o.baseUrl,
						enforced: o.enforced,
						label: o.label,
						createdAt: o.createdAt,
					})),
				};
			}),

			// Add or update a provider override. The plain API key is encrypted before storage.
			set: adminOrLocalProcedure
				.input(runtimeProviderOverrideSetRequestSchema)
				.output(runtimeProviderOverrideOkResponseSchema)
				.mutation(async ({ input }) => {
					const config = await loadRemoteConfig();
					const existing = config.providerOverrides.find((o) => o.providerId === input.providerId);
					const override = {
						providerId: input.providerId,
						modelId: input.modelId?.trim() ?? existing?.modelId ?? "",
						apiKeyEncrypted: encryptApiKey(input.apiKey),
						baseUrl: input.baseUrl?.trim() ?? existing?.baseUrl ?? "",
						enforced: input.enforced ?? existing?.enforced ?? false,
						label: input.label?.trim() ?? existing?.label ?? input.providerId,
						createdAt: existing?.createdAt ?? Date.now(),
					};
					const overrides = existing
						? config.providerOverrides.map((o) => (o.providerId === input.providerId ? override : o))
						: [...config.providerOverrides, override];
					await saveRemoteConfig({ ...config, providerOverrides: overrides });
					return { ok: true };
				}),

			// Toggle the enforced flag without changing the key.
			setEnforced: adminOrLocalProcedure
				.input(runtimeProviderOverrideSetEnforcedRequestSchema)
				.output(runtimeProviderOverrideOkResponseSchema)
				.mutation(async ({ input }) => {
					const config = await loadRemoteConfig();
					const overrides = config.providerOverrides.map((o) =>
						o.providerId === input.providerId ? { ...o, enforced: input.enforced } : o,
					);
					await saveRemoteConfig({ ...config, providerOverrides: overrides });
					return { ok: true };
				}),

			// Remove a provider override entirely.
			remove: adminOrLocalProcedure
				.input(runtimeProviderOverrideRemoveRequestSchema)
				.output(runtimeProviderOverrideOkResponseSchema)
				.mutation(async ({ input }) => {
					const config = await loadRemoteConfig();
					const overrides = config.providerOverrides.filter((o) => o.providerId !== input.providerId);
					await saveRemoteConfig({ ...config, providerOverrides: overrides });
					return { ok: true };
				}),
		}),
	}),
});

export type RuntimeAppRouter = typeof runtimeAppRouter;
export type RuntimeAppRouterInputs = inferRouterInputs<RuntimeAppRouter>;
export type RuntimeAppRouterOutputs = inferRouterOutputs<RuntimeAppRouter>;
