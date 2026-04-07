import { open, stat } from "node:fs/promises";

import type { RuntimeHookEvent, RuntimeTaskHookActivity } from "../../core/api-contract";

const DROID_TRANSCRIPT_TAIL_SCAN_BYTES = 2 * 1024 * 1024;

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function readStringField(record: Record<string, unknown>, key: string): string | null {
	const value = record[key];
	if (typeof value !== "string") {
		return null;
	}
	const normalized = normalizeWhitespace(value);
	return normalized.length > 0 ? normalized : null;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
	try {
		return asRecord(JSON.parse(value));
	} catch {
		return null;
	}
}

function readTranscriptPathFromPayload(payload: Record<string, unknown> | null): string | null {
	return payload ? (readStringField(payload, "transcript_path") ?? readStringField(payload, "transcriptPath")) : null;
}

function extractAssistantTextFromDroidMessage(lineRecord: Record<string, unknown>): string | null {
	if (readStringField(lineRecord, "type") !== "message") {
		return null;
	}
	const messageRecord = asRecord(lineRecord.message);
	if (!messageRecord || readStringField(messageRecord, "role") !== "assistant") {
		return null;
	}
	const content = messageRecord.content;
	if (typeof content === "string") {
		return normalizeWhitespace(content);
	}
	if (!Array.isArray(content)) {
		return null;
	}
	const textSegments: string[] = [];
	for (const item of content) {
		const itemRecord = asRecord(item);
		if (!itemRecord) {
			continue;
		}
		const itemText = readStringField(itemRecord, "text");
		if (itemText) {
			textSegments.push(itemText);
		}
	}
	if (textSegments.length === 0) {
		return null;
	}
	return normalizeWhitespace(textSegments.join("\n"));
}

export function resolveDroidFinalMessageFromTranscriptText(transcriptText: string): string | null {
	const lines = transcriptText.split(/\r?\n/);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index]?.trim();
		if (!line) {
			continue;
		}
		const lineRecord = parseJsonObject(line);
		if (!lineRecord) {
			continue;
		}
		const assistantText = extractAssistantTextFromDroidMessage(lineRecord);
		if (assistantText) {
			return assistantText;
		}
	}
	return null;
}

async function readFileTail(filePath: string, maxBytes: number): Promise<string | null> {
	try {
		const fileStat = await stat(filePath);
		if (!fileStat.isFile() || fileStat.size <= 0 || maxBytes <= 0) {
			return null;
		}
		const byteLength = Math.min(fileStat.size, maxBytes);
		const start = Math.max(0, fileStat.size - byteLength);
		let handle: Awaited<ReturnType<typeof open>> | null = null;
		try {
			handle = await open(filePath, "r");
			const buffer = Buffer.alloc(byteLength);
			const readResult = await handle.read(buffer, 0, byteLength, start);
			return buffer.subarray(0, readResult.bytesRead).toString("utf8");
		} finally {
			await handle?.close();
		}
	} catch {
		return null;
	}
}

async function resolveDroidReviewFinalMessageFromPayload(
	payload: Record<string, unknown> | null,
): Promise<string | null> {
	const transcriptPath = readTranscriptPathFromPayload(payload);
	if (!transcriptPath) {
		return null;
	}
	const transcriptTail = await readFileTail(transcriptPath, DROID_TRANSCRIPT_TAIL_SCAN_BYTES);
	if (!transcriptTail) {
		return null;
	}
	return resolveDroidFinalMessageFromTranscriptText(transcriptTail);
}

export async function enrichDroidReviewMetadata<
	T extends {
		event: RuntimeHookEvent;
		metadata?: Partial<RuntimeTaskHookActivity>;
		payload?: Record<string, unknown> | null;
	},
>(args: T): Promise<T> {
	if (args.event !== "to_review") {
		return args;
	}
	const metadata = args.metadata ?? {};
	const source = metadata.source?.toLowerCase();
	if (source !== "droid") {
		return args;
	}
	const existingFinalMessage =
		typeof metadata.finalMessage === "string" && metadata.finalMessage.trim().length > 0
			? metadata.finalMessage
			: null;
	if (existingFinalMessage) {
		return {
			...args,
			metadata: {
				...metadata,
				activityText: metadata.activityText ?? `Final: ${existingFinalMessage}`,
			},
		};
	}

	const fallbackFinalMessage = await resolveDroidReviewFinalMessageFromPayload(args.payload ?? null);
	if (!fallbackFinalMessage) {
		return args;
	}

	return {
		...args,
		metadata: {
			...metadata,
			finalMessage: fallbackFinalMessage,
			activityText: metadata.activityText ?? `Final: ${fallbackFinalMessage}`,
		},
	};
}
