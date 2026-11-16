import type { RuntimeTaskChatMessage } from "../core/api-contract";

export const AG2_CHAT_PREFIX = "AG2_CHAT ";
const AG2_CLI_NOISE = /^\[(?:ag2|kanban-hook|tool)\]/u;

const CHAT_ROLES = new Set(["user", "assistant", "system", "tool", "reasoning", "status"]);

export interface Ag2ChatConsumeResult {
	buffer: string;
	messages: RuntimeTaskChatMessage[];
	passthrough: string;
}

function parseChatPayload(raw: string): RuntimeTaskChatMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return null;
	}
	const record = parsed as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	const role = typeof record.role === "string" ? record.role : "";
	const content = typeof record.content === "string" ? record.content : "";
	if (!id || !CHAT_ROLES.has(role) || content.length === 0) {
		return null;
	}
	const createdAt =
		typeof record.createdAt === "number" && Number.isFinite(record.createdAt) ? record.createdAt : Date.now();
	const meta =
		record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
			? (record.meta as RuntimeTaskChatMessage["meta"])
			: null;
	return {
		id,
		role: role as RuntimeTaskChatMessage["role"],
		content,
		createdAt,
		meta,
	};
}

export function consumeAg2ChatOutput(buffer: string, chunk: string): Ag2ChatConsumeResult {
	const combined = `${buffer}${chunk}`;
	const lines = combined.split(/\r?\n/u);
	const hasTrailingNewline = /[\r\n]$/u.test(combined);
	let incomplete = "";
	if (!hasTrailingNewline) {
		incomplete = lines.pop() ?? "";
	} else if (lines.at(-1) === "") {
		lines.pop();
	}
	const messages: RuntimeTaskChatMessage[] = [];
	const passthroughParts: string[] = [];

	for (const line of lines) {
		if (line.startsWith(AG2_CHAT_PREFIX)) {
			const message = parseChatPayload(line.slice(AG2_CHAT_PREFIX.length));
			if (message) {
				messages.push(message);
			}
			continue;
		}
		if (AG2_CLI_NOISE.test(line)) {
			continue;
		}
		passthroughParts.push(line);
	}

	let passthrough = passthroughParts.join("\n");
	if (passthroughParts.length > 0 && hasTrailingNewline) {
		passthrough += "\n";
	}

	return {
		buffer: incomplete,
		messages,
		passthrough,
	};
}
