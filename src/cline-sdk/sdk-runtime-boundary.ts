// Centralize direct SDK runtime imports here.
// All native Cline session-host creation and persisted artifact reads should
// flow through this boundary so the rest of Kanban stays decoupled from the
// SDK package layout.

import type { ToolApprovalRequest, ToolApprovalResult } from "@clinebot/agents";
import { getClineDefaultSystemPrompt } from "@clinebot/agents";
import {
	buildWorkspaceMetadata,
	createSessionHost,
	createUserInstructionConfigWatcher,
	loadRulesForSystemPromptFromWatcher,
	resolveWorkflowSlashCommandFromWatcher,
	type SessionHost,
	type UserInstructionConfigWatcher,
} from "@clinebot/core/node";
import type { providers as ClineSdkProviders } from "@clinebot/llms";

export type ClineSdkSessionHost = SessionHost;
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

export type ClineSdkSessionEvent =
	| {
			type: "chunk";
			payload: {
				sessionId: string;
				stream: "stdout" | "stderr" | "agent";
				chunk: string;
				ts: number;
			};
	  }
	| {
			type: "agent_event";
			payload: {
				sessionId: string;
				event: ClineSdkAgentEvent;
			};
	  }
	| {
			type: "team_progress";
			payload: {
				sessionId: string;
				teamName: string;
				lifecycle: unknown;
				summary: unknown;
			};
	  }
	| {
			type: "ended";
			payload: {
				sessionId: string;
				reason: string;
				ts: number;
			};
	  }
	| {
			type: "hook";
			payload: {
				sessionId: string;
				hookEventName: "tool_call" | "tool_result" | "agent_end" | "session_shutdown";
				toolName?: string;
				toolInputSummary?: string;
				finalMessage?: string;
				notificationType?: string | null;
			};
	  }
	| {
			type: "status";
			payload: {
				sessionId: string;
				status: string;
			};
	  };

export type ClineSdkSessionRecord = Awaited<
	ReturnType<ClineSdkSessionHost["list"]>
>[number];
export type ClineSdkPersistedMessage = ClineSdkProviders.Message;
export type ClineSdkUserInstructionWatcher = UserInstructionConfigWatcher;
export type ClineSdkToolApprovalRequest = ToolApprovalRequest;
export type ClineSdkToolApprovalResult = ToolApprovalResult;

export async function createClineSdkSessionHost(): Promise<ClineSdkSessionHost> {
	return await createSessionHost({
		backendMode: "auto",
		autoStartRpcServer: true,
	});
}

export async function buildClineSdkWorkspaceMetadata(
	cwd: string,
): Promise<string> {
	return await buildWorkspaceMetadata(cwd);
}

export function createClineSdkUserInstructionWatcher(workspacePath: string): ClineSdkUserInstructionWatcher {
	return createUserInstructionConfigWatcher({
		skills: { workspacePath },
		rules: { workspacePath },
		workflows: { workspacePath },
	});
}

export function resolveClineSdkWorkflowSlashCommand(prompt: string, watcher: ClineSdkUserInstructionWatcher): string {
	return resolveWorkflowSlashCommandFromWatcher(prompt, watcher);
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
	const workspaceMetadata = shouldAppendWorkspaceMetadata
		? await buildWorkspaceMetadata(input.cwd)
		: "";
	return getClineDefaultSystemPrompt(
		"Kanban",
		input.cwd,
		workspaceMetadata,
		input.rules ?? "",
	);
}
