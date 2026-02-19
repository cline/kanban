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

export interface RuntimeWorkspaceChangesResponse {
	repoRoot: string;
	generatedAt: number;
	files: RuntimeWorkspaceFileChange[];
}

export interface RuntimeAcpHealthResponse {
	available: boolean;
	configuredCommand: string | null;
	commandSource: "env" | "config" | "none";
	detectedCommands?: string[];
	reason?: string;
}

export interface RuntimeAcpProbeResponse {
	ok: boolean;
	reason?: string;
}

export interface RuntimeConfigResponse {
	acpCommand: string | null;
	effectiveCommand: string | null;
	commandSource: "env" | "config" | "none";
	configPath: string;
	detectedCommands: string[];
	supportedAgents: RuntimeSupportedAcpAgent[];
	shortcuts: RuntimeProjectShortcut[];
}

export interface RuntimeSupportedAcpAgent {
	id: string;
	label: string;
	binary: string;
	command: string;
	installed: boolean;
	configured: boolean;
}

export interface RuntimeProjectShortcut {
	id: string;
	label: string;
	command: string;
	icon?: string;
}

export interface RuntimeShortcutRunResponse {
	exitCode: number;
	stdout: string;
	stderr: string;
	combinedOutput: string;
	durationMs: number;
}

export type RuntimeBoardColumnId = "backlog" | "in_progress" | "review" | "trash";

export interface RuntimeBoardCard {
	id: string;
	title: string;
	description: string;
	baseRef?: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface RuntimeBoardColumn {
	id: RuntimeBoardColumnId;
	title: string;
	cards: RuntimeBoardCard[];
}

export interface RuntimeBoardData {
	columns: RuntimeBoardColumn[];
}

export type RuntimeChatSessionStatus = "idle" | "thinking" | "tool_running" | "cancelled";

export interface RuntimeChatTimelineUserMessage {
	type: "user_message";
	id: string;
	timestamp: number;
	text: string;
}

export interface RuntimeChatTimelineAgentMessage {
	type: "agent_message";
	id: string;
	timestamp: number;
	text: string;
	isStreaming: boolean;
}

export interface RuntimeChatTimelineAgentThought {
	type: "agent_thought";
	id: string;
	timestamp: number;
	text: string;
	isStreaming: boolean;
}

export interface RuntimeChatTimelineToolCallMessage {
	type: "tool_call";
	id: string;
	timestamp: number;
	toolCall: {
		toolCallId: string;
		title: string;
		kind: "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "switch_mode" | "other";
		status: "pending" | "in_progress" | "completed" | "failed";
		content?: Array<
			| {
					type: "content";
					content: { type: "text"; text: string };
			  }
			| {
					type: "diff";
					path: string;
					oldText: string | null;
					newText: string;
			  }
		>;
		locations?: Array<{
			path: string;
			line?: number;
		}>;
	};
}

export interface RuntimeChatTimelinePlanMessage {
	type: "plan";
	id: string;
	timestamp: number;
	entries: Array<{
		content: string;
		status: "pending" | "in_progress" | "completed";
		priority: "high" | "medium" | "low";
	}>;
}

export interface RuntimeChatTimelinePermissionMessage {
	type: "permission_request";
	id: string;
	timestamp: number;
	request: {
		toolCallId: string;
		toolCallTitle: string;
		options: Array<{
			optionId: string;
			name: string;
			kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
		}>;
	};
	resolved: boolean;
	selectedOptionId?: string;
}

export type RuntimeChatTimelineEntry =
	| RuntimeChatTimelineUserMessage
	| RuntimeChatTimelineAgentMessage
	| RuntimeChatTimelineAgentThought
	| RuntimeChatTimelineToolCallMessage
	| RuntimeChatTimelinePlanMessage
	| RuntimeChatTimelinePermissionMessage;

export interface RuntimeChatSessionState {
	sessionId: string;
	status: RuntimeChatSessionStatus;
	timeline: RuntimeChatTimelineEntry[];
	availableCommands: Array<{
		name: string;
		description: string;
		input?: {
			hint?: string;
		};
	}>;
}

export interface RuntimeWorkspaceStateResponse {
	repoPath: string;
	statePath: string;
	git: RuntimeGitRepositoryInfo;
	board: RuntimeBoardData;
	sessions: Record<string, RuntimeChatSessionState>;
}

export interface RuntimeWorkspaceStateSaveRequest {
	board: RuntimeBoardData;
	sessions: Record<string, RuntimeChatSessionState>;
}

export interface RuntimeGitRepositoryInfo {
	hasGit: boolean;
	currentBranch: string | null;
	defaultBranch: string | null;
	branches: string[];
}

export interface RuntimeWorktreeEnsureRequest {
	taskId: string;
	baseRef?: string | null;
}

export interface RuntimeWorktreeEnsureResponse {
	ok: boolean;
	enabled: boolean;
	path: string;
	baseRef: string | null;
	baseCommit: string | null;
	error?: string;
}

export interface RuntimeWorktreeDeleteRequest {
	taskId: string;
}

export interface RuntimeWorktreeDeleteResponse {
	ok: boolean;
	enabled: boolean;
	removed: boolean;
	error?: string;
}

export interface RuntimeTaskWorkspaceInfoRequest {
	taskId: string;
	baseRef?: string | null;
}

export interface RuntimeTaskWorkspaceInfoResponse {
	taskId: string;
	mode: "local" | "worktree";
	path: string;
	exists: boolean;
	deleted: boolean;
	baseRef: string | null;
	hasGit: boolean;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
}
