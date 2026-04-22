// Centralize direct SDK runtime imports here.
// All native Cline session-host creation and persisted artifact reads should
// flow through this boundary so the rest of Kanban stays decoupled from the
// SDK package layout.

import {
	type BasicLogger,
	buildWorkspaceMetadata,
	ClineCore,
	type ClineCoreStartInput,
	type CoreSessionEvent,
	createUserInstructionConfigWatcher,
	getClineDefaultSystemPrompt,
	listAvailableRuntimeCommandsFromWatcher,
	loadRulesForSystemPromptFromWatcher,
	resolveClineDataDir,
	resolveRuntimeSlashCommandFromWatcher,
	type SessionHistoryRecord,
	type SessionHost,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type UserInstructionConfigWatcher,
} from "@clinebot/core";
import type { MessageWithMetadata } from "@clinebot/shared";
import { CLINE_BUILTIN_SLASH_COMMANDS } from "./cline-slash-commands";
import { getCliTelemetryService } from "./cline-telemetry-service";

export { TelemetryLoggerSink, TelemetryService } from "@clinebot/core";

export type ClineSdkSessionHost = SessionHost;
export type ClineSdkBasicLogger = BasicLogger;
export interface ClineSdkContentStartTextEvent {
	type: "content_start";
	contentType: "text";
	text?: string;
	accumulated?: string;
}

export interface ClineSdkContentStartReasoningEvent {
	type: "content_start";
	contentType: "reasoning";
	reasoning?: string;
	redacted?: boolean;
}

export interface ClineSdkContentStartToolEvent {
	type: "content_start";
	contentType: "tool";
	toolName?: string;
	toolCallId?: string;
	input?: unknown;
}

export interface ClineSdkContentEndTextEvent {
	type: "content_end";
	contentType: "text";
	text?: string;
}

export interface ClineSdkContentEndReasoningEvent {
	type: "content_end";
	contentType: "reasoning";
	reasoning?: string;
}

export interface ClineSdkContentEndToolEvent {
	type: "content_end";
	contentType: "tool";
	toolName?: string;
	toolCallId?: string;
	output?: unknown;
	error?: string;
	durationMs?: number;
}

export interface ClineSdkIterationStartEvent {
	type: "iteration_start";
	iteration: number;
}

export interface ClineSdkIterationEndEvent {
	type: "iteration_end";
	iteration: number;
	hadToolCalls: boolean;
	toolCallCount: number;
}

export interface ClineSdkUsageEvent {
	type: "usage";
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	cost?: number;
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCost?: number;
}

export interface ClineSdkNoticeEvent {
	type: "notice";
	noticeType: "recovery";
	message: string;
	displayRole?: "system" | "status";
	reason?: "api_error" | "invalid_tool_call" | "tool_execution_failed";
	metadata?: Record<string, unknown>;
}

export interface ClineSdkDoneEvent {
	type: "done";
	reason: "completed" | "aborted" | "error";
	text: string;
	iterations: number;
	usage?: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		cost?: number;
	};
}

export interface ClineSdkErrorEvent {
	type: "error";
	error: Error;
	recoverable: boolean;
	iteration: number;
	/** Fallback message field — used for credit-limit detection when `error` does not contain parseable text. */
	message?: string;
}

export type ClineSdkAgentEvent =
	| ClineSdkContentStartTextEvent
	| ClineSdkContentStartReasoningEvent
	| ClineSdkContentStartToolEvent
	| ClineSdkContentEndTextEvent
	| ClineSdkContentEndReasoningEvent
	| ClineSdkContentEndToolEvent
	| ClineSdkIterationStartEvent
	| ClineSdkIterationEndEvent
	| ClineSdkUsageEvent
	| ClineSdkNoticeEvent
	| ClineSdkDoneEvent
	| ClineSdkErrorEvent;

export type ClineSdkSessionEvent = CoreSessionEvent;

export type ClineSdkStartSessionInput = ClineCoreStartInput;
export type ClineSdkSessionRecord = SessionHistoryRecord;
export type ClineSdkPersistedMessage = MessageWithMetadata;
export type ClineSdkUserInstructionWatcher = UserInstructionConfigWatcher;
export interface ClineSdkSlashCommand {
	name: string;
	instructions: string;
	description?: string;
}
export type ClineSdkToolApprovalRequest = ToolApprovalRequest;
export type ClineSdkToolApprovalResult = ToolApprovalResult;

export async function createClineSdkSessionHost(): Promise<ClineSdkSessionHost> {
	return await ClineCore.create({
		backendMode: "auto",
		telemetry: getCliTelemetryService(),
	});
}

export function resolveClineSdkDataDir(): string {
	return resolveClineDataDir();
}
export async function buildClineSdkWorkspaceMetadata(cwd: string): Promise<string> {
	return await buildWorkspaceMetadata(cwd);
}

export function createClineSdkUserInstructionWatcher(workspacePath: string): ClineSdkUserInstructionWatcher {
	return createUserInstructionConfigWatcher({
		skills: { workspacePath },
		rules: { workspacePath },
		workflows: { workspacePath },
	});
}

export function listClineSdkWorkflowSlashCommands(watcher?: ClineSdkUserInstructionWatcher): ClineSdkSlashCommand[] {
	const builtIns: ClineSdkSlashCommand[] = CLINE_BUILTIN_SLASH_COMMANDS.map((command) => ({
		name: command.name,
		instructions: "",
		description: command.description,
	}));
	if (!watcher) {
		return builtIns;
	}
	const byName = new Map<string, ClineSdkSlashCommand>();
	for (const command of builtIns) {
		byName.set(command.name, command);
	}
	for (const command of listAvailableRuntimeCommandsFromWatcher(watcher)) {
		if (byName.has(command.name)) {
			continue;
		}
		byName.set(command.name, {
			name: command.name,
			instructions: command.instructions,
			description: command.kind === "workflow" ? "Workflow command" : "Skill command",
		});
	}
	return [...byName.values()];
}

export function resolveClineSdkWorkflowSlashCommand(prompt: string, watcher: ClineSdkUserInstructionWatcher): string {
	return resolveRuntimeSlashCommandFromWatcher(prompt, watcher);
}

export function loadClineSdkRulesForSystemPrompt(watcher: ClineSdkUserInstructionWatcher): string {
	return loadRulesForSystemPromptFromWatcher(watcher);
}

export async function resolveClineSdkSystemPrompt(input: {
	cwd: string;
	providerId: string;
	rules?: string;
}): Promise<string> {
	// The Cline SDK can run against non-Cline providers too, but only the
	// "cline" provider expects the extra workspace metadata block that powers
	// its repo-aware behavior in the same way the official CLI does.
	const shouldAppendWorkspaceMetadata = input.providerId === "cline";
	const workspaceMetadata = shouldAppendWorkspaceMetadata ? await buildWorkspaceMetadata(input.cwd) : "";
	return getClineDefaultSystemPrompt({
		ide: "Kanban",
		rootPath: input.cwd,
		providerId: input.providerId,
		metadata: workspaceMetadata,
		rules: input.rules ?? "",
	});
}
