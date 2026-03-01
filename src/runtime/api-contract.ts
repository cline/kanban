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

export interface RuntimeWorkspaceFileSearchRequest {
	query: string;
	limit?: number;
}

export interface RuntimeWorkspaceFileSearchMatch {
	path: string;
	name: string;
	changed: boolean;
}

export interface RuntimeWorkspaceFileSearchResponse {
	query: string;
	files: RuntimeWorkspaceFileSearchMatch[];
}

export interface RuntimeSlashCommandDescription {
	name: string;
	description: string | null;
}

export interface RuntimeSlashCommandsResponse {
	agentId: RuntimeAgentId | null;
	commands: RuntimeSlashCommandDescription[];
	error: string | null;
}

export type RuntimeBoardColumnId = "backlog" | "in_progress" | "review" | "trash";

export interface RuntimeBoardCard {
	id: string;
	title: string;
	description: string;
	prompt: string;
	startInPlanMode: boolean;
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

export interface RuntimeGitRepositoryInfo {
	hasGit: boolean;
	currentBranch: string | null;
	defaultBranch: string | null;
	branches: string[];
}

export type RuntimeGitSyncAction = "fetch" | "pull" | "push";

export interface RuntimeGitSyncSummary {
	hasGit: boolean;
	currentBranch: string | null;
	upstreamBranch: string | null;
	changedFiles: number;
	additions: number;
	deletions: number;
	aheadCount: number;
	behindCount: number;
}

export interface RuntimeGitSummaryResponse {
	ok: boolean;
	summary: RuntimeGitSyncSummary;
	error?: string;
}

export interface RuntimeGitSyncResponse {
	ok: boolean;
	action: RuntimeGitSyncAction;
	summary: RuntimeGitSyncSummary;
	output: string;
	error?: string;
}

export type RuntimeTaskSessionState = "idle" | "running" | "awaiting_review" | "failed" | "interrupted";

export type RuntimeTaskSessionReviewReason = "attention" | "exit" | "error" | "interrupted" | "hook" | null;

export interface RuntimeTaskSessionSummary {
	taskId: string;
	state: RuntimeTaskSessionState;
	agentId: RuntimeAgentId | null;
	workspacePath: string | null;
	pid: number | null;
	startedAt: number | null;
	updatedAt: number;
	lastOutputAt: number | null;
	lastActivityLine: string | null;
	reviewReason: RuntimeTaskSessionReviewReason;
	exitCode: number | null;
}

export interface RuntimeWorkspaceStateResponse {
	repoPath: string;
	statePath: string;
	git: RuntimeGitRepositoryInfo;
	board: RuntimeBoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	revision: number;
}

export interface RuntimeWorkspaceStateSaveRequest {
	board: RuntimeBoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	expectedRevision?: number;
}

export interface RuntimeWorkspaceStateConflictResponse {
	error: string;
	currentRevision: number;
}

export interface RuntimeStateStreamSnapshotMessage {
	type: "snapshot";
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
	workspaceState: RuntimeWorkspaceStateResponse | null;
}

export interface RuntimeStateStreamWorkspaceStateMessage {
	type: "workspace_state_updated";
	workspaceId: string;
	workspaceState: RuntimeWorkspaceStateResponse;
}

export interface RuntimeStateStreamTaskSessionsMessage {
	type: "task_sessions_updated";
	workspaceId: string;
	summaries: RuntimeTaskSessionSummary[];
}

export interface RuntimeStateStreamWorkspaceRetrieveStatusMessage {
	type: "workspace_retrieve_status";
	workspaceId: string;
	retrievedAt: number;
}

export interface RuntimeStateStreamProjectsMessage {
	type: "projects_updated";
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
}

export interface RuntimeStateStreamErrorMessage {
	type: "error";
	message: string;
}

export type RuntimeStateStreamMessage =
	| RuntimeStateStreamSnapshotMessage
	| RuntimeStateStreamWorkspaceStateMessage
	| RuntimeStateStreamTaskSessionsMessage
	| RuntimeStateStreamWorkspaceRetrieveStatusMessage
	| RuntimeStateStreamProjectsMessage
	| RuntimeStateStreamErrorMessage;

export interface RuntimeProjectSummary {
	id: string;
	path: string;
	name: string;
	taskCounts: RuntimeProjectTaskCounts;
}

export interface RuntimeProjectTaskCounts {
	backlog: number;
	in_progress: number;
	review: number;
	trash: number;
}

export interface RuntimeProjectsResponse {
	currentProjectId: string | null;
	projects: RuntimeProjectSummary[];
}

export interface RuntimeProjectAddRequest {
	path: string;
}

export interface RuntimeProjectAddResponse {
	ok: boolean;
	project: RuntimeProjectSummary | null;
	error?: string;
}

export interface RuntimeProjectDirectoryPickerResponse {
	ok: boolean;
	path: string | null;
	error?: string;
}

export interface RuntimeProjectRemoveRequest {
	projectId: string;
}

export interface RuntimeProjectRemoveResponse {
	ok: boolean;
	error?: string;
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

export interface RuntimeProjectShortcut {
	id: string;
	label: string;
	command: string;
	icon?: string;
}

export interface RuntimeShortcutRunRequest {
	command: string;
}

export interface RuntimeShortcutRunResponse {
	exitCode: number;
	stdout: string;
	stderr: string;
	combinedOutput: string;
	durationMs: number;
}

export type RuntimeAgentId = "claude" | "codex" | "gemini" | "opencode" | "cline";

export interface RuntimeAgentDefinition {
	id: RuntimeAgentId;
	label: string;
	binary: string;
	command: string;
	defaultArgs: string[];
	installed: boolean;
	configured: boolean;
}

export interface RuntimeConfigResponse {
	selectedAgentId: RuntimeAgentId;
	effectiveCommand: string | null;
	globalConfigPath: string;
	projectConfigPath: string;
	detectedCommands: string[];
	agents: RuntimeAgentDefinition[];
	shortcuts: RuntimeProjectShortcut[];
}

export interface RuntimeConfigSaveRequest {
	selectedAgentId: RuntimeAgentId;
	shortcuts?: RuntimeProjectShortcut[];
}

export interface RuntimeTaskSessionStartRequest {
	taskId: string;
	prompt: string;
	startInPlanMode?: boolean;
	baseRef?: string | null;
	cols?: number;
	rows?: number;
}

export interface RuntimeTaskSessionStartResponse {
	ok: boolean;
	summary: RuntimeTaskSessionSummary | null;
	error?: string;
}

export interface RuntimeTaskSessionStopRequest {
	taskId: string;
}

export interface RuntimeTaskSessionStopResponse {
	ok: boolean;
	summary: RuntimeTaskSessionSummary | null;
	error?: string;
}

export interface RuntimeShellSessionStartRequest {
	taskId: string;
	cols?: number;
	rows?: number;
	workspaceTaskId?: string;
	baseRef?: string | null;
}

export interface RuntimeShellSessionStartResponse {
	ok: boolean;
	summary: RuntimeTaskSessionSummary | null;
	shellBinary?: string | null;
	error?: string;
}

export interface RuntimeTerminalWsInputMessage {
	type: "input";
	data: string;
}

export interface RuntimeTerminalWsResizeMessage {
	type: "resize";
	cols: number;
	rows: number;
}

export interface RuntimeTerminalWsStopMessage {
	type: "stop";
}

export type RuntimeTerminalWsClientMessage =
	| RuntimeTerminalWsInputMessage
	| RuntimeTerminalWsResizeMessage
	| RuntimeTerminalWsStopMessage;

export interface RuntimeTerminalWsOutputMessage {
	type: "output";
	data: string;
}

export interface RuntimeTerminalWsStateMessage {
	type: "state";
	summary: RuntimeTaskSessionSummary;
}

export interface RuntimeTerminalWsErrorMessage {
	type: "error";
	message: string;
}

export interface RuntimeTerminalWsExitMessage {
	type: "exit";
	code: number | null;
}

export type RuntimeTerminalWsServerMessage =
	| RuntimeTerminalWsOutputMessage
	| RuntimeTerminalWsStateMessage
	| RuntimeTerminalWsErrorMessage
	| RuntimeTerminalWsExitMessage;

export type RuntimeHookEvent = "review" | "inprogress";

export interface RuntimeHookIngestRequest {
	taskId: string;
	event: RuntimeHookEvent;
}

export interface RuntimeHookIngestResponse {
	ok: boolean;
	error?: string;
}
