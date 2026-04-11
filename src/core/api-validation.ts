import { z } from "zod";

import {
	type RuntimeClineAccountSwitchRequest,
	type RuntimeClineAddProviderRequest,
	type RuntimeClineMcpOAuthRequest,
	type RuntimeClineMcpSettingsSaveRequest,
	type RuntimeClineOauthLoginRequest,
	type RuntimeClineProviderModelsRequest,
	type RuntimeClineProviderSettingsSaveRequest,
	type RuntimeClineUpdateProviderRequest,
	type RuntimeCommandRunRequest,
	type RuntimeConfigSaveRequest,
	type RuntimeGitCheckoutRequest,
	type RuntimeHookIngestRequest,
	type RuntimeProjectAddRequest,
	type RuntimeProjectRemoveRequest,
	type RuntimeShellSessionStartRequest,
	type RuntimeTaskChatAbortRequest,
	type RuntimeTaskChatCancelRequest,
	type RuntimeTaskChatMessagesRequest,
	type RuntimeTaskChatReloadRequest,
	type RuntimeTaskChatSendRequest,
	type RuntimeTaskSessionInputRequest,
	type RuntimeTaskSessionStartRequest,
	type RuntimeTaskSessionStopRequest,
	type RuntimeTaskWorkspaceInfoRequest,
	type RuntimeTerminalWsClientMessage,
	type RuntimeWorkspaceChangesRequest,
	type RuntimeWorkspaceFileSearchRequest,
	type RuntimeWorkspaceStateSaveRequest,
	type RuntimeWorktreeDeleteRequest,
	type RuntimeWorktreeEnsureRequest,
	runtimeClineAccountSwitchRequestSchema,
	runtimeClineAddProviderRequestSchema,
	runtimeClineMcpOAuthRequestSchema,
	runtimeClineMcpSettingsSaveRequestSchema,
	runtimeClineOauthLoginRequestSchema,
	runtimeClineProviderModelsRequestSchema,
	runtimeClineProviderSettingsSaveRequestSchema,
	runtimeClineUpdateProviderRequestSchema,
	runtimeCommandRunRequestSchema,
	runtimeConfigSaveRequestSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeHookIngestRequestSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeShellSessionStartRequestSchema,
	runtimeTaskChatAbortRequestSchema,
	runtimeTaskChatCancelRequestSchema,
	runtimeTaskChatMessagesRequestSchema,
	runtimeTaskChatReloadRequestSchema,
	runtimeTaskChatSendRequestSchema,
	runtimeTaskSessionInputRequestSchema,
	runtimeTaskSessionStartRequestSchema,
	runtimeTaskSessionStopRequestSchema,
	runtimeTaskWorkspaceInfoRequestSchema,
	runtimeTerminalWsClientMessageSchema,
	runtimeWorkspaceChangesRequestSchema,
	runtimeWorkspaceFileSearchRequestSchema,
	runtimeWorkspaceStateSaveRequestSchema,
	runtimeWorktreeDeleteRequestSchema,
	runtimeWorktreeEnsureRequestSchema,
} from "./api-contract";

const trimmedStringSchema = z.string().transform((value) => value.trim());
const positiveIntegerFromQuerySchema = z.coerce.number().int().positive();

const requiredTrimmedStringSchema = (message: string) => trimmedStringSchema.pipe(z.string().min(1, message));

function parseWithSchema<T>(schema: z.ZodType<T>, value: unknown): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		throw new Error(parsed.error.issues[0]?.message ?? "Invalid request payload.");
	}
	return parsed.data;
}

export function parseWorkspaceChangesRequest(query: URLSearchParams): RuntimeWorkspaceChangesRequest {
	const taskId = parseWithSchema(
		requiredTrimmedStringSchema("Missing taskId query parameter."),
		query.get("taskId") ?? "",
	);
	const baseRef = parseWithSchema(
		requiredTrimmedStringSchema("Missing baseRef query parameter."),
		query.get("baseRef") ?? "",
	);
	return parseWithSchema(runtimeWorkspaceChangesRequestSchema, { taskId, baseRef });
}

