#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import { isHooksSubcommand, runHooksIngest } from "./hooks-cli.js";
import { createSampleBoard } from "./index.js";
import type {
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeGitSummaryResponse,
	RuntimeGitSyncAction,
	RuntimeGitSyncResponse,
	RuntimeHookEvent,
	RuntimeHookIngestRequest,
	RuntimeHookIngestResponse,
	RuntimeProjectAddRequest,
	RuntimeProjectAddResponse,
	RuntimeProjectDirectoryPickerResponse,
	RuntimeProjectRemoveRequest,
	RuntimeProjectRemoveResponse,
	RuntimeProjectSummary,
	RuntimeProjectsResponse,
	RuntimeProjectTaskCounts,
	RuntimeShellSessionStartRequest,
	RuntimeShellSessionStartResponse,
	RuntimeShortcutRunRequest,
	RuntimeShortcutRunResponse,
	RuntimeSlashCommandsResponse,
	RuntimeStateStreamErrorMessage,
	RuntimeStateStreamMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskSessionsMessage,
	RuntimeStateStreamWorkspaceRetrieveStatusMessage,
	RuntimeStateStreamWorkspaceStateMessage,
	RuntimeTaskSessionStartRequest,
	RuntimeTaskSessionStartResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateConflictResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeEnsureRequest,
} from "./runtime/api-contract.js";
import { loadRuntimeConfig, saveRuntimeConfig } from "./runtime/config/runtime-config.js";
import {
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	type RuntimeWorkspaceIndexEntry,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
	saveWorkspaceState,
	WorkspaceStateConflictError,
} from "./runtime/state/workspace-state.js";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "./runtime/terminal/agent-registry.js";
import { TerminalSessionManager } from "./runtime/terminal/session-manager.js";
import { discoverRuntimeSlashCommands } from "./runtime/terminal/slash-commands.js";
import { createTerminalWebSocketBridge } from "./runtime/terminal/ws-server.js";
import { getWorkspaceChanges } from "./runtime/workspace/get-workspace-changes.js";
import { getGitSyncSummary, runGitSyncAction } from "./runtime/workspace/git-sync.js";
import { searchWorkspaceFiles } from "./runtime/workspace/search-workspace-files.js";
import {
	deleteTaskWorktree,
	ensureTaskWorktree,
	getTaskWorkspaceInfo,
	resolveTaskCwd,
} from "./runtime/workspace/task-worktree.js";

interface CliOptions {
	help: boolean;
	version: boolean;
	json: boolean;
	noOpen: boolean;
	port: number;
}

const MIME_TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".ico": "image/x-icon",
	".map": "application/json; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};

const DEFAULT_PORT = 8484;
const TASK_SESSION_STREAM_BATCH_MS = 150;
const WORKSPACE_FILE_CHANGE_STREAM_BATCH_MS = 25;
const WORKSPACE_FILE_WATCH_INTERVAL_MS = 2_000;

function parseCliOptions(argv: string[]): CliOptions {
	let help = false;
	let version = false;
	let json = false;
	let noOpen = false;
	let port = DEFAULT_PORT;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--version" || arg === "-v") {
			version = true;
			continue;
		}
		if (arg === "--json") {
			json = true;
			continue;
		}
		if (arg === "--no-open") {
			noOpen = true;
			continue;
		}
		if (arg === "--port") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --port.");
			}
			const parsed = Number.parseInt(value, 10);
			if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 65535) {
				throw new Error(`Invalid port: ${value}`);
			}
			port = parsed;
			index += 1;
		}
	}

	return { help, version, json, noOpen, port };
}

function getWebUiDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	const packagedPath = resolve(here, "web-ui");
	const repoPath = resolve(here, "../web-ui/dist");
	if (existsSync(join(packagedPath, "index.html"))) {
		return packagedPath;
	}
	return repoPath;
}

function printHelp(): void {
	console.log("kanbanana");
	console.log("Local orchestration board for coding agents.");
	console.log("");
	console.log("Usage:");
	console.log("  kanbanana [--port <number>] [--no-open] [--json] [--help] [--version]");
	console.log("");
	console.log(`Default port: ${DEFAULT_PORT}`);
}

function shouldFallbackToIndexHtml(pathname: string): boolean {
	return !extname(pathname);
}

function normalizeRequestPath(urlPathname: string): string {
	const trimmed = urlPathname === "/" ? "/index.html" : urlPathname;
	return decodeURIComponent(trimmed.split("?")[0] ?? trimmed);
}

function readWorkspaceIdFromRequest(request: IncomingMessage, requestUrl: URL): string | null {
	const headerValue = request.headers["x-kanbanana-workspace-id"];
	const headerWorkspaceId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
	if (typeof headerWorkspaceId === "string") {
		const normalized = headerWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	const queryWorkspaceId = requestUrl.searchParams.get("workspaceId");
	if (typeof queryWorkspaceId === "string") {
		const normalized = queryWorkspaceId.trim();
		if (normalized) {
			return normalized;
		}
	}
	return null;
}

function resolveAssetPath(rootDir: string, urlPathname: string): string {
	const normalizedRequest = normalize(urlPathname).replace(/^(\.\.(\/|\\|$))+/, "");
	const absolutePath = resolve(rootDir, `.${normalizedRequest}`);
	const normalizedRoot = rootDir.endsWith(sep) ? rootDir : `${rootDir}${sep}`;
	if (!absolutePath.startsWith(normalizedRoot)) {
		return resolve(rootDir, "index.html");
	}
	return absolutePath;
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
	response.writeHead(statusCode, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
	});
	response.end(JSON.stringify(payload));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	const maxBytes = 1024 * 1024;

	for await (const chunk of request) {
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
		totalBytes += bytes.byteLength;
		if (totalBytes > maxBytes) {
			throw new Error("Request body too large.");
		}
		chunks.push(bytes);
	}

	const body = Buffer.concat(chunks).toString("utf8");
	if (!body.trim()) {
		throw new Error("Request body is empty.");
	}

	return JSON.parse(body) as T;
}

function validateWorkspaceChangesRequest(query: URLSearchParams): RuntimeWorkspaceChangesRequest {
	const taskId = query.get("taskId");
	if (!taskId) {
		throw new Error("Missing taskId query parameter.");
	}
	return {
		taskId,
		baseRef: query.has("baseRef") ? (query.get("baseRef") ?? "").trim() || null : undefined,
	};
}

function validateTaskWorkspaceInfoRequest(query: URLSearchParams): RuntimeTaskWorkspaceInfoRequest {
	const taskId = query.get("taskId");
	if (!taskId) {
		throw new Error("Missing taskId query parameter.");
	}
	return {
		taskId,
		baseRef: query.has("baseRef") ? (query.get("baseRef") ?? "").trim() || null : undefined,
	};
}

function validateWorkspaceFileSearchRequest(query: URLSearchParams): { query: string; limit?: number } {
	const rawQuery = query.get("q") ?? query.get("query") ?? "";
	const normalizedQuery = rawQuery.trim();
	if (!normalizedQuery) {
		return { query: "" };
	}

	const rawLimit = query.get("limit");
	if (rawLimit == null || rawLimit.trim() === "") {
		return { query: normalizedQuery };
	}
	const parsedLimit = Number.parseInt(rawLimit, 10);
	if (!Number.isFinite(parsedLimit)) {
		throw new Error("Invalid file search limit parameter.");
	}
	return {
		query: normalizedQuery,
		limit: parsedLimit,
	};
}

function validateWorktreeEnsureRequest(body: RuntimeWorktreeEnsureRequest): RuntimeWorktreeEnsureRequest {
	if (typeof body.taskId !== "string") {
		throw new Error("Invalid worktree ensure payload.");
	}
	if (typeof body.baseRef !== "string" && body.baseRef !== null && body.baseRef !== undefined) {
		throw new Error("Invalid worktree ensure payload.");
	}
	return {
		taskId: body.taskId,
		baseRef:
			body.baseRef === undefined ? undefined : typeof body.baseRef === "string" ? body.baseRef.trim() || null : null,
	};
}

function validateWorktreeDeleteRequest(body: RuntimeWorktreeDeleteRequest): RuntimeWorktreeDeleteRequest {
	if (typeof body.taskId !== "string") {
		throw new Error("Invalid worktree delete payload.");
	}
	return body;
}

