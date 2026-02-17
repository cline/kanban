// ACP-aligned types for the chat system.
// When ACP SDK is wired up, these can be replaced with imports from
// @agentclientprotocol/sdk or thin adapters that map SDK types.

// ---- Tool Call Types ----

export type ChatToolKind =
	| "read"
	| "edit"
	| "delete"
	| "move"
	| "search"
	| "execute"
	| "think"
	| "fetch"
	| "switch_mode"
	| "other";

export type ChatToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface ChatToolCallLocation {
	path: string;
	line?: number;
}

export interface ChatToolCallDiff {
	type: "diff";
	path: string;
	oldText: string | null;
	newText: string;
}

export interface ChatToolCallTextContent {
	type: "content";
	content: { type: "text"; text: string };
}

export type ChatToolCallContent = ChatToolCallDiff | ChatToolCallTextContent;

export interface ChatToolCall {
	toolCallId: string;
	title: string;
	kind: ChatToolKind;
	status: ChatToolCallStatus;
	content?: ChatToolCallContent[];
	locations?: ChatToolCallLocation[];
}

// ---- Plan Types ----

export type ChatPlanEntryStatus = "pending" | "in_progress" | "completed";
export type ChatPlanEntryPriority = "high" | "medium" | "low";

export interface ChatPlanEntry {
	content: string;
	status: ChatPlanEntryStatus;
	priority: ChatPlanEntryPriority;
}

// ---- Permission Types ----

export type ChatPermissionOptionKind =
	| "allow_once"
	| "allow_always"
	| "reject_once"
	| "reject_always";

export interface ChatPermissionOption {
	optionId: string;
	name: string;
	kind: ChatPermissionOptionKind;
}

export interface ChatPermissionRequest {
	toolCallId: string;
	toolCallTitle: string;
	options: ChatPermissionOption[];
}

// ---- Slash Command Types ----

export interface ChatSlashCommand {
	name: string;
	description: string;
	input?: { hint: string };
}

// ---- Timeline Entry Types ----

export interface ChatUserMessage {
	type: "user_message";
	id: string;
	timestamp: number;
	text: string;
}

export interface ChatAgentMessage {
	type: "agent_message";
	id: string;
	timestamp: number;
	text: string;
	isStreaming: boolean;
}

export interface ChatAgentThought {
	type: "agent_thought";
	id: string;
	timestamp: number;
	text: string;
	isStreaming: boolean;
}

export interface ChatToolCallMessage {
	type: "tool_call";
	id: string;
	timestamp: number;
	toolCall: ChatToolCall;
}

export interface ChatPlanMessage {
	type: "plan";
	id: string;
	timestamp: number;
	entries: ChatPlanEntry[];
}

export interface ChatPermissionMessage {
	type: "permission_request";
	id: string;
	timestamp: number;
	request: ChatPermissionRequest;
	resolved: boolean;
	selectedOptionId?: string;
}

export type ChatTimelineEntry =
	| ChatUserMessage
	| ChatAgentMessage
	| ChatAgentThought
	| ChatToolCallMessage
	| ChatPlanMessage
	| ChatPermissionMessage;

// ---- Session State ----

export type ChatSessionStatus = "idle" | "thinking" | "tool_running" | "cancelled";

export interface ChatSessionState {
	sessionId: string;
	status: ChatSessionStatus;
	timeline: ChatTimelineEntry[];
	availableCommands: ChatSlashCommand[];
}