export function parseTaskWorkspaceInfoRequest(query: URLSearchParams): RuntimeTaskWorkspaceInfoRequest {
	const taskId = parseWithSchema(
		requiredTrimmedStringSchema("Missing taskId query parameter."),
		query.get("taskId") ?? "",
	);
	const baseRef = parseWithSchema(
		requiredTrimmedStringSchema("Missing baseRef query parameter."),
		query.get("baseRef") ?? "",
	);
	return parseWithSchema(runtimeTaskWorkspaceInfoRequestSchema, { taskId, baseRef });
}

export function parseOptionalTaskWorkspaceInfoRequest(query: URLSearchParams): RuntimeTaskWorkspaceInfoRequest | null {
	if (!query.has("taskId")) {
		if (query.has("baseRef")) {
			throw new Error("baseRef query parameter requires taskId.");
		}
		return null;
	}
	return parseTaskWorkspaceInfoRequest(query);
}

export function parseWorkspaceFileSearchRequest(query: URLSearchParams): RuntimeWorkspaceFileSearchRequest {
	const normalizedQuery = parseWithSchema(trimmedStringSchema, query.get("q") ?? "");
	if (!normalizedQuery) {
		return { query: "" };
	}

	const rawLimit = query.get("limit");
	if (rawLimit == null || rawLimit.trim() === "") {
		return parseWithSchema(runtimeWorkspaceFileSearchRequestSchema, {
			query: normalizedQuery,
		});
	}
	const parsedLimit = positiveIntegerFromQuerySchema.safeParse(rawLimit);
	if (!parsedLimit.success) {
		throw new Error("Invalid file search limit parameter.");
	}
	return parseWithSchema(runtimeWorkspaceFileSearchRequestSchema, {
		query: normalizedQuery,
		limit: parsedLimit.data,
	});
}

export function parseGitCheckoutRequest(value: unknown): RuntimeGitCheckoutRequest {
	const parsed = parseWithSchema(runtimeGitCheckoutRequestSchema, value);
	const branch = parsed.branch.trim();
	if (!branch) {
		throw new Error("Branch cannot be empty.");
	}
	return {
		branch,
	};
}

export function parseWorktreeEnsureRequest(value: unknown): RuntimeWorktreeEnsureRequest {
	const parsed = parseWithSchema(runtimeWorktreeEnsureRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Invalid worktree ensure payload.");
	}
	const baseRef = parsed.baseRef.trim();
	if (!baseRef) {
		throw new Error("Invalid worktree ensure payload.");
	}
	return {
		taskId,
		baseRef,
	};
}

export function parseWorktreeDeleteRequest(value: unknown): RuntimeWorktreeDeleteRequest {
	const parsed = parseWithSchema(runtimeWorktreeDeleteRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Invalid worktree delete payload.");
	}
	return {
		taskId,
	};
}

export function parseWorkspaceStateSaveRequest(value: unknown): RuntimeWorkspaceStateSaveRequest {
	return parseWithSchema(runtimeWorkspaceStateSaveRequestSchema, value);
}

export function parseProjectAddRequest(value: unknown): RuntimeProjectAddRequest {
	const parsed = parseWithSchema(runtimeProjectAddRequestSchema, value);
	const path = parsed.path.trim();
	if (!path) {
		throw new Error("Project path cannot be empty.");
	}
	return {
		path,
		initializeGit: parsed.initializeGit,
	};
}

export function parseProjectRemoveRequest(value: unknown): RuntimeProjectRemoveRequest {
	const parsed = parseWithSchema(runtimeProjectRemoveRequestSchema, value);
	const projectId = parsed.projectId.trim();
	if (!projectId) {
		throw new Error("Project ID cannot be empty.");
	}
	return {
		projectId,
	};
}

export function parseRuntimeConfigSaveRequest(value: unknown): RuntimeConfigSaveRequest {
	return parseWithSchema(runtimeConfigSaveRequestSchema, value);
}

export function parseCommandRunRequest(value: unknown): RuntimeCommandRunRequest {
	const parsed = parseWithSchema(runtimeCommandRunRequestSchema, value);
	const command = parsed.command.trim();
	if (!command) {
		throw new Error("Command cannot be empty.");
	}
	return {
		command,
	};
}