function validateWorkspaceStateSaveRequest(body: RuntimeWorkspaceStateSaveRequest): RuntimeWorkspaceStateSaveRequest {
	if (!body || typeof body !== "object") {
		throw new Error("Invalid workspace state payload.");
	}
	if (!body.board || typeof body.board !== "object") {
		throw new Error("Workspace state payload is missing board data.");
	}
	if (!body.sessions || typeof body.sessions !== "object" || Array.isArray(body.sessions)) {
		throw new Error("Workspace state payload is missing sessions data.");
	}
	if (
		body.expectedRevision !== undefined &&
		(typeof body.expectedRevision !== "number" ||
			!Number.isInteger(body.expectedRevision) ||
			body.expectedRevision < 0)
	) {
		throw new Error("Workspace state payload includes an invalid expectedRevision.");
	}
	return body;
}

function validateProjectAddRequest(body: RuntimeProjectAddRequest): RuntimeProjectAddRequest {
	if (!body || typeof body !== "object" || typeof body.path !== "string") {
		throw new Error("Invalid project add payload.");
	}
	const path = body.path.trim();
	if (!path) {
		throw new Error("Project path cannot be empty.");
	}
	return {
		path,
	};
}

function validateProjectRemoveRequest(body: RuntimeProjectRemoveRequest): RuntimeProjectRemoveRequest {
	if (!body || typeof body !== "object" || typeof body.projectId !== "string") {
		throw new Error("Invalid project remove payload.");
	}
	const projectId = body.projectId.trim();
	if (!projectId) {
		throw new Error("Project ID cannot be empty.");
	}
	return {
		projectId,
	};
}

function resolveProjectInputPath(inputPath: string, cwd: string): string {
	if (inputPath === "~") {
		return homedir();
	}
	if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
		return resolve(homedir(), inputPath.slice(2));
	}
	return resolve(cwd, inputPath);
}

async function assertPathIsDirectory(path: string): Promise<void> {
	const info = await stat(path);
	if (!info.isDirectory()) {
		throw new Error(`Project path is not a directory: ${path}`);
	}
}

async function pathIsDirectory(path: string): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isDirectory();
	} catch {
		return false;
	}
}

function getProjectName(path: string): string {
	const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "");
	if (!normalized) {
		return path;
	}
	const segments = normalized.split("/").filter((segment) => segment.length > 0);
	return segments[segments.length - 1] ?? normalized;
}

function createEmptyProjectTaskCounts(): RuntimeProjectTaskCounts {
	return {
		backlog: 0,
		in_progress: 0,
		review: 0,
		trash: 0,
	};
}

function countTasksByColumn(board: RuntimeBoardData): RuntimeProjectTaskCounts {
	const counts = createEmptyProjectTaskCounts();
	for (const column of board.columns) {
		const count = column.cards.length;
		switch (column.id) {
			case "backlog":
				counts.backlog += count;
				break;
			case "in_progress":
				counts.in_progress += count;
				break;
			case "review":
				counts.review += count;
				break;
			case "trash":
				counts.trash += count;
				break;
		}
	}
	return counts;
}

function collectProjectWorktreeTaskIdsForRemoval(board: RuntimeBoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		if (column.id === "backlog" || column.id === "trash") {
			continue;
		}
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function applyLiveSessionStateToProjectTaskCounts(
	counts: RuntimeProjectTaskCounts,
	board: RuntimeBoardData,
	sessionSummaries: RuntimeWorkspaceStateResponse["sessions"],
): RuntimeProjectTaskCounts {
	const taskColumnById = new Map<string, RuntimeBoardColumnId>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			taskColumnById.set(card.id, column.id);
		}
	}
	const next = {
		...counts,
	};
	for (const summary of Object.values(sessionSummaries)) {
		const columnId = taskColumnById.get(summary.taskId);
		if (!columnId) {
			continue;
		}
		if (summary.state === "awaiting_review" && columnId === "in_progress") {
			next.in_progress = Math.max(0, next.in_progress - 1);
			next.review += 1;
			continue;
		}
		if (summary.state === "interrupted" && columnId !== "trash") {
			next[columnId] = Math.max(0, next[columnId] - 1);
			next.trash += 1;
		}
	}
	return next;
}

function toProjectSummary(project: {
	workspaceId: string;
	repoPath: string;
	taskCounts: RuntimeProjectTaskCounts;
}): RuntimeProjectSummary {
	return {
		id: project.workspaceId,
		path: project.repoPath,
		name: getProjectName(project.repoPath),
		taskCounts: project.taskCounts,
	};
}

function pickDirectoryPathFromSystemDialog(): string | null {
	if (process.platform === "darwin") {
		const result = spawnSync(
			"osascript",
			["-e", 'POSIX path of (choose folder with prompt "Select a project folder")'],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		if (result.status !== 0) {
			return null;
		}
		const selected = typeof result.stdout === "string" ? result.stdout.trim() : "";
		return selected || null;
	}

	if (process.platform === "linux") {
		const result = spawnSync("zenity", ["--file-selection", "--directory", "--title=Select project folder"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		if (result.status !== 0) {
			return null;
		}
		const selected = typeof result.stdout === "string" ? result.stdout.trim() : "";
		return selected || null;
	}

	return null;
}

function validateRuntimeConfigSaveRequest(body: RuntimeConfigSaveRequest): RuntimeConfigSaveRequest {
	if (
		body.selectedAgentId !== "claude" &&
		body.selectedAgentId !== "codex" &&
		body.selectedAgentId !== "gemini" &&
		body.selectedAgentId !== "opencode" &&
		body.selectedAgentId !== "cline"
	) {
		throw new Error("Invalid runtime config payload.");
	}
	if (body.shortcuts && !Array.isArray(body.shortcuts)) {
		throw new Error("Invalid runtime shortcuts payload.");
	}
	for (const shortcut of body.shortcuts ?? []) {
		if (
			typeof shortcut.id !== "string" ||
			typeof shortcut.label !== "string" ||
			typeof shortcut.command !== "string"
		) {
			throw new Error("Invalid runtime shortcut entry.");
		}
	}
	return body;
}

function validateShortcutRunRequest(body: RuntimeShortcutRunRequest): RuntimeShortcutRunRequest {
	if (typeof body.command !== "string") {
		throw new Error("Invalid shortcut run payload.");
	}
	const command = body.command.trim();
	if (!command) {
		throw new Error("Shortcut command cannot be empty.");
	}
	return {
		command,
	};
}

function validateTaskSessionStartRequest(body: RuntimeTaskSessionStartRequest): RuntimeTaskSessionStartRequest {
	if (typeof body.taskId !== "string" || typeof body.prompt !== "string") {
		throw new Error("Invalid task session start payload.");
	}
	if (typeof body.baseRef !== "string" && body.baseRef !== null && body.baseRef !== undefined) {
		throw new Error("Invalid task session start payload.");
	}
	if (typeof body.startInPlanMode !== "boolean" && body.startInPlanMode !== undefined) {
		throw new Error("Invalid task session start payload.");
	}
	return body;
}

function validateTaskSessionStopRequest(body: RuntimeTaskSessionStopRequest): RuntimeTaskSessionStopRequest {
	if (typeof body.taskId !== "string") {
		throw new Error("Invalid task session stop payload.");
	}
	return body;
}

function validateShellSessionStartRequest(body: RuntimeShellSessionStartRequest): RuntimeShellSessionStartRequest {
	if (!body || typeof body !== "object" || typeof body.taskId !== "string") {
		throw new Error("Invalid shell session start payload.");
	}
	const taskId = body.taskId.trim();
	if (!taskId) {
		throw new Error("Shell session taskId cannot be empty.");
	}
	if (
		(body.cols !== undefined && (!Number.isFinite(body.cols) || body.cols <= 0)) ||
		(body.rows !== undefined && (!Number.isFinite(body.rows) || body.rows <= 0))
	) {
		throw new Error("Invalid shell session dimensions.");
	}
	if (
		body.workspaceTaskId !== undefined &&
		(typeof body.workspaceTaskId !== "string" || !body.workspaceTaskId.trim())
	) {
		throw new Error("Invalid shell session workspaceTaskId.");
	}
	if (typeof body.baseRef !== "string" && body.baseRef !== null && body.baseRef !== undefined) {
		throw new Error("Invalid shell session baseRef.");
	}
	const workspaceTaskId = body.workspaceTaskId?.trim() || undefined;
	const baseRef =
		typeof body.baseRef === "string" ? body.baseRef.trim() || null : body.baseRef === null ? null : undefined;
	return {
		taskId,
		cols: body.cols,
		rows: body.rows,
		workspaceTaskId,
		baseRef,
	};
}

function resolveInteractiveShellCommand(): { binary: string; args: string[] } {
	if (process.platform === "win32") {
		const command = process.env.COMSPEC?.trim();
		if (command) {
			return {
				binary: command,
				args: [],
			};
		}
		return {
			binary: "powershell.exe",
			args: ["-NoLogo"],
		};
	}

	const command = process.env.SHELL?.trim();
	if (command) {
		return {
			binary: command,
			args: ["-i"],
		};
	}
	return {
		binary: "bash",
		args: ["-i"],
	};
}

async function resolveTaskBaseRef(cwd: string, taskId: string): Promise<string | null> {
	const workspace = await loadWorkspaceState(cwd);
	for (const column of workspace.board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return typeof card.baseRef === "string" ? card.baseRef.trim() || null : null;
		}
	}
	return null;
}

async function readAsset(rootDir: string, requestPathname: string): Promise<{ content: Buffer; contentType: string }> {
	let resolvedPath = resolveAssetPath(rootDir, requestPathname);

	try {
		const content = await readFile(resolvedPath);
		const extension = extname(resolvedPath).toLowerCase();
		return {
			content,
			contentType: MIME_TYPES[extension] ?? "application/octet-stream",
		};
	} catch (error) {
		if (!shouldFallbackToIndexHtml(requestPathname)) {
			throw error;
		}
		resolvedPath = resolve(rootDir, "index.html");
		const content = await readFile(resolvedPath);
		return {
			content,
			contentType: MIME_TYPES[".html"],
		};
	}
}

function openInBrowser(url: string): void {
	if (process.platform === "darwin") {
		const child = spawn("open", [url], { detached: true, stdio: "ignore" });
		child.unref();
		return;
	}
	if (process.platform === "win32") {
		const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
		child.unref();
		return;
	}
	const child = spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
	child.unref();
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EADDRINUSE"
	);
}

async function canReachKanbananaServer(port: number, workspaceId: string): Promise<boolean> {
	try {
		const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
			headers: {
				"x-kanbanana-workspace-id": workspaceId,
			},
			signal: AbortSignal.timeout(1_500),
		});
		if (!response.ok) {
			return false;
		}
		const payload = (await response.json().catch(() => null)) as RuntimeProjectsResponse | null;
		return Boolean(payload && Array.isArray(payload.projects));
	} catch {
		return false;
	}
}

