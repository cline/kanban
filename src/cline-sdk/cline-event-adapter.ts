// Translates raw SDK session events into Kanban summary and message mutations.
// Keep protocol-specific parsing here so the runtime and repository can stay
// focused on lifecycle, storage, and task-facing orchestration.
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import {
	appendAssistantChunk,
	appendReasoningChunk,
	type ClineTaskMessage,
	type ClineTaskSessionEntry,
	canReturnToRunning,
	clearActiveTurnState,
	createAssistantMessage,
	createMessage,
	createReasoningMessage,
	finishToolCallMessage,
	isClineUserAttentionTool,
	isCreditLimitError,
	latestAssistantMessageMatches,
	now,
	setOrCreateAssistantMessage,
	setOrCreateReasoningMessage,
	startToolCallMessage,
	updateSummary,
} from "./cline-session-state";
import { formatClineToolCallLabel, getClineToolCallDisplay } from "./cline-tool-call-display";
import type { ClineSdkAgentEvent, ClineSdkSessionEvent } from "./sdk-runtime-boundary";

function normalizePreviewText(value: string | null | undefined): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized || null;
}

function toPreviewText(value: string | null | undefined, maxLength = 160): string | null {
	const normalized = normalizePreviewText(value);
	if (!normalized) {
		return null;
	}
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1).trimEnd()}…` : normalized;
}

export interface ApplyClineSessionEventInput {
	event: unknown;
	taskId: string;
	entry: ClineTaskSessionEntry;
	pendingTurnCancelTaskIds: Set<string>;
	isClineProvider: boolean;
	emitSummary: (summary: RuntimeTaskSessionSummary) => void;
	emitMessage: (taskId: string, message: ClineTaskMessage) => void;
}

type ClineSdkChunkEvent = Extract<ClineSdkSessionEvent, { type: "chunk" }>;
type ClineSdkHookEvent = Extract<ClineSdkSessionEvent, { type: "hook" }>;
type ClineSdkEndedEvent = Extract<ClineSdkSessionEvent, { type: "ended" }>;
type ClineSdkStatusEvent = Extract<ClineSdkSessionEvent, { type: "status" }>;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readAgentEvent(event: unknown): ClineSdkAgentEvent | null {
	const record = asRecord(event);
	if (!record || record.type !== "agent_event") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload) {
		return null;
	}
	const agentEvent = asRecord(payload.event);
	if (!agentEvent || typeof agentEvent.type !== "string") {
		return null;
	}
	return agentEvent as unknown as ClineSdkAgentEvent;
}

function readChunkEvent(event: unknown): ClineSdkChunkEvent | null {
	const record = asRecord(event);
	if (!record || record.type !== "chunk") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string" || typeof payload.chunk !== "string") {
		return null;
	}
	if (payload.stream !== "stdout" && payload.stream !== "stderr" && payload.stream !== "agent") {
		return null;
	}
	return { type: "chunk", payload: payload as ClineSdkChunkEvent["payload"] };
}

function readHookEvent(event: unknown): ClineSdkHookEvent | null {
	const record = asRecord(event);
	if (!record || record.type !== "hook") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string") {
		return null;
	}
	return { type: "hook", payload: payload as ClineSdkHookEvent["payload"] };
}

function readEndedEvent(event: unknown): ClineSdkEndedEvent | null {
	const record = asRecord(event);
	if (!record || record.type !== "ended") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string" || typeof payload.reason !== "string") {
		return null;
	}
	return { type: "ended", payload: payload as ClineSdkEndedEvent["payload"] };
}

function readStatusEvent(event: unknown): ClineSdkStatusEvent | null {
	const record = asRecord(event);
	if (!record || record.type !== "status") {
		return null;
	}
	const payload = asRecord(record.payload);
	if (!payload || typeof payload.sessionId !== "string" || typeof payload.status !== "string") {
		return null;
	}
	return { type: "status", payload: payload as ClineSdkStatusEvent["payload"] };
}

function getRetainedClineToolActivity(entry: ClineTaskSessionEntry): {
	toolName: string | null;
	toolInputSummary: string | null;
} {
	const latestHookActivity = entry.summary.latestHookActivity;
	if (!latestHookActivity || latestHookActivity.source !== "cline-sdk" || !latestHookActivity.toolName) {
		return {
			toolName: null,
			toolInputSummary: null,
		};
	}

	return {
		toolName: latestHookActivity.toolName,
		toolInputSummary: latestHookActivity.toolInputSummary ?? null,
	};
}

function extractAgentErrorMessage(error: unknown): string | null {
	if (typeof error === "string") {
		const normalized = error.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (error instanceof Error) {
		const normalized = error.message.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		const normalized = error.message.trim();
		return normalized.length > 0 ? normalized : null;
	}
	return null;
}

export function extractClineSessionId(event: unknown): string | null {
	const record = asRecord(event);
	if (!record) {
		return null;
	}
	const payload = asRecord(record.payload);
	return payload && typeof payload.sessionId === "string" ? payload.sessionId : null;
}

// Translate raw SDK events into Kanban summary and chat mutations so the session service can stay focused on host ownership.
export function applyClineSessionEvent(input: ApplyClineSessionEventInput): void {
	const { entry, event, taskId } = input;
	const agentEvent = readAgentEvent(event);
	const chunkEvent = readChunkEvent(event);
	const hookEvent = readHookEvent(event);
	const endedEvent = readEndedEvent(event);
	const statusEvent = readStatusEvent(event);

	if (agentEvent?.type === "error") {
		const errorMessage = "error" in agentEvent ? extractAgentErrorMessage(agentEvent.error) : null;
		const rawMessage = typeof agentEvent.message === "string" ? agentEvent.message.trim() || null : null;
		const creditLimitSource = errorMessage ?? rawMessage;
		const sdkRecoverable = typeof agentEvent.recoverable === "boolean" ? agentEvent.recoverable : false;
		const creditLimitError = input.isClineProvider && isCreditLimitError(creditLimitSource);
		const recoverable = sdkRecoverable && !creditLimitError;
		const retainedToolActivity = getRetainedClineToolActivity(entry);
		if (!recoverable) {
			clearActiveTurnState(entry);
		}
		if (recoverable && errorMessage) {
			const retryMsg = createMessage(taskId, "system", `Retrying: ${errorMessage}`);
			entry.messages.push(retryMsg);
			input.emitMessage(taskId, retryMsg);
		}
		emitSummary(input, {
			...(recoverable
				? {}
				: {
						state: "awaiting_review",
						reviewReason: "error",
						warningMessage: creditLimitError ? null : (errorMessage ?? "Unknown agent error"),
					}),
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: recoverable
					? `Retrying after error: ${errorMessage ?? "Unknown agent error"}`
					: `Agent error: ${errorMessage ?? "Unknown agent error"}`,
				toolName: retainedToolActivity.toolName,
				toolInputSummary: retainedToolActivity.toolInputSummary,
				finalMessage: recoverable ? null : (errorMessage ?? "Unknown agent error"),
				hookEventName: "agent_error",
				notificationType: creditLimitError ? "credit_limit" : null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (agentEvent?.type === "content_start" && agentEvent.contentType === "text") {
		const accumulated = typeof agentEvent.accumulated === "string" ? agentEvent.accumulated : null;
		const text = typeof agentEvent.text === "string" ? agentEvent.text : null;
		if (typeof accumulated === "string") {
			const message =
				setOrCreateAssistantMessage(entry, taskId, accumulated) ??
				createAssistantMessage(entry, taskId, accumulated);
			input.emitMessage(taskId, message);
		} else if (typeof text === "string" && text.length > 0) {
			input.emitMessage(taskId, appendAssistantChunk(entry, taskId, text));
		}
		const fullPreviewText = normalizePreviewText(accumulated ?? text);
		const previewText = toPreviewText(fullPreviewText);
		const retainedToolActivity = getRetainedClineToolActivity(entry);
		emitSummary(input, {
			state: "running",
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: previewText ?? "Agent active",
				toolName: retainedToolActivity.toolName,
				toolInputSummary: retainedToolActivity.toolInputSummary,
				finalMessage: fullPreviewText,
				hookEventName: "assistant_delta",
				notificationType: null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (agentEvent?.type === "notice") {
		const message = typeof agentEvent.message === "string" ? agentEvent.message.trim() : "";
		const noticeReason: string | null = typeof agentEvent.reason === "string" ? agentEvent.reason : null;
		if (input.isClineProvider && isCreditLimitError(message) && noticeReason === "recovery") {
			return;
		}
		if (message) {
			const displayRole = typeof agentEvent.displayRole === "string" ? agentEvent.displayRole : "system";
			const reason = typeof agentEvent.reason === "string" ? agentEvent.reason : null;
			const noticeType = typeof agentEvent.noticeType === "string" ? agentEvent.noticeType : null;
			const normalizedRole = displayRole === "status" ? "status" : "system";
			const noticeMessage = createMessage(taskId, normalizedRole, message);
			noticeMessage.meta = {
				hookEventName: "agent_notice",
				messageKind: noticeType,
				displayRole,
				reason,
			};
			entry.messages.push(noticeMessage);
			input.emitMessage(taskId, noticeMessage);
		}
		return;
	}

	if (agentEvent?.type === "done") {
		const finalText = typeof agentEvent.text === "string" ? agentEvent.text.trim() : "";
		if (finalText) {
			const message = setOrCreateAssistantMessage(entry, taskId, finalText);
			if (message) {
				input.emitMessage(taskId, message);
			} else if (!latestAssistantMessageMatches(entry, finalText)) {
				const assistantMessage = createMessage(taskId, "assistant", finalText);
				entry.messages.push(assistantMessage);
				input.emitMessage(taskId, assistantMessage);
			}
		}

		const doneReason = typeof agentEvent.reason === "string" ? agentEvent.reason : "completed";
		if (doneReason === "aborted" && input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}

		const previousHookActivity = entry.summary.latestHookActivity;
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: finalText ? `Final: ${finalText}` : (previousHookActivity?.activityText ?? null),
				toolName: previousHookActivity?.toolName ?? null,
				toolInputSummary: previousHookActivity?.toolInputSummary ?? null,
				finalMessage: finalText || (previousHookActivity?.finalMessage ?? null),
				hookEventName: "agent_end",
				notificationType: previousHookActivity?.notificationType ?? null,
				source: "cline-sdk",
			},
		};
		if (doneReason === "aborted") {
			summaryPatch.state = "interrupted";
			summaryPatch.reviewReason = "interrupted";
		} else if (doneReason === "error") {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "error";
		} else {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		}

		clearActiveTurnState(entry);
		emitSummary(input, summaryPatch);
		return;
	}

	if (agentEvent?.type === "content_start" && agentEvent.contentType === "reasoning") {
		const reasoning = typeof agentEvent.reasoning === "string" ? agentEvent.reasoning : null;
		if (reasoning && reasoning.length > 0) {
			input.emitMessage(taskId, appendReasoningChunk(entry, taskId, reasoning));
			emitSummary(input, {
				state: "running",
				lastOutputAt: now(),
			});
		}
		return;
	}

	if (agentEvent?.type === "content_end" && agentEvent.contentType === "reasoning") {
		const reasoning = typeof agentEvent.reasoning === "string" ? agentEvent.reasoning : null;
		if (reasoning) {
			const message =
				setOrCreateReasoningMessage(entry, taskId, reasoning) ??
				createReasoningMessage(entry, taskId, reasoning, "reasoning_end");
			input.emitMessage(taskId, message);
		}
		entry.activeReasoningMessageId = null;
		emitSummary(input, {
			lastOutputAt: now(),
		});
		return;
	}

	if (agentEvent?.type === "content_start" && agentEvent.contentType === "tool") {
		const toolName = typeof agentEvent.toolName === "string" ? agentEvent.toolName : null;
		const toolCallId = typeof agentEvent.toolCallId === "string" ? agentEvent.toolCallId : null;
		const toolInput = agentEvent.input;
		const toolDisplay = getClineToolCallDisplay(toolName, toolInput);
		const isUserAttentionTool = isClineUserAttentionTool(toolName);
		input.emitMessage(
			taskId,
			startToolCallMessage(entry, taskId, {
				toolName,
				toolCallId,
				input: toolInput,
			}),
		);
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: `Using ${formatClineToolCallLabel(toolDisplay.toolName, toolDisplay.inputSummary)}`,
				toolName: toolDisplay.toolName,
				toolInputSummary: toolDisplay.inputSummary,
				finalMessage: null,
				hookEventName: "tool_call",
				notificationType: isUserAttentionTool ? "user_attention" : null,
				source: "cline-sdk",
			},
		};
		if (isUserAttentionTool && (entry.summary.state === "running" || entry.summary.state === "idle")) {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		} else if (!isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, summaryPatch);
		return;
	}

	if (agentEvent?.type === "content_end" && agentEvent.contentType === "tool") {
		const toolName = typeof agentEvent.toolName === "string" ? agentEvent.toolName : null;
		const toolCallId = typeof agentEvent.toolCallId === "string" ? agentEvent.toolCallId : null;
		const toolOutput = agentEvent.output;
		const toolError = typeof agentEvent.error === "string" ? agentEvent.error : null;
		const durationMs = typeof agentEvent.durationMs === "number" ? agentEvent.durationMs : null;
		const toolInput = toolCallId ? entry.toolInputByToolCallId.get(toolCallId) : undefined;
		const toolDisplay = getClineToolCallDisplay(toolName, toolInput);
		const isUserAttentionTool = isClineUserAttentionTool(toolName);
		input.emitMessage(
			taskId,
			finishToolCallMessage(entry, taskId, {
				toolName,
				toolCallId,
				output: toolOutput,
				error: toolError,
				durationMs,
			}),
		);
		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: `${toolError ? "Failed" : "Completed"} ${formatClineToolCallLabel(toolDisplay.toolName, toolDisplay.inputSummary)}`,
				toolName: toolDisplay.toolName,
				toolInputSummary: toolDisplay.inputSummary,
				finalMessage: null,
				hookEventName: "tool_result",
				notificationType: null,
				source: "cline-sdk",
			},
		};
		if (isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, summaryPatch);
		return;
	}

	if (agentEvent?.type === "content_end" && agentEvent.contentType === "text") {
		const text = typeof agentEvent.text === "string" ? agentEvent.text : null;
		if (text) {
			const message =
				setOrCreateAssistantMessage(entry, taskId, text) ?? createAssistantMessage(entry, taskId, text);
			input.emitMessage(taskId, message);
		}
		entry.activeAssistantMessageId = null;
		emitSummary(input, {
			lastOutputAt: now(),
		});
		return;
	}

	if (chunkEvent?.payload.stream === "agent") {
		const chunk = chunkEvent.payload.chunk;
		if (chunk.length === 0 || isLikelySerializedAgentEventChunk(chunk)) {
			return;
		}
		input.emitMessage(taskId, appendAssistantChunk(entry, taskId, chunk));
		const fullPreviewText = normalizePreviewText(chunk);
		const previewText = toPreviewText(fullPreviewText);
		const retainedToolActivity = getRetainedClineToolActivity(entry);
		emitSummary(input, {
			state: "running",
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: previewText ?? "Agent active",
				toolName: retainedToolActivity.toolName,
				toolInputSummary: retainedToolActivity.toolInputSummary,
				finalMessage: fullPreviewText,
				hookEventName: "assistant_delta",
				notificationType: null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (hookEvent) {
		const hookEventName =
			typeof hookEvent.payload.hookEventName === "string" ? hookEvent.payload.hookEventName : null;
		const toolName = typeof hookEvent.payload.toolName === "string" ? hookEvent.payload.toolName : null;
		const activityText = hookEventName && toolName ? `${hookEventName}: ${toolName}` : hookEventName;
		emitSummary(input, {
			lastHookAt: now(),
			latestHookActivity: {
				activityText,
				toolName,
				toolInputSummary: null,
				finalMessage: null,
				hookEventName,
				notificationType: null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (endedEvent) {
		const interrupted =
			endedEvent.payload.reason.includes("abort") || endedEvent.payload.reason.includes("interrupt");
		if (interrupted && input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}
		clearActiveTurnState(entry);
		emitSummary(input, {
			state: interrupted ? "interrupted" : "awaiting_review",
			reviewReason: interrupted ? "interrupted" : "exit",
			lastOutputAt: now(),
		});
		return;
	}

	if (statusEvent) {
		if (statusEvent.payload.status !== "running") {
			clearActiveTurnState(entry);
		}
		emitSummary(input, {
			state:
				statusEvent.payload.status === "running" &&
				!(entry.summary.state === "awaiting_review" && canReturnToRunning(entry.summary.reviewReason))
					? "running"
					: entry.summary.state,
			lastOutputAt: now(),
		});
	}
}

function emitSummary(input: ApplyClineSessionEventInput, patch: Partial<RuntimeTaskSessionSummary>): void {
	input.emitSummary(updateSummary(input.entry, patch));
}

function emitTurnCanceled(input: ApplyClineSessionEventInput): void {
	input.pendingTurnCancelTaskIds.delete(input.taskId);
	clearActiveTurnState(input.entry);
	emitSummary(input, {
		state: "idle",
		reviewReason: null,
		lastOutputAt: now(),
		lastHookAt: now(),
		latestHookActivity: {
			activityText: "Turn canceled",
			toolName: null,
			toolInputSummary: null,
			finalMessage: null,
			hookEventName: "turn_canceled",
			notificationType: null,
			source: "cline-sdk",
		},
	});
}

function isLikelySerializedAgentEventChunk(chunk: string): boolean {
	const trimmed = chunk.trim();
	if (!trimmed) {
		return false;
	}
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
		return false;
	}
	try {
		const parsed = JSON.parse(trimmed);
		return Boolean(parsed && typeof parsed === "object" && "type" in parsed);
	} catch {
		return false;
	}
}