export function parseTaskSessionStartRequest(value: unknown): RuntimeTaskSessionStartRequest {
	const parsed = parseWithSchema(runtimeTaskSessionStartRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task session taskId cannot be empty.");
	}
	const baseRef = parsed.baseRef.trim();
	if (!baseRef) {
		throw new Error("Task session baseRef cannot be empty.");
	}
	return {
		...parsed,
		taskId,
		baseRef,
	};
}

export function parseTaskSessionStopRequest(value: unknown): RuntimeTaskSessionStopRequest {
	const parsed = parseWithSchema(runtimeTaskSessionStopRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Invalid task session stop payload.");
	}
	return {
		taskId,
	};
}

export function parseTaskSessionInputRequest(value: unknown): RuntimeTaskSessionInputRequest {
	const parsed = parseWithSchema(runtimeTaskSessionInputRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task session taskId cannot be empty.");
	}
	return {
		...parsed,
		taskId,
	};
}

export function parseTaskChatMessagesRequest(value: unknown): RuntimeTaskChatMessagesRequest {
	const parsed = parseWithSchema(runtimeTaskChatMessagesRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task chat taskId cannot be empty.");
	}
	return {
		taskId,
	};
}

export function parseTaskChatSendRequest(value: unknown): RuntimeTaskChatSendRequest {
	const parsed = parseWithSchema(runtimeTaskChatSendRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task chat taskId cannot be empty.");
	}
	const text = parsed.text.trim();
	const hasImages = Boolean(parsed.images && parsed.images.length > 0);
	if (!text && !hasImages) {
		throw new Error("Task chat text or images are required.");
	}
	return {
		...parsed,
		taskId,
		text,
	};
}

export function parseTaskChatAbortRequest(value: unknown): RuntimeTaskChatAbortRequest {
	const parsed = parseWithSchema(runtimeTaskChatAbortRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task chat taskId cannot be empty.");
	}
	return {
		taskId,
	};
}

export function parseTaskChatReloadRequest(value: unknown): RuntimeTaskChatReloadRequest {
	const parsed = parseWithSchema(runtimeTaskChatReloadRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task chat taskId cannot be empty.");
	}
	return {
		taskId,
	};
}

export function parseTaskChatCancelRequest(value: unknown): RuntimeTaskChatCancelRequest {
	const parsed = parseWithSchema(runtimeTaskChatCancelRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Task chat taskId cannot be empty.");
	}
	return {
		taskId,
	};
}

export function parseClineProviderModelsRequest(value: unknown): RuntimeClineProviderModelsRequest {
	const parsed = parseWithSchema(runtimeClineProviderModelsRequestSchema, value);
	const providerId = parsed.providerId.trim();
	if (!providerId) {
		throw new Error("Provider ID cannot be empty.");
	}
	return {
		providerId,
	};
}

export function parseClineAddProviderRequest(value: unknown): RuntimeClineAddProviderRequest {
	const parsed = parseWithSchema(runtimeClineAddProviderRequestSchema, value);
	const providerId = parsed.providerId.trim().toLowerCase().replace(/\s+/g, "-");
	if (!providerId) {
		throw new Error("Provider ID cannot be empty.");
	}
	const name = parsed.name.trim();
	if (!name) {
		throw new Error("Provider name cannot be empty.");
	}
	const baseUrl = parsed.baseUrl.trim();
	if (!baseUrl) {
		throw new Error("Base URL cannot be empty.");
	}
	const models = [...new Set(parsed.models.map((model) => model.trim()).filter((model) => model.length > 0))];
	const modelsSourceUrl = parsed.modelsSourceUrl?.trim() || null;
	if (models.length === 0 && !modelsSourceUrl) {
		throw new Error("Add at least one model or set a model source URL.");
	}
	const headers = parsed.headers
		? Object.fromEntries(
				Object.entries(parsed.headers)
					.map(([key, entry]) => [key.trim(), entry.trim()] as const)
					.filter(([key]) => key.length > 0),
			)
		: undefined;

	return {
		providerId,
		name,
		baseUrl,
		apiKey: parsed.apiKey?.trim() || null,
		...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
		models,
		defaultModelId: parsed.defaultModelId?.trim() || null,
		modelsSourceUrl,
		capabilities: parsed.capabilities ? [...new Set(parsed.capabilities)] : undefined,
	};
}

