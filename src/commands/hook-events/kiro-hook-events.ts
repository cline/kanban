import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../../core/api-contract";
import { asRecord, normalizeWhitespace, readNestedString, readStringField } from "./hook-utils";

interface NormalizeKiroHookMetadataArgs {
	event: RuntimeHookEvent;
	payload: Record<string, unknown> | null;
	flagMetadata: Partial<RuntimeTaskHookActivity>;
	sourceHint?: string | null;
}

function extractKiroToolInput(payload: Record<string, unknown> | null): Record<string, unknown> | null {
	if (!payload) {
		return null;
	}
	const preTool = asRecord(payload.preToolUse);
	const preInput = preTool ? asRecord(preTool.input) : null;
	if (preInput) {
		return preInput;
	}
	const direct = asRecord(payload.tool_input);
	if (direct) {
		return direct;
	}
	const directCamel = asRecord(payload.toolInput);
	if (directCamel) {
		return directCamel;
	}
	const preParams = preTool ? asRecord(preTool.parameters) : null;
	if (preParams) {
		return preParams;
	}
	const postTool = asRecord(payload.postToolUse);
	const postInput = postTool ? asRecord(postTool.input) : null;
	if (postInput) {
		return postInput;
	}
	const postParams = postTool ? asRecord(postTool.parameters) : null;
	if (postParams) {
		return postParams;
	}
	const input = asRecord(payload.input);
	if (input) {
		return input;
	}
	const output = asRecord(payload.output);
	const outputArgs = output ? asRecord(output.args) : null;
	return outputArgs;
}

function summarizeOperationInput(value: Record<string, unknown>): string | null {
	const operationPath =
		readStringField(value, "path") ?? readStringField(value, "file_path") ?? readStringField(value, "filePath");
	if (operationPath) {
		return operationPath;
	}
	const operationMode = readStringField(value, "mode");
	if (operationMode) {
		return operationMode;
	}
	return null;
}

