// Translates raw SDK session events into Kanban summary and message mutations.
// Keep protocol-specific parsing here so the runtime and repository can stay
// focused on lifecycle, storage, and task-facing orchestration.
import type { RuntimeTaskSessionSummary } from "../core/api-contract.js";
import { formatClineToolCallLabel, getClineToolCallDisplay } from "./cline-tool-call-display.js";
import {
	appendAssistantChunk,
	appendReasoningChunk,
	canReturnToRunning,
	clearActiveTurnState,
	createAssistantMessage,
	createMessage,
	createReasoningMessage,
	finishToolCallMessage,
	isClineUserAttentionTool,
	latestAssistantMessageMatches,
	now,
	setOrCreateAssistantMessage,
	setOrCreateReasoningMessage,
	startToolCallMessage,
	type ClineTaskMessage,
	type ClineTaskSessionEntry,
	updateSummary,
} from "./cline-session-state.js";

export interface ApplyClineSessionEventInput {
	event: unknown;
	taskId: string;
	entry: ClineTaskSessionEntry;
	pendingTurnCancelTaskIds: Set<string>;
	emitSummary: (summary: RuntimeTaskSessionSummary) => void;
	emitMessage: (taskId: string, message: ClineTaskMessage) => void;
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
	if (!event || typeof event !== "object" || !("payload" in event)) {
		return null;
	}
	const payload = event.payload;
	if (!payload || typeof payload !== "object" || !("sessionId" in payload)) {
		return null;
	}
	return typeof payload.sessionId === "string" ? payload.sessionId : null;
}

