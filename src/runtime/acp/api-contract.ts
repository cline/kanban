export type RuntimeToolKind =
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

export type RuntimeToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface RuntimeToolCallLocation {
	path: string;
	line?: number;
}

export interface RuntimeToolCallDiffContent {
	type: "diff";
	path: string;
	oldText: string | null;
	newText: string;
}

export interface RuntimeToolCallTextContent {
	type: "content";
	content: {
		type: "text";
		text: string;
	};
}

export type RuntimeToolCallContent = RuntimeToolCallDiffContent | RuntimeToolCallTextContent;

export interface RuntimeToolCall {
	toolCallId: string;
	title: string;
	kind: RuntimeToolKind;
	status: RuntimeToolCallStatus;
	content?: RuntimeToolCallContent[];
	locations?: RuntimeToolCallLocation[];
}

export interface RuntimeAvailableCommand {
	name: string;
	description: string;
	input?: {
		hint?: string;
	};
}

export interface RuntimePlanEntry {
	content: string;
	status: "pending" | "in_progress" | "completed";
	priority: "high" | "medium" | "low";
}

export interface RuntimePermissionOption {
	optionId: string;
	name: string;
	kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export interface RuntimeTimelineUserMessage {
	type: "user_message";
	id: string;
	timestamp: number;
	text: string;
}

export interface RuntimeTimelineAgentMessage {
	type: "agent_message";
	id: string;
	timestamp: number;
	text: string;
	isStreaming: boolean;
}

export interface RuntimeTimelineAgentThought {
	type: "agent_thought";
	id: string;
	timestamp: number;
	text: string;
	isStreaming: boolean;
}

export interface RuntimeTimelineToolCall {
	type: "tool_call";
	id: string;
	timestamp: number;
	toolCall: RuntimeToolCall;
}

export interface RuntimeTimelinePlan {
	type: "plan";
	id: string;
	timestamp: number;
	entries: RuntimePlanEntry[];
}

export interface RuntimeTimelinePermissionRequest {
	type: "permission_request";
	id: string;
	timestamp: number;
	request: {
		toolCallId: string;
		toolCallTitle: string;
		options: RuntimePermissionOption[];
	};
	resolved: boolean;
	selectedOptionId?: string;
}

export type RuntimeTimelineEntry =
	| RuntimeTimelineUserMessage
	| RuntimeTimelineAgentMessage
	| RuntimeTimelineAgentThought
	| RuntimeTimelineToolCall
	| RuntimeTimelinePlan
	| RuntimeTimelinePermissionRequest;

export interface RuntimeAcpTurnRequest {
	taskId: string;
	taskTitle: string;
	taskDescription: string;
	prompt: string;
}

export interface RuntimeAcpTurnResponse {
	entries: RuntimeTimelineEntry[];
	stopReason: string;
	availableCommands?: RuntimeAvailableCommand[];
}

export interface RuntimeAcpHealthResponse {
	available: boolean;
	configuredCommand: string | null;
	detectedCommands?: string[];
	reason?: string;
}

export interface RuntimeAcpCancelRequest {
	taskId: string;
}

export interface RuntimeAcpCancelResponse {
	cancelled: boolean;
}

export type RuntimeWorkspaceFileStatus =
	| "modified"
	| "added"
	| "deleted"
	| "renamed"
	| "copied"
	| "untracked"
	| "unknown";

export interface RuntimeWorkspaceFileChange {
	path: string;
	previousPath?: string;
	status: RuntimeWorkspaceFileStatus;
	additions: number;
	deletions: number;
	oldText: string | null;
	newText: string | null;
}

export interface RuntimeWorkspaceChangesRequest {
	taskId: string;
}

export interface RuntimeWorkspaceChangesResponse {
	repoRoot: string;
	generatedAt: number;
	files: RuntimeWorkspaceFileChange[];
}