export function parseClineUpdateProviderRequest(value: unknown): RuntimeClineUpdateProviderRequest {
	const parsed = parseWithSchema(runtimeClineUpdateProviderRequestSchema, value);
	const providerId = parsed.providerId.trim().toLowerCase().replace(/\s+/g, "-");
	if (!providerId) {
		throw new Error("Provider ID cannot be empty.");
	}

	const headers =
		parsed.headers === undefined
			? undefined
			: parsed.headers === null
				? null
				: Object.fromEntries(
						Object.entries(parsed.headers)
							.map(([key, entry]) => [key.trim(), entry.trim()] as const)
							.filter(([key]) => key.length > 0),
					);
	const models = parsed.models?.map((model) => model.trim()).filter((model) => model.length > 0);

	return {
		providerId,
		...(parsed.name !== undefined ? { name: parsed.name.trim() } : {}),
		...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl.trim() } : {}),
		...(parsed.apiKey !== undefined ? { apiKey: parsed.apiKey?.trim() || null } : {}),
		...(headers !== undefined ? { headers } : {}),
		...(parsed.timeoutMs !== undefined ? { timeoutMs: parsed.timeoutMs } : {}),
		...(models !== undefined ? { models: [...new Set(models)] } : {}),
		...(parsed.defaultModelId !== undefined ? { defaultModelId: parsed.defaultModelId?.trim() || null } : {}),
		...(parsed.modelsSourceUrl !== undefined ? { modelsSourceUrl: parsed.modelsSourceUrl?.trim() || null } : {}),
		...(parsed.capabilities ? { capabilities: [...new Set(parsed.capabilities)] } : {}),
	};
}

export function parseClineProviderSettingsSaveRequest(value: unknown): RuntimeClineProviderSettingsSaveRequest {
	const parsed = parseWithSchema(runtimeClineProviderSettingsSaveRequestSchema, value);
	const providerId = parsed.providerId.trim();
	if (!providerId) {
		throw new Error("Provider ID cannot be empty.");
	}

	const aws =
		parsed.aws === undefined
			? undefined
			: {
					...(parsed.aws.accessKey !== undefined ? { accessKey: parsed.aws.accessKey?.trim() || null } : {}),
					...(parsed.aws.secretKey !== undefined ? { secretKey: parsed.aws.secretKey?.trim() || null } : {}),
					...(parsed.aws.sessionToken !== undefined
						? { sessionToken: parsed.aws.sessionToken?.trim() || null }
						: {}),
					...(parsed.aws.region !== undefined ? { region: parsed.aws.region?.trim() || null } : {}),
					...(parsed.aws.profile !== undefined ? { profile: parsed.aws.profile?.trim() || null } : {}),
					...(parsed.aws.authentication !== undefined ? { authentication: parsed.aws.authentication } : {}),
					...(parsed.aws.endpoint !== undefined ? { endpoint: parsed.aws.endpoint?.trim() || null } : {}),
				};
	const gcp =
		parsed.gcp === undefined
			? undefined
			: {
					...(parsed.gcp.projectId !== undefined ? { projectId: parsed.gcp.projectId?.trim() || null } : {}),
					...(parsed.gcp.region !== undefined ? { region: parsed.gcp.region?.trim() || null } : {}),
				};
	return {
		...parsed,
		providerId,
		...(parsed.region !== undefined ? { region: parsed.region?.trim() || null } : {}),
		...(aws ? { aws } : {}),
		...(gcp ? { gcp } : {}),
	};
}

