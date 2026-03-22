// Stores the Kanban-side view of native Cline chat state.
// It combines live in-memory updates with hydration from persisted SDK
// session artifacts so the rest of the backend can read one repository shape.
import type { RuntimeTaskImage, RuntimeTaskSessionSummary, RuntimeTaskTurnCheckpoint } from "../core/api-contract.js";
import type { ClinePersistedTaskSessionSnapshot } from "./cline-session-runtime.js";
import type { ClineSdkPersistedMessage } from "./sdk-runtime-boundary.js";
import {
	cloneMessage,
	cloneSummary,
	createDefaultSummary,
	createMessage,
	createMessageWithMeta,
	finishToolCallMessage,
	startToolCallMessage,
	type ClineTaskMessage,
	type ClineTaskSessionEntry,
	updateSummary,
} from "./cline-session-state.js";

export interface ClineMessageRepository {
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void;
	onMessage(listener: (taskId: string, message: ClineTaskMessage) => void): () => void;
	setTaskEntry(taskId: string, entry: ClineTaskSessionEntry): void;
	getTaskEntry(taskId: string): ClineTaskSessionEntry | null;
	getSummary(taskId: string): RuntimeTaskSessionSummary | null;
	listSummaries(): RuntimeTaskSessionSummary[];
	listMessages(taskId: string): ClineTaskMessage[];
	hydrateTaskMessages(
		taskId: string,
		loadPersistedSession: () => Promise<ClinePersistedTaskSessionSnapshot | null>,
	): Promise<ClineTaskMessage[]>;
	emitSummary(summary: RuntimeTaskSessionSummary): void;
	emitMessage(taskId: string, message: ClineTaskMessage): void;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	dispose(): void;
}

// Own the in-memory task entries plus summary and message fanout, so future SDK-backed hydration can slot in behind one boundary.
export class InMemoryClineMessageRepository implements ClineMessageRepository {
	private readonly entries = new Map<string, ClineTaskSessionEntry>();
	private readonly hydratedMessagesByTaskId = new Map<string, ClineTaskMessage[]>();
	private readonly summaryListeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();
	private readonly messageListeners = new Set<(taskId: string, message: ClineTaskMessage) => void>();

	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		this.summaryListeners.add(listener);
		return () => {
			this.summaryListeners.delete(listener);
		};
	}

	onMessage(listener: (taskId: string, message: ClineTaskMessage) => void): () => void {
		this.messageListeners.add(listener);
		return () => {
			this.messageListeners.delete(listener);
		};
	}

	setTaskEntry(taskId: string, entry: ClineTaskSessionEntry): void {
		this.entries.set(taskId, entry);
		this.hydratedMessagesByTaskId.delete(taskId);
	}

	getTaskEntry(taskId: string): ClineTaskSessionEntry | null {
		return this.entries.get(taskId) ?? null;
	}

	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		return entry ? cloneSummary(entry.summary) : null;
	}

	listSummaries(): RuntimeTaskSessionSummary[] {
		return Array.from(this.entries.values()).map((entry) => cloneSummary(entry.summary));
	}

	listMessages(taskId: string): ClineTaskMessage[] {
		const entry = this.entries.get(taskId);
		if (entry) {
			return entry.messages.map((message) => cloneMessage(message));
		}
		const hydratedMessages = this.hydratedMessagesByTaskId.get(taskId);
		return hydratedMessages ? hydratedMessages.map((message) => cloneMessage(message)) : [];
	}

	async hydrateTaskMessages(
		taskId: string,
		loadPersistedSession: () => Promise<ClinePersistedTaskSessionSnapshot | null>,
	): Promise<ClineTaskMessage[]> {
		const liveEntry = this.entries.get(taskId);
		if (liveEntry) {
			return liveEntry.messages.map((message) => cloneMessage(message));
		}
		const cachedMessages = this.hydratedMessagesByTaskId.get(taskId);
		if (cachedMessages) {
			return cachedMessages.map((message) => cloneMessage(message));
		}
		const persistedSession = await loadPersistedSession();
		if (!persistedSession) {
			return [];
		}
		const hydratedMessages = hydratePersistedSessionMessages(taskId, persistedSession.messages);
		this.hydratedMessagesByTaskId.set(taskId, hydratedMessages);
		return hydratedMessages.map((message) => cloneMessage(message));
	}

	emitSummary(summary: RuntimeTaskSessionSummary): void {
		const snapshot = cloneSummary(summary);
		for (const listener of this.summaryListeners) {
			listener(snapshot);
		}
	}

	emitMessage(taskId: string, message: ClineTaskMessage): void {
		const snapshot = cloneMessage(message);
		for (const listener of this.messageListeners) {
			listener(taskId, snapshot);
		}
	}

	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry) {
			return null;
		}
		return updateSummary(entry, {
			latestTurnCheckpoint: checkpoint,
			previousTurnCheckpoint: entry.summary.latestTurnCheckpoint ?? null,
		});
	}

	dispose(): void {
		this.entries.clear();
		this.hydratedMessagesByTaskId.clear();
		this.summaryListeners.clear();
		this.messageListeners.clear();
	}
}

export function createInMemoryClineMessageRepository(): ClineMessageRepository {
	return new InMemoryClineMessageRepository();
}

export function createTaskEntryFromPersistedSession(
	taskId: string,
	messages: ClineSdkPersistedMessage[],
	summaryPatch: Partial<RuntimeTaskSessionSummary> = {},
): ClineTaskSessionEntry {
	const entry = createHydrationEntry(taskId);
	for (const message of messages) {
		hydratePersistedMessage(entry, taskId, message);
	}
	entry.summary = {
		...entry.summary,
		...summaryPatch,
		taskId,
		updatedAt: Date.now(),
	};
	return entry;
}

