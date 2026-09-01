// biome-ignore-all lint/style/noNonNullAssertion: ACP state maps
import type { RuntimeTaskImage, RuntimeTaskSessionSummary } from "../core/api-contract";
export interface PrimeAcpTaskSessionEntry {
	summary: RuntimeTaskSessionSummary;
	messages: PrimeAcpMessage[];
	activeAssistantMessageId: string | null;
	activeReasoningMessageId: string | null;
	toolMessageIdByToolCallId: Map<string, string>;
}
export interface PrimeAcpMessage {
	id: string;
	role: "user" | "assistant" | "system" | "tool" | "reasoning" | "status";
	content: string;
	images?: RuntimeTaskImage[];
	createdAt: number;
	meta?: {
		toolName?: string | null;
		hookEventName?: string | null;
		toolCallId?: string | null;
		streamType?: string | null;
		messageKind?: string | null;
		displayRole?: string | null;
		reason?: string | null;
	} | null;
}
export function now(): number {
	return Date.now();
}
export function cloneSummary(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary {
	return {
		...summary,
		latestHookActivity: summary.latestHookActivity ? { ...summary.latestHookActivity } : null,
		latestTurnCheckpoint: summary.latestTurnCheckpoint ? { ...summary.latestTurnCheckpoint } : null,
		previousTurnCheckpoint: summary.previousTurnCheckpoint ? { ...summary.previousTurnCheckpoint } : null,
	};
}
export function cloneMessage(message: PrimeAcpMessage): PrimeAcpMessage {
	return {
		...message,
		images: message.images ? message.images.map((i) => ({ ...i })) : message.images,
		meta: message.meta ? { ...message.meta } : message.meta,
	};
}
export function createDefaultSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		mode: null,
		agentId: "prime",
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
	};
}
export function updateSummary(
	entry: PrimeAcpTaskSessionEntry,
	patch: Partial<RuntimeTaskSessionSummary>,
): RuntimeTaskSessionSummary {
	entry.summary = { ...entry.summary, ...patch, updatedAt: now() };
	return cloneSummary(entry.summary);
}
export function createMessage(
	taskId: string,
	role: PrimeAcpMessage["role"],
	content: string,
	images?: RuntimeTaskImage[],
): PrimeAcpMessage {
	return {
		id: `${taskId}-${now()}-${Math.random().toString(36).slice(2, 8)}`,
		role,
		content,
		images: images && images.length > 0 ? images.map((i) => ({ ...i })) : undefined,
		createdAt: now(),
	};
}
export function createMessageWithMeta(
	taskId: string,
	role: PrimeAcpMessage["role"],
	content: string,
	meta: PrimeAcpMessage["meta"],
	images?: RuntimeTaskImage[],
): PrimeAcpMessage {
	return { ...createMessage(taskId, role, content, images), meta };
}
function updateMessageInEntry(
	entry: PrimeAcpTaskSessionEntry,
	messageId: string,
	updater: (m: PrimeAcpMessage) => PrimeAcpMessage,
): PrimeAcpMessage | null {
	const idx = entry.messages.findIndex((m) => m.id === messageId);
	if (idx < 0) return null;
	const current = entry.messages[idx]!;
	const updated = updater(current);
	entry.messages[idx] = updated;
	return cloneMessage(updated);
}
export function appendAssistantChunk(entry: PrimeAcpTaskSessionEntry, taskId: string, chunk: string): PrimeAcpMessage {
	const existingId = entry.activeAssistantMessageId;
	if (existingId) {
		const updated = updateMessageInEntry(entry, existingId, (m) => ({ ...m, content: m.content + chunk }));
		if (updated) return updated;
	}
	const msg = createMessage(taskId, "assistant", chunk);
	entry.messages.push(msg);
	entry.activeAssistantMessageId = msg.id;
	return cloneMessage(msg);
}
export function appendReasoningChunk(entry: PrimeAcpTaskSessionEntry, taskId: string, chunk: string): PrimeAcpMessage {
	const existingId = entry.activeReasoningMessageId;
	if (existingId) {
		const updated = updateMessageInEntry(entry, existingId, (m) => ({ ...m, content: m.content + chunk }));
		if (updated) return updated;
	}
	const msg = createMessage(taskId, "reasoning", chunk);
	entry.messages.push(msg);
	entry.activeReasoningMessageId = msg.id;
	return cloneMessage(msg);
}
export function appendUserChunk(entry: PrimeAcpTaskSessionEntry, taskId: string, chunk: string): PrimeAcpMessage {
	const last = entry.messages.at(-1);
	if (last && last.role === "user" && Date.now() - last.createdAt < 2000) {
		const updated = updateMessageInEntry(entry, last.id, (m) => ({ ...m, content: m.content + chunk }));
		if (updated) return updated;
	}
	const msg = createMessage(taskId, "user", chunk);
	entry.messages.push(msg);
	return cloneMessage(msg);
}
export function upsertToolCall(
	entry: PrimeAcpTaskSessionEntry,
	taskId: string,
	toolCallId: string,
	title: string,
	status?: string | null,
	content?: unknown,
	kind?: string | null,
): PrimeAcpMessage {
	const existingId = entry.toolMessageIdByToolCallId.get(toolCallId);
	const toolContent = formatToolContent(title, status, content);
	if (existingId) {
		const updated = updateMessageInEntry(entry, existingId, (m) => ({
			...m,
			content: toolContent,
			meta: {
				...(m.meta ?? {}),
				toolName: kind ?? m.meta?.toolName ?? null,
				toolCallId,
				messageKind: status ?? null,
			},
		}));
		if (updated) return updated;
	}
	const msg = createMessageWithMeta(taskId, "tool", toolContent, {
		toolName: kind ?? null,
		toolCallId,
		messageKind: status ?? null,
	});
	entry.messages.push(msg);
	entry.toolMessageIdByToolCallId.set(toolCallId, msg.id);
	return cloneMessage(msg);
}
function formatToolContent(title: string, status?: string | null, content?: unknown): string {
	const header = title.trim() || "tool";
	const statusPart = status ? ` [${status}]` : "";
	let body = "";
	if (content) {
		if (Array.isArray(content)) {
			body = content
				.map((c: any) => {
					if (c && typeof c === "object" && "text" in c) return String(c.text);
					if (c && typeof c === "object" && c.type === "text" && "text" in c) return String(c.text);
					return JSON.stringify(c);
				})
				.join("\n");
		} else if (typeof content === "string") {
			body = content;
		} else {
			try {
				body = JSON.stringify(content, null, 2);
			} catch {
				body = String(content);
			}
		}
	}
	return body ? `${header}${statusPart}\n${body}` : `${header}${statusPart}`;
}
export function clearActiveTurnState(entry: PrimeAcpTaskSessionEntry): void {
	entry.activeAssistantMessageId = null;
	entry.activeReasoningMessageId = null;
}
export function createSessionEntry(taskId: string): PrimeAcpTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map(),
	};
}