async function tryOpenExistingServer(port: number, noOpen: boolean): Promise<boolean> {
	const context = await loadWorkspaceContext(process.cwd());
	const running = await canReachKanbananaServer(port, context.workspaceId);
	if (!running) {
		return false;
	}
	const projectUrl = `http://127.0.0.1:${port}/${encodeURIComponent(context.workspaceId)}`;
	console.log(`Kanbanana already running at http://127.0.0.1:${port}`);
	if (!noOpen) {
		try {
			openInBrowser(projectUrl);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`Could not open browser automatically: ${message}`);
		}
	}
	console.log(`Project URL: ${projectUrl}`);
	return true;
}

async function runShortcutCommand(command: string, cwd: string): Promise<RuntimeShortcutRunResponse> {
	const startedAt = Date.now();
	const outputLimitBytes = 64 * 1024;

	return await new Promise<RuntimeShortcutRunResponse>((resolve, reject) => {
		const child = spawn(command, {
			cwd,
			shell: true,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (!child.stdout || !child.stderr) {
			reject(new Error("Shortcut process did not expose stdout/stderr."));
			return;
		}

		let stdout = "";
		let stderr = "";

		const appendOutput = (current: string, chunk: string): string => {
			const next = current + chunk;
			if (next.length <= outputLimitBytes) {
				return next;
			}
			return next.slice(0, outputLimitBytes);
		};

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout = appendOutput(stdout, String(chunk));
		});

		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr = appendOutput(stderr, String(chunk));
		});

		child.on("error", (error) => {
			reject(error);
		});

		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
		}, 60_000);

		child.on("close", (code) => {
			clearTimeout(timeout);
			const exitCode = typeof code === "number" ? code : 1;
			const combinedOutput = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
			resolve({
				exitCode,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
				combinedOutput,
				durationMs: Date.now() - startedAt,
			});
		});
	});
}

function moveTaskToTrash(
	board: RuntimeWorkspaceStateResponse["board"],
	taskId: string,
): RuntimeWorkspaceStateResponse["board"] {
	const columns = board.columns.map((column) => ({
		...column,
		cards: [...column.cards],
	}));
	let removedCard: RuntimeWorkspaceStateResponse["board"]["columns"][number]["cards"][number] | undefined;

	for (const column of columns) {
		const cardIndex = column.cards.findIndex((candidate) => candidate.id === taskId);
		if (cardIndex === -1) {
			continue;
		}
		removedCard = column.cards[cardIndex];
		column.cards.splice(cardIndex, 1);
		break;
	}

	if (!removedCard) {
		return board;
	}
	const trashColumnIndex = columns.findIndex((column) => column.id === "trash");
	if (trashColumnIndex === -1) {
		return board;
	}
	const trashColumn = columns[trashColumnIndex];
	if (!trashColumn.cards.some((candidate) => candidate.id === taskId)) {
		trashColumn.cards.push({
			...removedCard,
			updatedAt: Date.now(),
		});
	}
	return {
		columns,
	};
}

async function persistInterruptedSessions(
	cwd: string,
	interruptedTaskIds: string[],
	terminalManager: TerminalSessionManager,
): Promise<void> {
	if (interruptedTaskIds.length === 0) {
		return;
	}
	const workspaceState = await loadWorkspaceState(cwd);
	let nextBoard = workspaceState.board;
	for (const taskId of interruptedTaskIds) {
		nextBoard = moveTaskToTrash(nextBoard, taskId);
	}
	const nextSessions = {
		...workspaceState.sessions,
	};
	for (const taskId of interruptedTaskIds) {
		const summary = terminalManager.getSummary(taskId);
		if (summary) {
			nextSessions[taskId] = {
				...summary,
				state: "interrupted",
				reviewReason: "interrupted",
				updatedAt: Date.now(),
			};
		}
	}
	await saveWorkspaceState(cwd, {
		board: nextBoard,
		sessions: nextSessions,
	});
}

