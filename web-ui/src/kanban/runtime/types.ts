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
	commandSource: "env" | "project" | "none";
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
	commandSource: "env" | "project" | "none";
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