export function parseClineMcpSettingsSaveRequest(value: unknown): RuntimeClineMcpSettingsSaveRequest {
	const parsed = parseWithSchema(runtimeClineMcpSettingsSaveRequestSchema, value);
	const normalizedServers = parsed.servers.map((server) => {
		const name = server.name.trim();
		if (!name) {
			throw new Error("MCP server name cannot be empty.");
		}

		if (server.type === "stdio") {
			const command = server.command.trim();
			if (!command) {
				throw new Error(`MCP server "${name}" requires a command.`);
			}
			const args = server.args?.map((value) => value.trim()).filter((value) => value.length > 0);
			const cwd = server.cwd?.trim() || undefined;
			const env = server.env
				? Object.fromEntries(
						Object.entries(server.env)
							.map(([key, entry]) => [key.trim(), entry.trim()] as const)
							.filter(([key, entry]) => key.length > 0 && entry.length > 0),
					)
				: undefined;

			return {
				name,
				disabled: server.disabled,
				type: "stdio" as const,
				command,
				...(args && args.length > 0 ? { args } : {}),
				...(cwd ? { cwd } : {}),
				...(env && Object.keys(env).length > 0 ? { env } : {}),
			};
		}

		const url = server.url.trim();
		if (!url) {
			throw new Error(`MCP server "${name}" requires a URL.`);
		}
		const headers = server.headers
			? Object.fromEntries(
					Object.entries(server.headers)
						.map(([key, entry]) => [key.trim(), entry.trim()] as const)
						.filter(([key, entry]) => key.length > 0 && entry.length > 0),
				)
			: undefined;

		return {
			name,
			disabled: server.disabled,
			type: server.type,
			url,
			...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
		};
	});

	const seen = new Set<string>();
	for (const server of normalizedServers) {
		const dedupeKey = server.name.toLowerCase();
		if (seen.has(dedupeKey)) {
			throw new Error(`MCP server "${server.name}" is duplicated.`);
		}
		seen.add(dedupeKey);
	}

	return {
		servers: normalizedServers,
	};
}

export function parseClineMcpOAuthRequest(value: unknown): RuntimeClineMcpOAuthRequest {
	const parsed = parseWithSchema(runtimeClineMcpOAuthRequestSchema, value);
	const serverName = parsed.serverName.trim();
	if (!serverName) {
		throw new Error("MCP server name cannot be empty.");
	}
	return {
		serverName,
	};
}

export function parseClineOauthLoginRequest(value: unknown): RuntimeClineOauthLoginRequest {
	const parsed = parseWithSchema(runtimeClineOauthLoginRequestSchema, value);
	return {
		...parsed,
		baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl.trim() || null : parsed.baseUrl,
	};
}

export function parseShellSessionStartRequest(value: unknown): RuntimeShellSessionStartRequest {
	const parsed = parseWithSchema(runtimeShellSessionStartRequestSchema, value);
	const taskId = parsed.taskId.trim();
	if (!taskId) {
		throw new Error("Shell session taskId cannot be empty.");
	}
	if (parsed.workspaceTaskId !== undefined && !parsed.workspaceTaskId.trim()) {
		throw new Error("Invalid shell session workspaceTaskId.");
	}
	const workspaceTaskId = parsed.workspaceTaskId?.trim() || undefined;
	const baseRef = parsed.baseRef.trim();
	if (!baseRef) {
		throw new Error("Shell session baseRef cannot be empty.");
	}
	return {
		...parsed,
		taskId,
		workspaceTaskId,
		baseRef,
	};
}

export function parseHookIngestRequest(value: unknown): RuntimeHookIngestRequest {
	const parsed = parseWithSchema(runtimeHookIngestRequestSchema, value);
	const taskId = parsed.taskId.trim();
	const workspaceId = parsed.workspaceId.trim();
	if (!taskId) {
		throw new Error("Missing taskId");
	}
	if (!workspaceId) {
		throw new Error("Missing workspaceId");
	}
	const metadata = parsed.metadata
		? {
				activityText: parsed.metadata.activityText?.trim(),
				toolName: parsed.metadata.toolName?.trim(),
				finalMessage: parsed.metadata.finalMessage?.trim(),
				hookEventName: parsed.metadata.hookEventName?.trim(),
				notificationType: parsed.metadata.notificationType?.trim(),
				source: parsed.metadata.source?.trim(),
			}
		: undefined;
	return {
		...parsed,
		taskId,
		workspaceId,
		metadata,
	};
}

export function parseTerminalWsClientMessage(value: unknown): RuntimeTerminalWsClientMessage | null {
	const parsed = runtimeTerminalWsClientMessageSchema.safeParse(value);
	if (!parsed.success) {
		return null;
	}
	return parsed.data;
}

export function parseClineAccountSwitchRequest(value: unknown): RuntimeClineAccountSwitchRequest {
	return parseWithSchema(runtimeClineAccountSwitchRequestSchema, value);
}