// Translate raw SDK events into Kanban summary and chat mutations so the session service can stay focused on host ownership.
export function applyClineSessionEvent(input: ApplyClineSessionEventInput): void {
	const { entry, event, taskId } = input;

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "error"
	) {
		const errorMessage =
			"error" in event.payload.event ? extractAgentErrorMessage(event.payload.event.error) : null;
		const recoverable =
			"recoverable" in event.payload.event && typeof event.payload.event.recoverable === "boolean"
				? event.payload.event.recoverable
				: false;
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
						state: "failed",
						reviewReason: "error",
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
				notificationType: null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "content_start" &&
		"contentType" in event.payload.event &&
		event.payload.event.contentType === "text"
	) {
		const accumulated =
			"accumulated" in event.payload.event && typeof event.payload.event.accumulated === "string"
				? event.payload.event.accumulated
				: null;
		const text =
			"text" in event.payload.event && typeof event.payload.event.text === "string"
				? event.payload.event.text
				: null;
		if (typeof accumulated === "string") {
			const message =
				setOrCreateAssistantMessage(entry, taskId, accumulated) ?? createAssistantMessage(entry, taskId, accumulated);
			input.emitMessage(taskId, message);
		} else if (typeof text === "string" && text.length > 0) {
			input.emitMessage(taskId, appendAssistantChunk(entry, taskId, text));
		}
		const retainedToolActivity = getRetainedClineToolActivity(entry);
		emitSummary(input, {
			state: "running",
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: "Agent active",
				toolName: retainedToolActivity.toolName,
				toolInputSummary: retainedToolActivity.toolInputSummary,
				finalMessage: null,
				hookEventName: "assistant_delta",
				notificationType: null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "done"
	) {
		const finalText =
			"text" in event.payload.event && typeof event.payload.event.text === "string"
				? event.payload.event.text.trim()
				: "";
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

		const doneReason =
			"reason" in event.payload.event && typeof event.payload.event.reason === "string"
				? event.payload.event.reason
				: "completed";
		if (doneReason === "aborted" && input.pendingTurnCancelTaskIds.has(taskId)) {
			emitTurnCanceled(input);
			return;
		}

		const summaryPatch: Partial<RuntimeTaskSessionSummary> = {
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: finalText ? `Final: ${finalText}` : "Waiting for review",
				toolName: null,
				toolInputSummary: null,
				finalMessage: finalText || null,
				hookEventName: "agent_end",
				notificationType: null,
				source: "cline-sdk",
			},
		};
		if (doneReason === "aborted") {
			summaryPatch.state = "interrupted";
			summaryPatch.reviewReason = "interrupted";
		} else if (doneReason === "error") {
			summaryPatch.state = "failed";
			summaryPatch.reviewReason = "error";
		} else {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		}

		clearActiveTurnState(entry);
		emitSummary(input, summaryPatch);
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "content_start" &&
		"contentType" in event.payload.event &&
		event.payload.event.contentType === "reasoning"
	) {
		const reasoning =
			"reasoning" in event.payload.event && typeof event.payload.event.reasoning === "string"
				? event.payload.event.reasoning
				: null;
		if (reasoning && reasoning.length > 0) {
			input.emitMessage(taskId, appendReasoningChunk(entry, taskId, reasoning));
			emitSummary(input, {
				state: "running",
				lastOutputAt: now(),
			});
		}
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "content_end" &&
		"contentType" in event.payload.event &&
		event.payload.event.contentType === "reasoning"
	) {
		const reasoning =
			"reasoning" in event.payload.event && typeof event.payload.event.reasoning === "string"
				? event.payload.event.reasoning
				: null;
		if (reasoning) {
			const message =
				setOrCreateReasoningMessage(entry, taskId, reasoning) ?? createReasoningMessage(entry, taskId, reasoning);
			input.emitMessage(taskId, message);
		}
		entry.activeReasoningMessageId = null;
		emitSummary(input, {
			lastOutputAt: now(),
		});
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "content_start" &&
		"contentType" in event.payload.event &&
		event.payload.event.contentType === "tool"
	) {
		const toolName =
			"toolName" in event.payload.event && typeof event.payload.event.toolName === "string"
				? event.payload.event.toolName
				: null;
		const toolCallId =
			"toolCallId" in event.payload.event && typeof event.payload.event.toolCallId === "string"
				? event.payload.event.toolCallId
				: null;
		const toolInput = "input" in event.payload.event ? event.payload.event.input : undefined;
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
		if (isUserAttentionTool && entry.summary.state === "running") {
			summaryPatch.state = "awaiting_review";
			summaryPatch.reviewReason = "hook";
		} else if (!isUserAttentionTool && canReturnToRunning(entry.summary.reviewReason)) {
			summaryPatch.state = "running";
			summaryPatch.reviewReason = null;
		}
		emitSummary(input, summaryPatch);
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "content_end" &&
		"contentType" in event.payload.event &&
		event.payload.event.contentType === "tool"
	) {
		const toolName =
			"toolName" in event.payload.event && typeof event.payload.event.toolName === "string"
				? event.payload.event.toolName
				: null;
		const toolCallId =
			"toolCallId" in event.payload.event && typeof event.payload.event.toolCallId === "string"
				? event.payload.event.toolCallId
				: null;
		const toolOutput = "output" in event.payload.event ? event.payload.event.output : undefined;
		const toolError =
			"error" in event.payload.event && typeof event.payload.event.error === "string"
				? event.payload.event.error
				: null;
		const durationMs =
			"durationMs" in event.payload.event && typeof event.payload.event.durationMs === "number"
				? event.payload.event.durationMs
				: null;
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

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "agent_event" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"event" in event.payload &&
		event.payload.event &&
		typeof event.payload.event === "object" &&
		"type" in event.payload.event &&
		event.payload.event.type === "content_end" &&
		"contentType" in event.payload.event &&
		event.payload.event.contentType === "text"
	) {
		const text =
			"text" in event.payload.event && typeof event.payload.event.text === "string"
				? event.payload.event.text
				: null;
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

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "chunk" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"stream" in event.payload &&
		event.payload.stream === "agent" &&
		"chunk" in event.payload &&
		typeof event.payload.chunk === "string"
	) {
		const chunk = event.payload.chunk;
		if (chunk.length === 0 || isLikelySerializedAgentEventChunk(chunk)) {
			return;
		}
		input.emitMessage(taskId, appendAssistantChunk(entry, taskId, chunk));
		const retainedToolActivity = getRetainedClineToolActivity(entry);
		emitSummary(input, {
			state: "running",
			lastOutputAt: now(),
			lastHookAt: now(),
			latestHookActivity: {
				activityText: "Agent active",
				toolName: retainedToolActivity.toolName,
				toolInputSummary: retainedToolActivity.toolInputSummary,
				finalMessage: null,
				hookEventName: "assistant_delta",
				notificationType: null,
				source: "cline-sdk",
			},
		});
		return;
	}

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "hook" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object"
	) {
		const hookEventName =
			"hookEventName" in event.payload && typeof event.payload.hookEventName === "string"
				? event.payload.hookEventName
				: null;
		const toolName =
			"toolName" in event.payload && typeof event.payload.toolName === "string"
				? event.payload.toolName
				: null;
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

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "ended" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"reason" in event.payload &&
		typeof event.payload.reason === "string"
	) {
		const interrupted =
			event.payload.reason.includes("abort") || event.payload.reason.includes("interrupt");
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

	if (
		event &&
		typeof event === "object" &&
		"type" in event &&
		event.type === "status" &&
		"payload" in event &&
		event.payload &&
		typeof event.payload === "object" &&
		"status" in event.payload &&
		typeof event.payload.status === "string"
	) {
		if (event.payload.status !== "running") {
			clearActiveTurnState(entry);
		}
		emitSummary(input, {
			state: event.payload.status === "running" ? "running" : entry.summary.state,
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