async function startServer(
	port: number,
): Promise<{ url: string; close: () => Promise<void>; shutdown: () => Promise<void> }> {
	const webUiDir = getWebUiDir();
	const initialWorkspace = await loadWorkspaceContext(process.cwd());
	let activeWorkspaceId = initialWorkspace.workspaceId;
	let activeWorkspacePath = initialWorkspace.repoPath;
	const getActiveWorkspacePath = () => activeWorkspacePath;
	const getActiveWorkspaceId = () => activeWorkspaceId;
	let runtimeConfig = await loadRuntimeConfig(getActiveWorkspacePath());
	const workspacePathsById = new Map<string, string>([[initialWorkspace.workspaceId, initialWorkspace.repoPath]]);
	const projectTaskCountsByWorkspaceId = new Map<string, RuntimeProjectTaskCounts>();
	const terminalManagersByWorkspaceId = new Map<string, TerminalSessionManager>();
	const terminalManagerLoadPromises = new Map<string, Promise<TerminalSessionManager>>();
	const terminalSummaryUnsubscribeByWorkspaceId = new Map<string, () => void>();
	const pendingTaskSessionSummariesByWorkspaceId = new Map<string, Map<string, RuntimeTaskSessionSummary>>();
	const taskSessionBroadcastTimersByWorkspaceId = new Map<string, NodeJS.Timeout>();
	const runtimeStateClientsByWorkspaceId = new Map<string, Set<WebSocket>>();
	const runtimeStateClients = new Set<WebSocket>();
	const runtimeStateWorkspaceIdByClient = new Map<WebSocket, string>();
	const runtimeStateWebSocketServer = new WebSocketServer({ noServer: true });
	const workspaceFileChangeBroadcastTimersByWorkspaceId = new Map<string, NodeJS.Timeout>();
	const workspaceFileRefreshIntervalsByWorkspaceId = new Map<string, NodeJS.Timeout>();

	const sendRuntimeStateMessage = (client: WebSocket, payload: RuntimeStateStreamMessage) => {
		if (client.readyState !== WebSocket.OPEN) {
			return;
		}
		try {
			client.send(JSON.stringify(payload));
		} catch {
			// Ignore websocket write errors; close handlers clean up disconnected sockets.
		}
	};

	const flushWorkspaceFileChangeBroadcast = (workspaceId: string) => {
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			return;
		}
		const payload: RuntimeStateStreamWorkspaceRetrieveStatusMessage = {
			type: "workspace_retrieve_status",
			workspaceId,
			retrievedAt: Date.now(),
		};
		for (const client of runtimeClients) {
			sendRuntimeStateMessage(client, payload);
		}
	};

	const queueWorkspaceFileChangeBroadcast = (workspaceId: string) => {
		if (workspaceFileChangeBroadcastTimersByWorkspaceId.has(workspaceId)) {
			return;
		}
		const timer = setTimeout(() => {
			workspaceFileChangeBroadcastTimersByWorkspaceId.delete(workspaceId);
			flushWorkspaceFileChangeBroadcast(workspaceId);
		}, WORKSPACE_FILE_CHANGE_STREAM_BATCH_MS);
		timer.unref();
		workspaceFileChangeBroadcastTimersByWorkspaceId.set(workspaceId, timer);
	};

	const disposeWorkspaceFileChangeBroadcast = (workspaceId: string) => {
		const timer = workspaceFileChangeBroadcastTimersByWorkspaceId.get(workspaceId);
		if (timer) {
			clearTimeout(timer);
		}
		workspaceFileChangeBroadcastTimersByWorkspaceId.delete(workspaceId);
	};

	const ensureWorkspaceFileRefresh = (workspaceId: string) => {
		if (workspaceFileRefreshIntervalsByWorkspaceId.has(workspaceId)) {
			return;
		}
		queueWorkspaceFileChangeBroadcast(workspaceId);
		const timer = setInterval(() => {
			queueWorkspaceFileChangeBroadcast(workspaceId);
		}, WORKSPACE_FILE_WATCH_INTERVAL_MS);
		timer.unref();
		workspaceFileRefreshIntervalsByWorkspaceId.set(workspaceId, timer);
	};

	const disposeWorkspaceFileRefresh = (workspaceId: string) => {
		const timer = workspaceFileRefreshIntervalsByWorkspaceId.get(workspaceId);
		if (timer) {
			clearInterval(timer);
		}
		workspaceFileRefreshIntervalsByWorkspaceId.delete(workspaceId);
		disposeWorkspaceFileChangeBroadcast(workspaceId);
	};

	const flushTaskSessionSummaries = (workspaceId: string) => {
		const pending = pendingTaskSessionSummariesByWorkspaceId.get(workspaceId);
		if (!pending || pending.size === 0) {
			return;
		}
		pendingTaskSessionSummariesByWorkspaceId.delete(workspaceId);
		const summaries = Array.from(pending.values());
		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (runtimeClients && runtimeClients.size > 0) {
			const payload: RuntimeStateStreamTaskSessionsMessage = {
				type: "task_sessions_updated",
				workspaceId,
				summaries,
			};
			for (const client of runtimeClients) {
				sendRuntimeStateMessage(client, payload);
			}
		}
		void broadcastRuntimeProjectsUpdated(workspaceId);
	};

	const queueTaskSessionSummaryBroadcast = (workspaceId: string, summary: RuntimeTaskSessionSummary) => {
		const pending =
			pendingTaskSessionSummariesByWorkspaceId.get(workspaceId) ?? new Map<string, RuntimeTaskSessionSummary>();
		pending.set(summary.taskId, summary);
		pendingTaskSessionSummariesByWorkspaceId.set(workspaceId, pending);
		if (taskSessionBroadcastTimersByWorkspaceId.has(workspaceId)) {
			return;
		}
		const timer = setTimeout(() => {
			taskSessionBroadcastTimersByWorkspaceId.delete(workspaceId);
			flushTaskSessionSummaries(workspaceId);
		}, TASK_SESSION_STREAM_BATCH_MS);
		timer.unref();
		taskSessionBroadcastTimersByWorkspaceId.set(workspaceId, timer);
	};

	const disposeTaskSessionSummaryBroadcast = (workspaceId: string) => {
		const timer = taskSessionBroadcastTimersByWorkspaceId.get(workspaceId);
		if (timer) {
			clearTimeout(timer);
		}
		taskSessionBroadcastTimersByWorkspaceId.delete(workspaceId);
		pendingTaskSessionSummariesByWorkspaceId.delete(workspaceId);
	};

	const ensureTerminalSummarySubscription = (workspaceId: string, manager: TerminalSessionManager) => {
		if (terminalSummaryUnsubscribeByWorkspaceId.has(workspaceId)) {
			return;
		}
		const unsubscribe = manager.onSummary((summary) => {
			queueTaskSessionSummaryBroadcast(workspaceId, summary);
		});
		terminalSummaryUnsubscribeByWorkspaceId.set(workspaceId, unsubscribe);
	};

	const getTerminalManagerForWorkspace = (workspaceId: string): TerminalSessionManager | null =>
		terminalManagersByWorkspaceId.get(workspaceId) ?? null;

	const ensureTerminalManagerForWorkspace = async (
		workspaceId: string,
		repoPath: string,
	): Promise<TerminalSessionManager> => {
		workspacePathsById.set(workspaceId, repoPath);
		const existing = terminalManagersByWorkspaceId.get(workspaceId);
		if (existing) {
			ensureTerminalSummarySubscription(workspaceId, existing);
			return existing;
		}
		const pending = terminalManagerLoadPromises.get(workspaceId);
		if (pending) {
			const loaded = await pending;
			ensureTerminalSummarySubscription(workspaceId, loaded);
			return loaded;
		}
		const loading = (async () => {
			const manager = new TerminalSessionManager();
			try {
				const existingWorkspace = await loadWorkspaceState(repoPath);
				manager.hydrateFromRecord(existingWorkspace.sessions);
			} catch {
				// Workspace state will be created on demand.
			}
			terminalManagersByWorkspaceId.set(workspaceId, manager);
			return manager;
		})().finally(() => {
			terminalManagerLoadPromises.delete(workspaceId);
		});
		terminalManagerLoadPromises.set(workspaceId, loading);
		const loaded = await loading;
		ensureTerminalSummarySubscription(workspaceId, loaded);
		return loaded;
	};

	const setActiveWorkspace = async (workspaceId: string, repoPath: string): Promise<void> => {
		activeWorkspaceId = workspaceId;
		activeWorkspacePath = repoPath;
		workspacePathsById.set(workspaceId, repoPath);
		await ensureTerminalManagerForWorkspace(workspaceId, repoPath);
		runtimeConfig = await loadRuntimeConfig(getActiveWorkspacePath());
	};

	const disposeWorkspaceRuntimeResources = (
		workspaceId: string,
		options?: {
			stopTerminalSessions?: boolean;
			disconnectClients?: boolean;
			closeClientErrorMessage?: string;
		},
	): void => {
		const removedTerminalManager = getTerminalManagerForWorkspace(workspaceId);
		if (removedTerminalManager) {
			if (options?.stopTerminalSessions !== false) {
				removedTerminalManager.markInterruptedAndStopAll();
			}
			terminalManagersByWorkspaceId.delete(workspaceId);
			terminalManagerLoadPromises.delete(workspaceId);
		}

		const unsubscribeSummary = terminalSummaryUnsubscribeByWorkspaceId.get(workspaceId);
		if (unsubscribeSummary) {
			try {
				unsubscribeSummary();
			} catch {
				// Ignore listener cleanup errors during project removal.
			}
		}
		terminalSummaryUnsubscribeByWorkspaceId.delete(workspaceId);
		disposeTaskSessionSummaryBroadcast(workspaceId);
		disposeWorkspaceFileRefresh(workspaceId);
		projectTaskCountsByWorkspaceId.delete(workspaceId);
		workspacePathsById.delete(workspaceId);

		if (!options?.disconnectClients) {
			return;
		}

		const runtimeClients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!runtimeClients || runtimeClients.size === 0) {
			runtimeStateClientsByWorkspaceId.delete(workspaceId);
			return;
		}

		for (const runtimeClient of runtimeClients) {
			if (options?.closeClientErrorMessage) {
				sendRuntimeStateMessage(runtimeClient, {
					type: "error",
					message: options.closeClientErrorMessage,
				} satisfies RuntimeStateStreamErrorMessage);
			}
			runtimeStateClients.delete(runtimeClient);
			runtimeStateWorkspaceIdByClient.delete(runtimeClient);
			try {
				runtimeClient.close();
			} catch {
				// Ignore close failures while disposing removed workspace clients.
			}
		}
		runtimeStateClientsByWorkspaceId.delete(workspaceId);
	};

	const pruneMissingWorkspaceEntries = async (
		projects: RuntimeWorkspaceIndexEntry[],
	): Promise<{
		projects: RuntimeWorkspaceIndexEntry[];
		removedProjects: RuntimeWorkspaceIndexEntry[];
	}> => {
		const existingProjects: RuntimeWorkspaceIndexEntry[] = [];
		const removedProjects: RuntimeWorkspaceIndexEntry[] = [];

		for (const project of projects) {
			if (await pathIsDirectory(project.repoPath)) {
				existingProjects.push(project);
				continue;
			}

			removedProjects.push(project);
			await removeWorkspaceIndexEntry(project.workspaceId);
			await removeWorkspaceStateFiles(project.workspaceId);
			disposeWorkspaceRuntimeResources(project.workspaceId, {
				disconnectClients: true,
				closeClientErrorMessage: `Project no longer exists on disk and was removed: ${project.repoPath}`,
			});
		}

		return {
			projects: existingProjects,
			removedProjects,
		};
	};

	const summarizeProjectTaskCounts = async (
		workspaceId: string,
		repoPath: string,
	): Promise<RuntimeProjectTaskCounts> => {
		try {
			const workspaceState = await loadWorkspaceState(repoPath);
			const persistedCounts = countTasksByColumn(workspaceState.board);
			const terminalManager = getTerminalManagerForWorkspace(workspaceId);
			if (!terminalManager) {
				projectTaskCountsByWorkspaceId.set(workspaceId, persistedCounts);
				return persistedCounts;
			}
			const liveSessionsByTaskId: RuntimeWorkspaceStateResponse["sessions"] = {};
			for (const summary of terminalManager.listSummaries()) {
				liveSessionsByTaskId[summary.taskId] = summary;
			}
			const nextCounts = applyLiveSessionStateToProjectTaskCounts(
				persistedCounts,
				workspaceState.board,
				liveSessionsByTaskId,
			);
			projectTaskCountsByWorkspaceId.set(workspaceId, nextCounts);
			return nextCounts;
		} catch {
			return projectTaskCountsByWorkspaceId.get(workspaceId) ?? createEmptyProjectTaskCounts();
		}
	};

	const buildWorkspaceStateSnapshot = async (
		workspaceId: string,
		workspacePath: string,
	): Promise<RuntimeWorkspaceStateResponse> => {
		const response: RuntimeWorkspaceStateResponse = await loadWorkspaceState(workspacePath);
		const terminalManager = await ensureTerminalManagerForWorkspace(workspaceId, workspacePath);
		for (const summary of terminalManager.listSummaries()) {
			response.sessions[summary.taskId] = summary;
		}
		return response;
	};

	const buildProjectsPayload = async (
		preferredCurrentProjectId: string | null,
	): Promise<RuntimeStateStreamProjectsMessage> => {
		const projects = await listWorkspaceIndexEntries();
		const fallbackProjectId =
			projects.find((project) => project.workspaceId === activeWorkspaceId)?.workspaceId ??
			projects[0]?.workspaceId ??
			null;
		const resolvedCurrentProjectId =
			(preferredCurrentProjectId &&
				projects.some((project) => project.workspaceId === preferredCurrentProjectId) &&
				preferredCurrentProjectId) ||
			fallbackProjectId;
		const projectSummaries = await Promise.all(
			projects.map(async (project) => {
				const taskCounts = await summarizeProjectTaskCounts(project.workspaceId, project.repoPath);
				return toProjectSummary({
					workspaceId: project.workspaceId,
					repoPath: project.repoPath,
					taskCounts,
				});
			}),
		);
		return {
			type: "projects_updated",
			currentProjectId: resolvedCurrentProjectId,
			projects: projectSummaries,
		};
	};

	const resolveWorkspaceForStream = async (
		requestedWorkspaceId: string | null,
	): Promise<{
		workspaceId: string | null;
		workspacePath: string | null;
		removedRequestedWorkspacePath: string | null;
		didPruneProjects: boolean;
	}> => {
		const allProjects = await listWorkspaceIndexEntries();
		const { projects, removedProjects } = await pruneMissingWorkspaceEntries(allProjects);
		const removedRequestedWorkspacePath = requestedWorkspaceId
			? (removedProjects.find((project) => project.workspaceId === requestedWorkspaceId)?.repoPath ?? null)
			: null;

		const activeWorkspaceMissing = !projects.some((project) => project.workspaceId === activeWorkspaceId);
		if (activeWorkspaceMissing && projects[0]) {
			await setActiveWorkspace(projects[0].workspaceId, projects[0].repoPath);
		}

		if (requestedWorkspaceId) {
			const requestedWorkspace = projects.find((project) => project.workspaceId === requestedWorkspaceId);
			if (requestedWorkspace) {
				return {
					workspaceId: requestedWorkspace.workspaceId,
					workspacePath: requestedWorkspace.repoPath,
					removedRequestedWorkspacePath,
					didPruneProjects: removedProjects.length > 0,
				};
			}
		}

		const fallbackWorkspace =
			projects.find((project) => project.workspaceId === activeWorkspaceId) ?? projects[0] ?? null;
		if (!fallbackWorkspace) {
			return {
				workspaceId: null,
				workspacePath: null,
				removedRequestedWorkspacePath,
				didPruneProjects: removedProjects.length > 0,
			};
		}
		return {
			workspaceId: fallbackWorkspace.workspaceId,
			workspacePath: fallbackWorkspace.repoPath,
			removedRequestedWorkspacePath,
			didPruneProjects: removedProjects.length > 0,
		};
	};

	const broadcastRuntimeWorkspaceStateUpdated = async (workspaceId: string, workspacePath: string): Promise<void> => {
		const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
		if (!clients || clients.size === 0) {
			return;
		}
		try {
			const workspaceState = await buildWorkspaceStateSnapshot(workspaceId, workspacePath);
			const payload: RuntimeStateStreamWorkspaceStateMessage = {
				type: "workspace_state_updated",
				workspaceId,
				workspaceState,
			};
			for (const client of clients) {
				sendRuntimeStateMessage(client, payload);
			}
		} catch {
			// Ignore transient state read failures; next update will resync.
		}
	};

	const broadcastRuntimeProjectsUpdated = async (preferredCurrentProjectId: string | null): Promise<void> => {
		if (runtimeStateClients.size === 0) {
			return;
		}
		try {
			const payload = await buildProjectsPayload(preferredCurrentProjectId);
			for (const client of runtimeStateClients) {
				sendRuntimeStateMessage(client, payload);
			}
		} catch {
			// Ignore transient project summary failures; next update will resync.
		}
	};

	await ensureTerminalManagerForWorkspace(initialWorkspace.workspaceId, initialWorkspace.repoPath);

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		console.error("Could not find web UI assets.");
		console.error("Run `npm run build` to generate and package the web UI.");
		process.exit(1);
	}

	const disposeRuntimeStreamResources = () => {
		for (const timer of taskSessionBroadcastTimersByWorkspaceId.values()) {
			clearTimeout(timer);
		}
		taskSessionBroadcastTimersByWorkspaceId.clear();
		pendingTaskSessionSummariesByWorkspaceId.clear();
		for (const timer of workspaceFileRefreshIntervalsByWorkspaceId.values()) {
			clearInterval(timer);
		}
		workspaceFileRefreshIntervalsByWorkspaceId.clear();
		for (const timer of workspaceFileChangeBroadcastTimersByWorkspaceId.values()) {
			clearTimeout(timer);
		}
		workspaceFileChangeBroadcastTimersByWorkspaceId.clear();
		for (const unsubscribe of terminalSummaryUnsubscribeByWorkspaceId.values()) {
			try {
				unsubscribe();
			} catch {
				// Ignore listener cleanup errors during shutdown.
			}
		}
		terminalSummaryUnsubscribeByWorkspaceId.clear();
	};

	const server = createServer(async (req, res) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);
			const isApiRequest = pathname.startsWith("/api/");
			const requestedWorkspaceId = isApiRequest ? readWorkspaceIdFromRequest(req, requestUrl) : null;
			const requestedWorkspaceContext = requestedWorkspaceId
				? await loadWorkspaceContextById(requestedWorkspaceId)
				: null;
			const getRequiredWorkspaceScope = (): { workspaceId: string; workspacePath: string } | null => {
				if (!requestedWorkspaceId) {
					sendJson(res, 400, {
						error: "Missing workspace scope. Include x-kanbanana-workspace-id header or workspaceId query parameter.",
					});
					return null;
				}
				if (!requestedWorkspaceContext) {
					sendJson(res, 404, {
						error: `Unknown workspace ID: ${requestedWorkspaceId}`,
					});
					return null;
				}
				return {
					workspaceId: requestedWorkspaceContext.workspaceId,
					workspacePath: requestedWorkspaceContext.repoPath,
				};
			};

			const getScopedTerminalManager = async (scope: {
				workspaceId: string;
				workspacePath: string;
			}): Promise<TerminalSessionManager> =>
				await ensureTerminalManagerForWorkspace(scope.workspaceId, scope.workspacePath);

			const loadScopedRuntimeConfig = async (scope: { workspaceId: string; workspacePath: string }) => {
				if (scope.workspaceId === getActiveWorkspaceId()) {
					return runtimeConfig;
				}
				return await loadRuntimeConfig(scope.workspacePath);
			};

			if (pathname === "/api/runtime/config" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				const scopedRuntimeConfig = await loadScopedRuntimeConfig(scope);
				const payload: RuntimeConfigResponse = buildRuntimeConfigResponse(scopedRuntimeConfig);
				sendJson(res, 200, payload);
				return;
			}

			if (pathname === "/api/runtime/slash-commands" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const scopedRuntimeConfig = await loadScopedRuntimeConfig(scope);
					const resolved = resolveAgentCommand(scopedRuntimeConfig);
					if (!resolved) {
						sendJson(res, 200, {
							agentId: null,
							commands: [],
							error: "No runnable agent command is configured.",
						} satisfies RuntimeSlashCommandsResponse);
						return;
					}
					const taskId = requestUrl.searchParams.get("taskId")?.trim();
					let commandCwd = scope.workspacePath;
					if (taskId) {
						const taskBaseRef = await resolveTaskBaseRef(scope.workspacePath, taskId);
						commandCwd = await resolveTaskCwd({
							cwd: scope.workspacePath,
							taskId,
							baseRef: taskBaseRef,
							ensure: false,
						});
					}
					const discovered = await discoverRuntimeSlashCommands(resolved, commandCwd);
					sendJson(res, 200, {
						agentId: resolved.agentId,
						commands: discovered.commands,
						error: discovered.error,
					} satisfies RuntimeSlashCommandsResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/runtime/config" && req.method === "PUT") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateRuntimeConfigSaveRequest(await readJsonBody<RuntimeConfigSaveRequest>(req));
					const currentRuntimeConfig = await loadScopedRuntimeConfig(scope);
					const nextRuntimeConfig = await saveRuntimeConfig(scope.workspacePath, {
						selectedAgentId: body.selectedAgentId,
						shortcuts: body.shortcuts ?? currentRuntimeConfig.shortcuts,
					});
					if (scope.workspaceId === getActiveWorkspaceId()) {
						runtimeConfig = nextRuntimeConfig;
					}
					const payload: RuntimeConfigResponse = buildRuntimeConfigResponse(nextRuntimeConfig);
					sendJson(res, 200, payload);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/runtime/task-session/start" && req.method === "POST") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateTaskSessionStartRequest(await readJsonBody<RuntimeTaskSessionStartRequest>(req));
					const scopedRuntimeConfig = await loadScopedRuntimeConfig(scope);
					const resolved = resolveAgentCommand(scopedRuntimeConfig);
					if (!resolved) {
						sendJson(res, 400, {
							ok: false,
							summary: null,
							error: "No runnable agent command is configured. Open Settings, install a supported CLI, and select it.",
						} satisfies RuntimeTaskSessionStartResponse);
						return;
					}
					const taskBaseRef =
						body.baseRef === undefined
							? await resolveTaskBaseRef(scope.workspacePath, body.taskId)
							: typeof body.baseRef === "string"
								? body.baseRef.trim() || null
								: null;
					const taskCwd = await resolveTaskCwd({
						cwd: scope.workspacePath,
						taskId: body.taskId,
						baseRef: taskBaseRef,
						ensure: true,
					});
					const terminalManager = await getScopedTerminalManager(scope);
					const summary = await terminalManager.startTaskSession({
						taskId: body.taskId,
						agentId: resolved.agentId,
						binary: resolved.binary,
						args: resolved.args,
						cwd: taskCwd,
						prompt: body.prompt,
						startInPlanMode: body.startInPlanMode,
						cols: body.cols,
						rows: body.rows,
						serverPort: port,
						workspaceId: scope.workspaceId,
					});
					sendJson(res, 200, {
						ok: true,
						summary,
					} satisfies RuntimeTaskSessionStartResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						summary: null,
						error: message,
					} satisfies RuntimeTaskSessionStartResponse);
				}
				return;
			}

			if (pathname === "/api/runtime/task-session/stop" && req.method === "POST") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateTaskSessionStopRequest(await readJsonBody<RuntimeTaskSessionStopRequest>(req));
					const terminalManager = await getScopedTerminalManager(scope);
					const summary = terminalManager.stopTaskSession(body.taskId);
					sendJson(res, 200, {
						ok: Boolean(summary),
						summary,
					} satisfies RuntimeTaskSessionStopResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						summary: null,
						error: message,
					} satisfies RuntimeTaskSessionStopResponse);
				}
				return;
			}

			if (pathname === "/api/runtime/shell-session/start" && req.method === "POST") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateShellSessionStartRequest(await readJsonBody<RuntimeShellSessionStartRequest>(req));
					const terminalManager = await getScopedTerminalManager(scope);
					const shell = resolveInteractiveShellCommand();
					const shellCwd = body.workspaceTaskId
						? await resolveTaskCwd({
								cwd: scope.workspacePath,
								taskId: body.workspaceTaskId,
								baseRef: body.baseRef,
								ensure: true,
							})
						: scope.workspacePath;
					const summary = await terminalManager.startShellSession({
						taskId: body.taskId,
						cwd: shellCwd,
						cols: body.cols,
						rows: body.rows,
						binary: shell.binary,
						args: shell.args,
					});
					sendJson(res, 200, {
						ok: true,
						summary,
						shellBinary: shell.binary,
					} satisfies RuntimeShellSessionStartResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						summary: null,
						shellBinary: null,
						error: message,
					} satisfies RuntimeShellSessionStartResponse);
				}
				return;
			}

			if (pathname === "/api/hooks/ingest" && req.method === "POST") {
				try {
					const body = await readJsonBody<RuntimeHookIngestRequest>(req);
					const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
					const event = body.event as RuntimeHookEvent;
					if (!taskId) {
						sendJson(res, 400, { ok: false, error: "Missing taskId" } satisfies RuntimeHookIngestResponse);
						return;
					}
					if (event !== "review" && event !== "inprogress") {
						sendJson(res, 400, {
							ok: false,
							error: `Invalid event "${String(event)}". Must be "review" or "inprogress"`,
						} satisfies RuntimeHookIngestResponse);
						return;
					}

					let matchedWorkspaceId: string | null = null;
					let matchedManager: TerminalSessionManager | null = null;
					let matchedSummary: RuntimeTaskSessionSummary | null = null;
					for (const [wsId, manager] of terminalManagersByWorkspaceId.entries()) {
						const summary = manager.getSummary(taskId);
						if (!summary) {
							continue;
						}
						const eligibleForReview = summary.state === "running";
						const eligibleForInProgress =
							summary.state === "awaiting_review" &&
							(summary.reviewReason === "attention" || summary.reviewReason === "hook");
						const eligible = event === "review" ? eligibleForReview : eligibleForInProgress;
						if (eligible) {
							matchedWorkspaceId = wsId;
							matchedManager = manager;
							matchedSummary = summary;
							break;
						}
						if (!matchedManager) {
							matchedWorkspaceId = wsId;
							matchedManager = manager;
							matchedSummary = summary;
						}
					}
					if (!matchedManager || !matchedWorkspaceId || !matchedSummary) {
						sendJson(res, 404, {
							ok: false,
							error: `Task "${taskId}" not found in any workspace`,
						} satisfies RuntimeHookIngestResponse);
						return;
					}
					const eligibleForReview = matchedSummary.state === "running";
					const eligibleForInProgress =
						matchedSummary.state === "awaiting_review" &&
						(matchedSummary.reviewReason === "attention" || matchedSummary.reviewReason === "hook");
					const eligible = event === "review" ? eligibleForReview : eligibleForInProgress;
					if (!eligible) {
						sendJson(res, 409, {
							ok: false,
							error: `Task "${taskId}" cannot handle "${event}" from state "${matchedSummary.state}" (${matchedSummary.reviewReason ?? "no reason"})`,
						} satisfies RuntimeHookIngestResponse);
						return;
					}

					let transitionedSummary: RuntimeTaskSessionSummary | null = null;
					if (event === "review") {
						transitionedSummary = matchedManager.transitionToReview(taskId, "hook");
					} else {
						transitionedSummary = matchedManager.transitionToRunning(taskId);
					}
					if (!transitionedSummary) {
						sendJson(res, 500, {
							ok: false,
							error: `Task "${taskId}" transition failed`,
						} satisfies RuntimeHookIngestResponse);
						return;
					}

					const matchedWorkspacePath = workspacePathsById.get(matchedWorkspaceId);
					if (matchedWorkspacePath) {
						void broadcastRuntimeWorkspaceStateUpdated(matchedWorkspaceId, matchedWorkspacePath);
					}

					sendJson(res, 200, { ok: true } satisfies RuntimeHookIngestResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { ok: false, error: message } satisfies RuntimeHookIngestResponse);
				}
				return;
			}

			if (pathname === "/api/runtime/shortcut/run" && req.method === "POST") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateShortcutRunRequest(await readJsonBody<RuntimeShortcutRunRequest>(req));
					const response = await runShortcutCommand(body.command, scope.workspacePath);
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/git/summary" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const summary = await getGitSyncSummary(scope.workspacePath);
					sendJson(res, 200, {
						ok: true,
						summary,
					} satisfies RuntimeGitSummaryResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						summary: {
							hasGit: false,
							currentBranch: null,
							upstreamBranch: null,
							changedFiles: 0,
							additions: 0,
							deletions: 0,
							aheadCount: 0,
							behindCount: 0,
						},
						error: message,
					} satisfies RuntimeGitSummaryResponse);
				}
				return;
			}

			if (
				(pathname === "/api/workspace/git/fetch" ||
					pathname === "/api/workspace/git/pull" ||
					pathname === "/api/workspace/git/push") &&
				req.method === "POST"
			) {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				const action: RuntimeGitSyncAction = pathname.endsWith("/fetch")
					? "fetch"
					: pathname.endsWith("/pull")
						? "pull"
						: "push";
				try {
					const response = await runGitSyncAction({
						cwd: scope.workspacePath,
						action,
					});
					sendJson(res, response.ok ? 200 : 400, response satisfies RuntimeGitSyncResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						action,
						summary: {
							hasGit: false,
							currentBranch: null,
							upstreamBranch: null,
							changedFiles: 0,
							additions: 0,
							deletions: 0,
							aheadCount: 0,
							behindCount: 0,
						},
						output: "",
						error: message,
					} satisfies RuntimeGitSyncResponse);
				}
				return;
			}

			if (pathname === "/api/workspace/changes" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const query = validateWorkspaceChangesRequest(requestUrl.searchParams);
					const taskBaseRef =
						query.baseRef === undefined
							? await resolveTaskBaseRef(scope.workspacePath, query.taskId)
							: query.baseRef;
					const taskCwd = await resolveTaskCwd({
						cwd: scope.workspacePath,
						taskId: query.taskId,
						baseRef: taskBaseRef,
						ensure: false,
					});
					const response = await getWorkspaceChanges(taskCwd);
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/worktree/ensure" && req.method === "POST") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateWorktreeEnsureRequest(await readJsonBody<RuntimeWorktreeEnsureRequest>(req));
					const response = await ensureTaskWorktree({
						cwd: scope.workspacePath,
						taskId: body.taskId,
						baseRef: body.baseRef,
					});
					sendJson(res, response.ok ? 200 : 500, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/worktree/delete" && req.method === "POST") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateWorktreeDeleteRequest(await readJsonBody<RuntimeWorktreeDeleteRequest>(req));
					const response = await deleteTaskWorktree({
						repoPath: scope.workspacePath,
						taskId: body.taskId,
					});
					sendJson(res, response.ok ? 200 : 500, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/task-context" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const query = validateTaskWorkspaceInfoRequest(requestUrl.searchParams);
					const taskBaseRef =
						query.baseRef === undefined
							? await resolveTaskBaseRef(scope.workspacePath, query.taskId)
							: query.baseRef;
					const response = await getTaskWorkspaceInfo({
						cwd: scope.workspacePath,
						taskId: query.taskId,
						baseRef: taskBaseRef,
					});
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/files/search" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const query = validateWorkspaceFileSearchRequest(requestUrl.searchParams);
					const files = await searchWorkspaceFiles(scope.workspacePath, query.query, query.limit);
					const response: RuntimeWorkspaceFileSearchResponse = {
						query: query.query,
						files,
					};
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/state" && req.method === "GET") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const response = await buildWorkspaceStateSnapshot(scope.workspaceId, scope.workspacePath);
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/state" && req.method === "PUT") {
				const scope = getRequiredWorkspaceScope();
				if (!scope) {
					return;
				}
				try {
					const body = validateWorkspaceStateSaveRequest(
						await readJsonBody<RuntimeWorkspaceStateSaveRequest>(req),
					);
					const terminalManager = await getScopedTerminalManager(scope);
					for (const summary of terminalManager.listSummaries()) {
						body.sessions[summary.taskId] = summary;
					}
					const response: RuntimeWorkspaceStateResponse = await saveWorkspaceState(scope.workspacePath, body);
					void broadcastRuntimeWorkspaceStateUpdated(scope.workspaceId, scope.workspacePath);
					void broadcastRuntimeProjectsUpdated(scope.workspaceId);
					sendJson(res, 200, response);
				} catch (error) {
					if (error instanceof WorkspaceStateConflictError) {
						sendJson(res, 409, {
							error: error.message,
							currentRevision: error.currentRevision,
						} satisfies RuntimeWorkspaceStateConflictResponse);
						return;
					}
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/projects" && req.method === "GET") {
				try {
					const payload = await buildProjectsPayload(requestedWorkspaceContext?.workspaceId ?? null);
					sendJson(res, 200, {
						currentProjectId: payload.currentProjectId,
						projects: payload.projects,
					} satisfies RuntimeProjectsResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/projects/add" && req.method === "POST") {
				try {
					const body = validateProjectAddRequest(await readJsonBody<RuntimeProjectAddRequest>(req));
					const resolveBasePath = requestedWorkspaceContext?.repoPath ?? getActiveWorkspacePath();
					const projectPath = resolveProjectInputPath(body.path, resolveBasePath);
					await assertPathIsDirectory(projectPath);
					const context = await loadWorkspaceContext(projectPath);
					workspacePathsById.set(context.workspaceId, context.repoPath);
					const projectsAfterAdd = await listWorkspaceIndexEntries();
					const hasActiveWorkspace = projectsAfterAdd.some((project) => project.workspaceId === activeWorkspaceId);
					if (!hasActiveWorkspace) {
						await setActiveWorkspace(context.workspaceId, context.repoPath);
					}
					const taskCounts = await summarizeProjectTaskCounts(context.workspaceId, context.repoPath);
					sendJson(res, 200, {
						ok: true,
						project: toProjectSummary({
							workspaceId: context.workspaceId,
							repoPath: context.repoPath,
							taskCounts,
						}),
					} satisfies RuntimeProjectAddResponse);
					void broadcastRuntimeProjectsUpdated(context.workspaceId);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						project: null,
						error: message,
					} satisfies RuntimeProjectAddResponse);
				}
				return;
			}

			if (pathname === "/api/projects/remove" && req.method === "POST") {
				try {
					const body = validateProjectRemoveRequest(await readJsonBody<RuntimeProjectRemoveRequest>(req));
					const projectsBeforeRemoval = await listWorkspaceIndexEntries();
					const projectToRemove = projectsBeforeRemoval.find((project) => project.workspaceId === body.projectId);
					if (!projectToRemove) {
						sendJson(res, 404, {
							ok: false,
							error: `Unknown project ID: ${body.projectId}`,
						} satisfies RuntimeProjectRemoveResponse);
						return;
					}

					const taskIdsToCleanup = new Set<string>();
					try {
						const workspaceState = await loadWorkspaceState(projectToRemove.repoPath);
						for (const taskId of collectProjectWorktreeTaskIdsForRemoval(workspaceState.board)) {
							taskIdsToCleanup.add(taskId);
						}
					} catch {
						// Best effort: if board state cannot be read, skip worktree cleanup IDs.
					}

					const removedTerminalManager = getTerminalManagerForWorkspace(body.projectId);
					if (removedTerminalManager) {
						removedTerminalManager.markInterruptedAndStopAll();
					}

					const removed = await removeWorkspaceIndexEntry(body.projectId);
					if (!removed) {
						throw new Error(`Could not remove project index entry for "${body.projectId}".`);
					}
					await removeWorkspaceStateFiles(body.projectId);
					disposeWorkspaceRuntimeResources(body.projectId, {
						stopTerminalSessions: false,
					});

					if (activeWorkspaceId === body.projectId) {
						const remaining = await listWorkspaceIndexEntries();
						const fallbackWorkspace = remaining[0];
						if (fallbackWorkspace) {
							await setActiveWorkspace(fallbackWorkspace.workspaceId, fallbackWorkspace.repoPath);
						}
					}
					sendJson(res, 200, {
						ok: true,
					} satisfies RuntimeProjectRemoveResponse);
					void broadcastRuntimeProjectsUpdated(activeWorkspaceId);
					if (taskIdsToCleanup.size > 0) {
						const cleanupTaskIds = Array.from(taskIdsToCleanup);
						void (async () => {
							for (const taskId of cleanupTaskIds) {
								const deleted = await deleteTaskWorktree({
									repoPath: projectToRemove.repoPath,
									taskId,
								});
								if (!deleted.ok) {
									const message = deleted.error ?? `Could not delete task workspace for task "${taskId}".`;
									console.warn(`[kanbanana] ${message}`);
								}
							}
						})();
					}
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						error: message,
					} satisfies RuntimeProjectRemoveResponse);
				}
				return;
			}

			if (pathname === "/api/projects/pick-directory" && req.method === "POST") {
				try {
					const selectedPath = pickDirectoryPathFromSystemDialog();
					if (!selectedPath) {
						sendJson(res, 200, {
							ok: false,
							path: null,
							error: "No directory was selected.",
						} satisfies RuntimeProjectDirectoryPickerResponse);
						return;
					}
					sendJson(res, 200, {
						ok: true,
						path: selectedPath,
					} satisfies RuntimeProjectDirectoryPickerResponse);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, {
						ok: false,
						path: null,
						error: message,
					} satisfies RuntimeProjectDirectoryPickerResponse);
				}
				return;
			}

			if (pathname.startsWith("/api/")) {
				sendJson(res, 404, { error: "Not found" });
				return;
			}

			const asset = await readAsset(webUiDir, pathname);
			res.writeHead(200, {
				"Content-Type": asset.contentType,
				"Cache-Control": "no-store",
			});
			res.end(asset.content);
		} catch {
			res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("Not Found");
		}
	});
	server.on("upgrade", (request, socket, head) => {
		let requestUrl: URL;
		try {
			requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
		} catch {
			socket.destroy();
			return;
		}
		if (normalizeRequestPath(requestUrl.pathname) !== "/api/runtime/ws") {
			return;
		}
		(request as IncomingMessage & { __kanbananaUpgradeHandled?: boolean }).__kanbananaUpgradeHandled = true;
		const requestedWorkspaceId = requestUrl.searchParams.get("workspaceId")?.trim() || null;
		runtimeStateWebSocketServer.handleUpgrade(request, socket, head, (ws) => {
			runtimeStateWebSocketServer.emit("connection", ws, { requestedWorkspaceId });
		});
	});
	runtimeStateWebSocketServer.on("connection", async (client: WebSocket, context: unknown) => {
		const cleanupRuntimeStateClient = () => {
			const workspaceId = runtimeStateWorkspaceIdByClient.get(client);
			if (workspaceId) {
				const clients = runtimeStateClientsByWorkspaceId.get(workspaceId);
				if (clients) {
					clients.delete(client);
					if (clients.size === 0) {
						runtimeStateClientsByWorkspaceId.delete(workspaceId);
						disposeWorkspaceFileRefresh(workspaceId);
					}
				}
			}
			runtimeStateWorkspaceIdByClient.delete(client);
			runtimeStateClients.delete(client);
		};
		client.on("close", cleanupRuntimeStateClient);
		try {
			const requestedWorkspaceId =
				typeof context === "object" &&
				context !== null &&
				"requestedWorkspaceId" in context &&
				typeof (context as { requestedWorkspaceId?: unknown }).requestedWorkspaceId === "string"
					? (context as { requestedWorkspaceId: string }).requestedWorkspaceId || null
					: null;
			const workspace = await resolveWorkspaceForStream(requestedWorkspaceId);
			if (client.readyState !== WebSocket.OPEN) {
				cleanupRuntimeStateClient();
				return;
			}

			runtimeStateClients.add(client);
			if (workspace.workspaceId) {
				const workspaceClients =
					runtimeStateClientsByWorkspaceId.get(workspace.workspaceId) ?? new Set<WebSocket>();
				workspaceClients.add(client);
				runtimeStateClientsByWorkspaceId.set(workspace.workspaceId, workspaceClients);
				runtimeStateWorkspaceIdByClient.set(client, workspace.workspaceId);
			}

			try {
				let projectsPayload: RuntimeStateStreamProjectsMessage;
				let workspaceState: RuntimeWorkspaceStateResponse | null;
				if (workspace.workspaceId && workspace.workspacePath) {
					[projectsPayload, workspaceState] = await Promise.all([
						buildProjectsPayload(workspace.workspaceId),
						buildWorkspaceStateSnapshot(workspace.workspaceId, workspace.workspacePath),
					]);
				} else {
					projectsPayload = await buildProjectsPayload(null);
					workspaceState = null;
				}
				sendRuntimeStateMessage(client, {
					type: "snapshot",
					currentProjectId: projectsPayload.currentProjectId,
					projects: projectsPayload.projects,
					workspaceState,
				} satisfies RuntimeStateStreamSnapshotMessage);
				if (workspace.removedRequestedWorkspacePath) {
					sendRuntimeStateMessage(client, {
						type: "error",
						message: `Project no longer exists on disk and was removed: ${workspace.removedRequestedWorkspacePath}`,
					} satisfies RuntimeStateStreamErrorMessage);
				}
				if (workspace.didPruneProjects) {
					void broadcastRuntimeProjectsUpdated(workspace.workspaceId);
				}
				if (workspace.workspaceId) {
					ensureWorkspaceFileRefresh(workspace.workspaceId);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				sendRuntimeStateMessage(client, {
					type: "error",
					message,
				} satisfies RuntimeStateStreamErrorMessage);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			sendRuntimeStateMessage(client, {
				type: "error",
				message,
			} satisfies RuntimeStateStreamErrorMessage);
			client.close();
		}
	});
	const terminalWebSocketBridge = createTerminalWebSocketBridge({
		server,
		resolveTerminalManager: (workspaceId) => getTerminalManagerForWorkspace(workspaceId),
		isTerminalWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/ws",
	});
	server.on("upgrade", (request, socket) => {
		const handled = (request as IncomingMessage & { __kanbananaUpgradeHandled?: boolean }).__kanbananaUpgradeHandled;
		if (handled) {
			return;
		}
		socket.destroy();
	});

	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(port, "127.0.0.1", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to start local server.");
	}
	const url = `http://127.0.0.1:${address.port}/${encodeURIComponent(activeWorkspaceId)}`;

	const close = async () => {
		disposeRuntimeStreamResources();
		for (const client of runtimeStateClients) {
			try {
				client.terminate();
			} catch {
				// Ignore websocket termination errors during shutdown.
			}
		}
		runtimeStateClients.clear();
		runtimeStateClientsByWorkspaceId.clear();
		runtimeStateWorkspaceIdByClient.clear();
		await new Promise<void>((resolveCloseWebSockets) => {
			runtimeStateWebSocketServer.close(() => {
				resolveCloseWebSockets();
			});
		});
		await terminalWebSocketBridge.close();
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => {
				if (error) {
					rejectClose(error);
					return;
				}
				resolveClose();
			});
		});
	};

	const shutdown = async () => {
		for (const [workspaceId, terminalManager] of terminalManagersByWorkspaceId.entries()) {
			const interrupted = terminalManager.markInterruptedAndStopAll();
			const interruptedTaskIds = interrupted.map((summary) => summary.taskId);
			const workspacePath = workspacePathsById.get(workspaceId);
			if (!workspacePath) {
				continue;
			}
			await persistInterruptedSessions(workspacePath, interruptedTaskIds, terminalManager);
		}
		await close();
	};

	return {
		url,
		close,
		shutdown,
	};
}

