import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../core/api-contract";

export interface PiMappedSessionEvent {
	event: RuntimeHookEvent;
	metadata?: Partial<RuntimeTaskHookActivity>;
}

export interface PiSessionLogInfo {
	path: string;
	size: number;
	mtimeMs: number;
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/gu, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return null;
	}
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") {
		return null;
	}
	const normalized = normalizeWhitespace(value);
	return normalized.length > 0 ? normalized : null;
}

function readPiTextContent(value: unknown): string | null {
	if (!Array.isArray(value)) {
		return null;
	}
	const parts = value
		.map((entry) => {
			const record = asRecord(entry);
			if (!record || record.type !== "text") {
				return null;
			}
			return readStringField(record, "text");
		})
		.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
	if (parts.length === 0) {
		return null;
	}
	return normalizeWhitespace(parts.join("\n\n"));
}

function hasPiFinalAnswerTextBlock(value: unknown): boolean {
	if (!Array.isArray(value)) {
		return false;
	}
	return value.some((entry) => {
		const record = asRecord(entry);
		if (!record || record.type !== "text") {
			return false;
		}
		const signature = readStringField(record, "textSignature");
		if (!signature) {
			return false;
		}
		const parsedSignature = parseJsonObject(signature);
		return parsedSignature?.phase === "final_answer";
	});
}

function summarizePiToolArgs(toolName: string, args: Record<string, unknown> | null): string | null {
	if (!args) {
		return null;
	}
	const command = readStringField(args, "command") ?? readStringField(args, "cmd") ?? readStringField(args, "query");
	if (command) {
		return command;
	}
	const path =
		readStringField(args, "path") ?? readStringField(args, "filePath") ?? readStringField(args, "file_path");
	if (path) {
		return path;
	}
	const url = readStringField(args, "url");
	if (url) {
		return url;
	}
	return toolName;
}

function summarizePiToolResult(result: Record<string, unknown> | null): string | null {
	if (!result) {
		return null;
	}
	const content = readPiTextContent(result.content);
	if (content) {
		return content;
	}
	return readStringField(result, "error") ?? readStringField(result, "message");
}

function formatPiToolActivity(
	prefix: "Calling" | "Completed" | "Failed",
	toolName: string,
	detail: string | null,
): string {
	return detail && detail !== toolName ? `${prefix} ${toolName}: ${detail}` : `${prefix} ${toolName}`;
}

export function readPiSessionEntryId(line: string): string | null {
	const payload = parseJsonObject(line);
	return payload ? readStringField(payload, "id") : null;
}

export function mapPiSessionEntry(line: string): PiMappedSessionEvent[] {
	const payload = parseJsonObject(line);
	if (!payload || payload.type !== "message") {
		return [];
	}
	const message = asRecord(payload.message);
	if (!message) {
		return [];
	}
	const role = readStringField(message, "role");
	if (!role) {
		return [];
	}

	if (role === "user") {
		return [
			{
				event: "to_in_progress",
				metadata: {
					source: "pi",
					hookEventName: "user_message",
					activityText: "Working on task",
				},
			},
		];
	}

	if (role === "toolResult") {
		const toolName = readStringField(message, "toolName") ?? "tool";
		const detail = summarizePiToolResult(message);
		const isError = message.isError === true;
		return [
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: isError ? "tool_result_error" : "tool_result",
					toolName,
					activityText: formatPiToolActivity(isError ? "Failed" : "Completed", toolName, detail),
					finalMessage: detail ?? undefined,
				},
			},
		];
	}

	if (role !== "assistant") {
		return [];
	}

	const content = Array.isArray(message.content) ? message.content : [];
	const events: PiMappedSessionEvent[] = [];
	const toolCalls = content
		.map((entry) => asRecord(entry))
		.filter((entry): entry is Record<string, unknown> => entry !== null && entry.type === "toolCall");
	for (const toolCall of toolCalls) {
		const toolName = readStringField(toolCall, "name") ?? "tool";
		const args = asRecord(toolCall.arguments);
		events.push({
			event: "activity",
			metadata: {
				source: "pi",
				hookEventName: "tool_call",
				toolName,
				activityText: formatPiToolActivity("Calling", toolName, summarizePiToolArgs(toolName, args)),
			},
		});
	}

	const finalMessage = readPiTextContent(message.content);
	const shouldTreatAsFinalAnswer =
		hasPiFinalAnswerTextBlock(message.content) || (toolCalls.length === 0 && Boolean(finalMessage));
	if (finalMessage && shouldTreatAsFinalAnswer) {
		events.push({
			event: "to_review",
			metadata: {
				source: "pi",
				hookEventName: "assistant_message",
				finalMessage,
				activityText: `Final: ${finalMessage}`,
			},
		});
	}

	return events;
}

export async function findLatestPiSessionLog(sessionDir: string): Promise<PiSessionLogInfo | null> {
	let names: string[];
	try {
		names = await readdir(sessionDir);
	} catch {
		return null;
	}
	const candidates = await Promise.all(
		names
			.filter((name) => name.endsWith(".jsonl"))
			.map(async (name) => {
				const path = join(sessionDir, name);
				try {
					const fileStat = await stat(path);
					return {
						path,
						size: fileStat.size,
						mtimeMs: fileStat.mtimeMs,
					};
				} catch {
					return null;
				}
			}),
	);
	const latest = candidates
		.filter((candidate): candidate is PiSessionLogInfo => candidate !== null)
		.sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
	return latest ?? null;
}

export async function resolvePiExitReviewActivityFromSessionDir(
	sessionDir: string,
): Promise<Partial<RuntimeTaskHookActivity> | null> {
	const latestLog = await findLatestPiSessionLog(sessionDir);
	if (!latestLog) {
		return null;
	}
	let content = "";
	try {
		content = await readFile(latestLog.path, "utf8");
	} catch {
		return null;
	}
	const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		for (const mapped of mapPiSessionEntry(lines[index] ?? "")) {
			if (mapped.event === "to_review") {
				return mapped.metadata ?? null;
			}
		}
	}
	return null;
}