function summarizeKiroToolInputValue(value: unknown): string | null {
	if (typeof value === "string") {
		const summary = normalizeWhitespace(value);
		return summary.length > 0 ? summary.slice(0, 200) : null;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (Array.isArray(value)) {
		const summarizedItems = value
			.map((item) => summarizeKiroToolInputValue(item))
			.filter((item): item is string => Boolean(item));
		if (summarizedItems.length === 0) {
			return null;
		}
		const first = summarizedItems[0];
		return summarizedItems.length > 1 ? `${first} (+${summarizedItems.length - 1} more)` : first;
	}
	const record = asRecord(value);
	if (!record) {
		return null;
	}

	const filePath =
		readStringField(record, "file_path") ?? readStringField(record, "filePath") ?? readStringField(record, "path");
	if (filePath) {
		const startLine = Number.isInteger(record.start_line) ? Number(record.start_line) : null;
		const endLine = Number.isInteger(record.end_line) ? Number(record.end_line) : null;
		if (startLine !== null || endLine !== null) {
			const start = startLine ?? 1;
			const end = endLine ?? "EOF";
			return `${filePath}:${start}-${end}`;
		}
		return filePath;
	}

	const command =
		readStringField(record, "command") ??
		readStringField(record, "cmd") ??
		readStringField(record, "query") ??
		readStringField(record, "description") ??
		readStringField(record, "sql");
	if (command) {
		return command.slice(0, 200);
	}

	const operations = record.operations;
	if (Array.isArray(operations)) {
		const operationSummaries = operations
			.map((operation) => {
				const operationRecord = asRecord(operation);
				if (operationRecord) {
					return summarizeOperationInput(operationRecord) ?? summarizeKiroToolInputValue(operationRecord);
				}
				return summarizeKiroToolInputValue(operation);
			})
			.filter((item): item is string => Boolean(item));
		if (operationSummaries.length > 0) {
			const first = operationSummaries[0];
			return operationSummaries.length > 1 ? `${first} (+${operationSummaries.length - 1} more)` : first;
		}
	}

	const requests = record.requests;
	if (Array.isArray(requests)) {
		const requestSummaries = requests
			.map((request) => summarizeKiroToolInputValue(request))
			.filter((item): item is string => Boolean(item));
		if (requestSummaries.length > 0) {
			const first = requestSummaries[0];
			return requestSummaries.length > 1 ? `${first} (+${requestSummaries.length - 1} more)` : first;
		}
	}

	const nestedInput =
		asRecord(record.input) ??
		asRecord(record.parameters) ??
		asRecord(record.tool_input) ??
		asRecord(record.toolInput);
	if (nestedInput) {
		const nestedSummary = summarizeKiroToolInputValue(nestedInput);
		if (nestedSummary) {
			return nestedSummary;
		}
	}

	for (const candidate of Object.values(record)) {
		const summary = summarizeKiroToolInputValue(candidate);
		if (summary) {
			return summary;
		}
	}
	return null;
}

function inferKiroToolInputSummary(payload: Record<string, unknown> | null): string | null {
	const toolInput = extractKiroToolInput(payload);
	if (!toolInput) {
		return null;
	}
	return summarizeKiroToolInputValue(toolInput);
}

function inferKiroToolName(payload: Record<string, unknown> | null): string | null {
	if (!payload) {
		return null;
	}
	return (
		readStringField(payload, "tool_name") ??
		readStringField(payload, "toolName") ??
		readNestedString(payload, ["preToolUse", "tool"]) ??
		readNestedString(payload, ["preToolUse", "toolName"]) ??
		readNestedString(payload, ["postToolUse", "tool"]) ??
		readNestedString(payload, ["postToolUse", "toolName"]) ??
		readNestedString(payload, ["input", "tool"]) ??
		readNestedString(payload, ["input", "toolName"])
	);
}

function inferKiroHookEventName(payload: Record<string, unknown> | null): string | null {
	if (!payload) {
		return null;
	}
	return (
		readStringField(payload, "hook_event_name") ??
		readStringField(payload, "hookEventName") ??
		readStringField(payload, "hookName")
	);
}

function inferKiroNotificationType(payload: Record<string, unknown> | null): string | null {
	if (!payload) {
		return null;
	}
	return (
		readStringField(payload, "notification_type") ??
		readStringField(payload, "notificationType") ??
		readNestedString(payload, ["event", "type"]) ??
		readNestedString(payload, ["notification", "event"])
	);
}

function inferKiroFinalMessage(payload: Record<string, unknown> | null): string | null {
	if (!payload) {
		return null;
	}
	return (
		readStringField(payload, "assistant_response") ??
		readStringField(payload, "assistantResponse") ??
		readStringField(payload, "last_assistant_message") ??
		readStringField(payload, "lastAssistantMessage") ??
		readStringField(payload, "last-assistant-message") ??
		readNestedString(payload, ["taskComplete", "taskMetadata", "result"]) ??
		readNestedString(payload, ["taskComplete", "result"])
	);
}

function describeKiroToolOperation(toolName: string | null, toolInputSummary: string | null): string | null {
	if (!toolName) {
		return null;
	}
	if (!toolInputSummary) {
		return toolName;
	}
	return `${toolName}: ${toolInputSummary}`;
}

function inferKiroActivityText(
	event: RuntimeHookEvent,
	hookEventName: string | null,
	toolName: string | null,
	toolInputSummary: string | null,
	finalMessage: string | null,
	notificationType: string | null,
): string | null {
	const normalizedHookEvent = hookEventName?.toLowerCase() ?? "";
	const toolOperation = describeKiroToolOperation(toolName, toolInputSummary);

	if (normalizedHookEvent === "pretooluse" || normalizedHookEvent === "beforetool") {
		return toolOperation ? `Using ${toolOperation}` : "Using tool";
	}
	if (normalizedHookEvent === "posttooluse" || normalizedHookEvent === "aftertool") {
		return toolOperation ? `Completed ${toolOperation}` : "Completed tool";
	}
	if (normalizedHookEvent === "posttoolusefailure") {
		return toolOperation ? `Failed ${toolOperation}` : "Tool failed";
	}
	if (normalizedHookEvent === "permissionrequest") {
		return "Waiting for approval";
	}
	if (normalizedHookEvent === "userpromptsubmit" || normalizedHookEvent === "beforeagent") {
		return "Resumed after user input";
	}
	if (
		normalizedHookEvent === "stop" ||
		normalizedHookEvent === "subagentstop" ||
		normalizedHookEvent === "afteragent" ||
		normalizedHookEvent === "taskcomplete"
	) {
		return finalMessage ? `Final: ${finalMessage}` : null;
	}

	if (notificationType === "permission_prompt" || notificationType === "permission.asked") {
		return "Waiting for approval";
	}
	if (notificationType === "user_attention") {
		return null;
	}

	if (event === "to_in_progress") {
		return "Agent active";
	}
	return null;
}

export function normalizeKiroHookMetadata({
	event,
	payload,
	flagMetadata,
	sourceHint,
}: NormalizeKiroHookMetadataArgs): Partial<RuntimeTaskHookActivity> | undefined {
	const inferredHookEventName = inferKiroHookEventName(payload);
	const inferredToolName = inferKiroToolName(payload);
	const inferredToolInputSummary = inferKiroToolInputSummary(payload);
	const inferredNotificationType = inferKiroNotificationType(payload);
	const inferredFinalMessage = inferKiroFinalMessage(payload);
	const hookEventName = flagMetadata.hookEventName ?? inferredHookEventName ?? null;
	const toolName = flagMetadata.toolName ?? inferredToolName ?? null;
	const toolInputSummary = inferredToolInputSummary;
	const notificationType = flagMetadata.notificationType ?? inferredNotificationType ?? null;
	const finalMessage = flagMetadata.finalMessage ?? inferredFinalMessage ?? null;
	const activityText = inferKiroActivityText(
		event,
		hookEventName,
		toolName,
		toolInputSummary,
		finalMessage,
		notificationType,
	);

	const merged: Partial<RuntimeTaskHookActivity> = {
		source: flagMetadata.source ?? sourceHint ?? "kiro",
		hookEventName,
		toolName,
		notificationType,
		finalMessage: finalMessage ? normalizeWhitespace(finalMessage) : null,
		activityText: flagMetadata.activityText ?? (activityText ? normalizeWhitespace(activityText) : null),
	};

	const hasValue = Object.values(merged).some((value) => typeof value === "string" && value.trim().length > 0);
	if (!hasValue) {
		return undefined;
	}

	return merged;
}