async function run(): Promise<void> {
	const argv = process.argv.slice(2);
	if (isHooksSubcommand(argv)) {
		await runHooksIngest(argv);
		return;
	}

	const options = parseCliOptions(argv);

	if (options.help) {
		printHelp();
		return;
	}
	if (options.version) {
		console.log("0.1.0");
		return;
	}

	const board = createSampleBoard();
	if (options.json) {
		console.log(JSON.stringify(board, null, 2));
		return;
	}

	let runtime: Awaited<ReturnType<typeof startServer>>;
	try {
		runtime = await startServer(options.port);
	} catch (error) {
		if (isAddressInUseError(error) && (await tryOpenExistingServer(options.port, options.noOpen))) {
			return;
		}
		throw error;
	}
	console.log(`Kanbanana running at ${runtime.url}`);
	if (!options.noOpen) {
		try {
			openInBrowser(runtime.url);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`Could not open browser automatically: ${message}`);
		}
	}
	console.log("Press Ctrl+C to stop.");

	let isShuttingDown = false;
	const shutdown = async (signal: "SIGINT" | "SIGTERM") => {
		if (isShuttingDown) {
			process.exit(130);
			return;
		}
		isShuttingDown = true;
		const forceExitTimer = setTimeout(() => {
			console.error(`Forced exit after ${signal} timeout.`);
			process.exit(130);
		}, 3000);
		forceExitTimer.unref();
		try {
			await runtime.shutdown();
			clearTimeout(forceExitTimer);
			process.exit(130);
		} catch (error) {
			clearTimeout(forceExitTimer);
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Shutdown failed: ${message}`);
			process.exit(1);
		}
	};
	process.on("SIGINT", () => {
		void shutdown("SIGINT");
	});
	process.on("SIGTERM", () => {
		void shutdown("SIGTERM");
	});
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start Kanbanana: ${message}`);
	process.exit(1);
});
