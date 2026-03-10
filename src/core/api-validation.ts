import { z } from "zod";

import {
	type RuntimeConfigSaveRequest,
	type RuntimeGitCheckoutRequest,
	type RuntimeHookIngestRequest,
	type RuntimeProjectAddRequest,
	type RuntimeProjectRemoveRequest,
	type RuntimeCommandRunRequest,
	type RuntimeShellSessionStartRequest,
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
	runtimeConfigSaveRequestSchema,
	runtimeGitCheckoutRequestSchema,
	runtimeHookIngestRequestSchema,
	runtimeProjectAddRequestSchema,
	runtimeProjectRemoveRequestSchema,
	runtimeCommandRunRequestSchema,
	runtimeShellSessionStartRequestSchema,
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
} from "./api-contract.js";

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
	return {
		...parsed,
		taskId,
		workspaceId,
	};
}

export function parseTerminalWsClientMessage(value: unknown): RuntimeTerminalWsClientMessage | null {
	const parsed = runtimeTerminalWsClientMessageSchema.safeParse(value);
	if (!parsed.success) {
		return null;
	}
	return parsed.data;
}
