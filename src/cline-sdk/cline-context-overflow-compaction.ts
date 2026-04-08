import type { ClineSdkPersistedMessage } from "./sdk-runtime-boundary";

/**
 * Temporary Kanban-side fallback for context overflow recovery.
 * TODO: remove this once SDK-side pluggable compaction policies are available and wired through Kanban.
 */
const CONTEXT_OVERFLOW_ERROR_PATTERNS = [
	/prompt is too long/i,
	/prompt is too long.*tokens?\s*>\s*\d+\s*maximum/i,
	/maximum prompt length/i,
	/input is too long/i,
	/context length exceeded/i,
	/context length.*exceeds/i,
	/maximum context length/i,
	/\bcontext\s*(?:length|window)\b/i,
	/\bcontext\s*(?:length|window)\b.*exceed/i,
	/\bmaximum\s*context\b/i,
	/context window.*(exceed|limit|too)/i,
	/(exceed|exceeds|exceeded).*context window/i,
	/input exceeds.*context window/i,
	/too many tokens/i,
	/\btoo\s*many\s*tokens?\b/i,
	/\b(?:input\s*)?tokens?\s*exceed/i,
	/maximum tokens.*exceeds.*model limit/i,
	/input length and max_tokens exceed context limit/i,
	/total number of tokens.*exceeds.*limit/i,
	/requested.*tokens.*exceeds.*limit/i,
	/requested input length.*exceeds.*maximum input length/i,
	/input token count exceeds.*maximum.*tokens? allowed/i,
	/reduce.*length.*messages.*completion/i,
	/tokens?\s*>\s*[\d,]+\s*(maximum|limit)/i,
	/input tokens?.*(exceed|exceeds).*(limit|maximum|context)/i,
];
const CONTEXT_COMPACTION_PREVIEW_CHARS = 300;

export function isContextOverflowError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	return CONTEXT_OVERFLOW_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

function readMessagePreview(message: ClineSdkPersistedMessage): string {
	const rawText =
		typeof message.content === "string"
			? message.content
			: message.content
					.map((block) => {
						if (block.type === "text") {
							return block.text;
						}
						if (block.type === "file") {
							return block.path;
						}
						if (block.type === "tool_use") {
							return `${block.name} ${JSON.stringify(block.input)}`;
						}
						if (block.type === "tool_result") {
							return typeof block.content === "string" ? block.content : "[tool_result]";
						}
						if (block.type === "thinking") {
							return block.thinking;
						}
						if (block.type === "redacted_thinking") {
							return "[redacted_thinking]";
						}
						return "[image]";
					})
					.join(" ");

	const normalized = rawText.replace(/\s+/g, " ").trim();
	if (!normalized) {
		return "(empty)";
	}
	if (normalized.length <= CONTEXT_COMPACTION_PREVIEW_CHARS) {
		return normalized;
	}
	return `${normalized.slice(0, CONTEXT_COMPACTION_PREVIEW_CHARS)}...`;
}

function prependCompactionNotice(
	message: ClineSdkPersistedMessage,
	firstUserMessage: string,
): ClineSdkPersistedMessage {
	const note = `[Previous conversation history was removed due to context window limits. Infer prior actions from the current environment state. First user message from the removed history: ${firstUserMessage}]`;
	if (typeof message.content === "string") {
		return {
			...message,
			content: `${note}\n\n${message.content}`,
		};
	}
	return {
		...message,
		content: [{ type: "text", text: note }, ...message.content],
	};
}

export function compactPersistedMessagesForContextOverflow(
	messages: ClineSdkPersistedMessage[],
): ClineSdkPersistedMessage[] | null {
	if (messages.length < 2) {
		return null;
	}

	const firstUserMessage = messages.find((message) => message.role === "user");
	if (!firstUserMessage) {
		return null;
	}
	const firstUserMessagePreview = readMessagePreview(firstUserMessage);

	let retained = messages.slice(Math.floor(messages.length / 2));
	while (retained.length > 0 && retained[0]?.role !== "user") {
		retained = retained.slice(1);
	}
	if (retained.length === 0) {
		return null;
	}

	const rewrittenFirstMessage = prependCompactionNotice(retained[0], firstUserMessagePreview);
	const compactedMessages = [rewrittenFirstMessage, ...retained.slice(1)];
	if (compactedMessages.length >= messages.length) {
		return null;
	}
	return compactedMessages;
}
