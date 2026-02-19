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
	baseRef?: string | null;
}

export interface RuntimeAcpTurnResponse {
	entries: RuntimeTimelineEntry[];
	stopReason: string;
	availableCommands?: RuntimeAvailableCommand[];
}

export type RuntimeAcpTurnStatus = "thinking" | "tool_running" | "idle";

export interface RuntimeAcpTurnStreamEntryEvent {
	type: "entry";
	entry: RuntimeTimelineEntry;
}

export interface RuntimeAcpTurnStreamStatusEvent {
	type: "status";
	status: RuntimeAcpTurnStatus;
}

export interface RuntimeAcpTurnStreamCommandsEvent {
	type: "available_commands";
	commands: RuntimeAvailableCommand[];
}

export interface RuntimeAcpTurnStreamCompleteEvent {
	type: "complete";
	stopReason: string;
}

export interface RuntimeAcpTurnStreamErrorEvent {
	type: "error";
	error: string;
}

export type RuntimeAcpTurnStreamEvent =
	| RuntimeAcpTurnStreamEntryEvent
	| RuntimeAcpTurnStreamStatusEvent
	| RuntimeAcpTurnStreamCommandsEvent
	| RuntimeAcpTurnStreamCompleteEvent
	| RuntimeAcpTurnStreamErrorEvent;

export type RuntimeAcpCommandSource = "env" | "config" | "none";

export interface RuntimeAcpHealthResponse {
	available: boolean;
	configuredCommand: string | null;
	commandSource: RuntimeAcpCommandSource;
	detectedCommands?: string[];
	reason?: string;
}

export interface RuntimeAcpCancelRequest {
	taskId: string;
}

export interface RuntimeAcpCancelResponse {
	cancelled: boolean;
}

export interface RuntimeAcpProbeRequest {
	command: string;
}

export interface RuntimeAcpProbeResponse {
	ok: boolean;
	reason?: string;
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
	baseRef?: string | null;
}

export interface RuntimeWorkspaceChangesResponse {
	repoRoot: string;
	generatedAt: number;
	files: RuntimeWorkspaceFileChange[];
}

export interface RuntimeConfigResponse {
	acpCommand: string | null;
	effectiveCommand: string | null;
	commandSource: RuntimeAcpCommandSource;
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

export interface RuntimeConfigSaveRequest {
	acpCommand: string | null;
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeProjectShortcut {
	id: string;
	label: string;
	command: string;
	icon?: string;
}

export interface RuntimeShortcutRunRequest {
	command: string;
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

export interface RuntimeChatSessionState {
	sessionId: string;
	status: RuntimeAcpTurnStatus | "cancelled";
	timeline: RuntimeTimelineEntry[];
	availableCommands: RuntimeAvailableCommand[];
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

export interface RuntimeShortcutRunResponse {
	exitCode: number;
	stdout: string;
	stderr: string;
	combinedOutput: string;
	durationMs: number;
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
