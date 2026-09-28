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

interface PiSessionTreeEntry {
	id: string;
	parentId: string | null;
	line: string;
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
	if (typeof value === "string") {
		const normalized = normalizeWhitespace(value);
		return normalized.length > 0 ? normalized : null;
	}
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
				},
			},
		];
	}

	if (role === "bashExecution") {
		const command = readStringField(message, "command") ?? "bash";
		const cancelled = message.cancelled === true;
		const isError = cancelled || (typeof message.exitCode === "number" && message.exitCode !== 0);
		return [
			{
				event: "activity",
				metadata: {
					source: "pi",
					hookEventName: "bash_execution",
					toolName: "bash",
					activityText: formatPiToolActivity(isError ? "Failed" : "Completed", "bash", command),
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
	const stopReason = readStringField(message, "stopReason");
	if (stopReason === "stop" && toolCalls.length === 0) {
		events.push({
			event: "to_review",
			metadata: {
				source: "pi",
				hookEventName: "assistant_message",
				...(finalMessage
					? { finalMessage, activityText: `Final: ${finalMessage}` }
					: { activityText: "Waiting for review" }),
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

function parsePiSessionTree(content: string): PiSessionTreeEntry[] {
	const entries: PiSessionTreeEntry[] = [];
	for (const line of content.split(/\r?\n/)) {
		if (line.trim().length === 0) {
			continue;
		}
		const payload = parseJsonObject(line);
		const id = payload ? readStringField(payload, "id") : null;
		if (!payload || !id) {
			continue;
		}
		const parentIdValue = payload.parentId;
		const parentId = typeof parentIdValue === "string" && parentIdValue.length > 0 ? parentIdValue : null;
		entries.push({ id, parentId, line });
	}
	return entries;
}

function walkActivePiSessionLeafPath(entries: PiSessionTreeEntry[]): PiSessionTreeEntry[] {
	if (entries.length === 0) {
		return [];
	}
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	const leaf = entries[entries.length - 1];
	if (!leaf) {
		return [];
	}
	const path: PiSessionTreeEntry[] = [];
	const seen = new Set<string>();
	let current: PiSessionTreeEntry | undefined = leaf;
	while (current && !seen.has(current.id)) {
		path.push(current);
		seen.add(current.id);
		current = current.parentId ? byId.get(current.parentId) : undefined;
	}
	return path.reverse();
}

const GENERIC_PI_EXIT_REVIEW: Partial<RuntimeTaskHookActivity> = {
	source: "pi",
	hookEventName: "session_exit",
	activityText: "Waiting for review",
};

export async function resolvePiExitReviewActivityFromSessionDir(
	sessionDir: string,
): Promise<Partial<RuntimeTaskHookActivity> | null> {
	const latestLog = await findLatestPiSessionLog(sessionDir);
	if (!latestLog) {
		return { ...GENERIC_PI_EXIT_REVIEW };
	}
	let content = "";
	try {
		content = await readFile(latestLog.path, "utf8");
	} catch {
		return { ...GENERIC_PI_EXIT_REVIEW };
	}
	const pathEntries = walkActivePiSessionLeafPath(parsePiSessionTree(content));
	for (let index = pathEntries.length - 1; index >= 0; index -= 1) {
		for (const mapped of mapPiSessionEntry(pathEntries[index]?.line ?? "")) {
			if (mapped.event === "to_review") {
				return mapped.metadata ?? { ...GENERIC_PI_EXIT_REVIEW };
			}
		}
	}
	return { ...GENERIC_PI_EXIT_REVIEW };
}