function hydratePersistedSessionMessages(taskId: string, messages: ClineSdkPersistedMessage[]): ClineTaskMessage[] {
	const entry = createHydrationEntry(taskId);
	for (const message of messages) {
		hydratePersistedMessage(entry, taskId, message);
	}
	return entry.messages.map((message) => cloneMessage(message));
}

function createHydrationEntry(taskId: string): ClineTaskSessionEntry {
	return {
		summary: createDefaultSummary(taskId),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map<string, string>(),
		toolInputByToolCallId: new Map<string, unknown>(),
	};
}

function hydratePersistedMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	message: ClineSdkPersistedMessage,
): void {
	const record =
		message && typeof message === "object" ? (message as Record<string, unknown>) : null;
	const persistedMetadata =
		record?.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
			? (record.metadata as Record<string, unknown>)
			: null;
	const persistedDisplayRole =
		typeof persistedMetadata?.displayRole === "string" ? persistedMetadata.displayRole.trim().toLowerCase() : "";
	const persistedReason =
		typeof persistedMetadata?.reason === "string" ? persistedMetadata.reason.trim() : null;
	const persistedMessageKind =
		typeof persistedMetadata?.kind === "string" ? persistedMetadata.kind.trim() : null;
	const hydratedRole =
		persistedDisplayRole === "system" || persistedDisplayRole === "status"
			? (persistedDisplayRole as "system" | "status")
			: message.role;

	if (typeof message.content === "string") {
		appendPersistedTextMessage(entry, taskId, hydratedRole, message.content, persistedMetadata, persistedReason, persistedMessageKind);
		return;
	}

	const textParts: string[] = [];
	const images: RuntimeTaskImage[] = [];
	const flushRichMessage = () => {
		if (textParts.length === 0 && images.length === 0) {
			return;
		}
		appendPersistedTextMessage(
			entry,
			taskId,
			hydratedRole,
			textParts.join("\n"),
			persistedMetadata,
			persistedReason,
			persistedMessageKind,
			images,
		);
		textParts.length = 0;
		images.length = 0;
	};

	for (const block of message.content) {
		if (block.type === "text") {
			textParts.push(block.text);
			continue;
		}
		if (block.type === "file") {
			textParts.push(`Attached file: ${block.path}`);
			continue;
		}
		if (block.type === "image") {
			if (typeof block.data === "string" && typeof block.mediaType === "string") {
				images.push({
					id: `${taskId}-image-${images.length}-${Date.now()}`,
					data: block.data,
					mimeType: block.mediaType,
				});
			} else if (typeof block.mediaType === "string") {
				textParts.push(`Attached image: ${block.mediaType}`);
			}
			continue;
		}

		flushRichMessage();

		if (block.type === "thinking") {
			appendPersistedReasoningMessage(entry, taskId, block.thinking);
			continue;
		}
		if (block.type === "redacted_thinking") {
			appendPersistedReasoningMessage(entry, taskId, "[redacted reasoning]");
			continue;
		}
		if (block.type === "tool_use") {
			startToolCallMessage(entry, taskId, {
				toolName: block.name,
				toolCallId: block.id,
				input: block.input,
			});
			continue;
		}
		if (block.type === "tool_result") {
			const resultText = stringifyPersistedToolResult(block.content);
			finishToolCallMessage(entry, taskId, {
				toolName: readHydratedToolName(entry, block.tool_use_id),
				toolCallId: block.tool_use_id,
				output: block.is_error ? undefined : resultText,
				error: block.is_error ? resultText : null,
				durationMs: null,
			});
		}
	}

	flushRichMessage();
}

function appendPersistedTextMessage(
	entry: ClineTaskSessionEntry,
	taskId: string,
	role: "user" | "assistant" | "system" | "status",
	content: string,
	metadata?: Record<string, unknown> | null,
	reason?: string | null,
	messageKind?: string | null,
	images?: RuntimeTaskImage[],
): void {
	if (content.trim().length === 0 && (!images || images.length === 0)) {
		return;
	}
	const meta =
		metadata || reason || messageKind
			? {
					hookEventName: metadata ? "history_notice" : null,
					messageKind: messageKind ?? null,
					displayRole: typeof metadata?.displayRole === "string" ? metadata.displayRole : null,
					reason: reason ?? null,
			  }
			: null;
	entry.messages.push(meta ? createMessageWithMeta(taskId, role, content, meta, images) : createMessage(taskId, role, content, images));
}

function appendPersistedReasoningMessage(entry: ClineTaskSessionEntry, taskId: string, content: string): void {
	if (content.trim().length === 0) {
		return;
	}
	entry.messages.push(
		createMessageWithMeta(taskId, "reasoning", content, {
			streamType: "reasoning",
		}),
	);
}

function stringifyPersistedToolResult(
	content: string | Array<{ type: string; [key: string]: unknown }>,
): string {
	if (typeof content === "string") {
		return content;
	}
	return content
		.map((block) => {
			if (block.type === "text" && typeof block.text === "string") {
				return block.text;
			}
			if (block.type === "file" && typeof block.path === "string") {
				return `Attached file: ${block.path}`;
			}
			if (block.type === "image" && typeof block.mediaType === "string") {
				return `Attached image: ${block.mediaType}`;
			}
			try {
				return JSON.stringify(block, null, 2);
			} catch {
				return String(block);
			}
		})
		.filter((part) => part.trim().length > 0)
		.join("\n");
}

function readHydratedToolName(entry: ClineTaskSessionEntry, toolCallId: string): string | null {
	const messageId = entry.toolMessageIdByToolCallId.get(toolCallId);
	if (!messageId) {
		return null;
	}
	const existingMessage = entry.messages.find((message) => message.id === messageId);
	return existingMessage?.meta?.toolName ?? null;
}
