#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import { WebSocket, WebSocketServer } from "ws";

import { isHooksSubcommand, runHooksSubcommand } from "./hooks-cli.js";
import { isMcpSubcommand, runMcpSubcommand } from "./mcp-cli.js";
import type {
	RuntimeAgentId,
	RuntimeBoardColumnId,
	RuntimeBoardData,
	RuntimeProjectSummary,
	RuntimeProjectTaskCounts,
	RuntimeShortcutRunResponse,
	RuntimeStateStreamErrorMessage,
	RuntimeStateStreamMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskSessionsMessage,
	RuntimeStateStreamWorkspaceRetrieveStatusMessage,
	RuntimeStateStreamWorkspaceStateMessage,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "./runtime/api-contract.js";
import { loadRuntimeConfig, updateRuntimeConfig } from "./runtime/config/runtime-config.js";
import { createGitProcessEnv } from "./runtime/git-process-env.js";
import {
	buildKanbananaRuntimeUrl,
	KANBANANA_RUNTIME_HOST,
	KANBANANA_RUNTIME_ORIGIN,
	KANBANANA_RUNTIME_PORT,
} from "./runtime/runtime-endpoint.js";
import {
	listWorkspaceIndexEntries,
	loadWorkspaceContext,
	loadWorkspaceContextById,
	loadWorkspaceState,
	type RuntimeWorkspaceIndexEntry,
	removeWorkspaceIndexEntry,
	removeWorkspaceStateFiles,
	saveWorkspaceState,
} from "./runtime/state/workspace-state.js";
import { updateTaskDependencies } from "./runtime/task-board-mutations.js";
import { TerminalSessionManager } from "./runtime/terminal/session-manager.js";
import { createTerminalWebSocketBridge } from "./runtime/terminal/ws-server.js";
import { type RuntimeTrpcWorkspaceScope, runtimeAppRouter } from "./runtime/trpc/app-router.js";
import { createHooksApi } from "./runtime/trpc/hooks-api.js";
import { createProjectsApi } from "./runtime/trpc/projects-api.js";
import { createRuntimeApi } from "./runtime/trpc/runtime-api.js";
import { createWorkspaceApi } from "./runtime/trpc/workspace-api.js";
import { deleteTaskWorktree } from "./runtime/workspace/task-worktree.js";

interface CliOptions {
	help: boolean;
	version: boolean;
	noOpen: boolean;
	agent: RuntimeAgentId | null;
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

const TASK_SESSION_STREAM_BATCH_MS = 150;
const WORKSPACE_FILE_CHANGE_STREAM_BATCH_MS = 25;
const WORKSPACE_FILE_WATCH_INTERVAL_MS = 2_000;
const CLI_AGENT_IDS: readonly RuntimeAgentId[] = ["claude", "codex", "gemini", "opencode", "cline"];

function parseCliAgentId(value: string): RuntimeAgentId {
	const normalized = value.trim().toLowerCase();
	if (
		normalized === "claude" ||
		normalized === "codex" ||
		normalized === "gemini" ||
		normalized === "opencode" ||
		normalized === "cline"
	) {
		return normalized;
	}
	throw new Error(`Invalid agent: ${value}. Expected one of: ${CLI_AGENT_IDS.join(", ")}`);
}

function parseCliOptions(argv: string[]): CliOptions {
	let help = false;
	let version = false;
	let noOpen = false;
	let agent: RuntimeAgentId | null = null;

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
		if (arg === "--no-open") {
			noOpen = true;
			continue;
		}
		if (arg === "--agent") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --agent.");
			}
			agent = parseCliAgentId(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--agent=")) {
			const value = arg.slice("--agent=".length);
			if (!value) {
				throw new Error("Missing value for --agent.");
			}
			agent = parseCliAgentId(value);
		}
	}

	return { help, version, noOpen, agent };
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
	console.log("  kanbanana [--agent <id>] [--no-open] [--help] [--version]");
	console.log("  kanbanana mcp");
	console.log("");
	console.log(`Runtime URL: ${KANBANANA_RUNTIME_ORIGIN}`);
	console.log(`Agent IDs: ${CLI_AGENT_IDS.join(", ")}`);
}

async function persistCliAgentSelection(cwd: string, selectedAgentId: RuntimeAgentId): Promise<boolean> {
	const currentRuntimeConfig = await loadRuntimeConfig(cwd);
	if (currentRuntimeConfig.selectedAgentId === selectedAgentId) {
		return false;
	}
	await updateRuntimeConfig(cwd, { selectedAgentId });
	return true;
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

function hasGitRepository(path: string): boolean {
	const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
		cwd: path,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		env: createGitProcessEnv(),
	});
	return result.status === 0 && result.stdout.trim() === "true";
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

async function canReachKanbananaServer(workspaceId: string | null): Promise<boolean> {
	try {
		const headers: Record<string, string> = {};
		if (workspaceId) {
			headers["x-kanbanana-workspace-id"] = workspaceId;
		}
		const response = await fetch(buildKanbananaRuntimeUrl("/api/trpc/projects.list"), {
			method: "GET",
			headers,
			signal: AbortSignal.timeout(1_500),
		});
		if (response.status === 404) {
			return false;
		}
		const payload = (await response.json().catch(() => null)) as {
			result?: { data?: unknown };
			error?: unknown;
		} | null;
		return Boolean(payload && (payload.result || payload.error));
	} catch {
		return false;
	}
}

async function tryOpenExistingServer(noOpen: boolean): Promise<boolean> {
	let workspaceId: string | null = null;
	if (hasGitRepository(process.cwd())) {
		const context = await loadWorkspaceContext(process.cwd());
		workspaceId = context.workspaceId;
	}
	const running = await canReachKanbananaServer(workspaceId);
	if (!running) {
		return false;
	}
	const projectUrl = workspaceId
		? buildKanbananaRuntimeUrl(`/${encodeURIComponent(workspaceId)}`)
		: KANBANANA_RUNTIME_ORIGIN;
	console.log(`Kanbanana already running at ${KANBANANA_RUNTIME_ORIGIN}`);
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
		trashColumn.cards.unshift({
			...removedCard,
			updatedAt: Date.now(),
		});
	}
	return updateTaskDependencies({
		...board,
		columns,
	});
}

async function persistInterruptedSessions(
	cwd: string,
	interruptedTaskIds: string[],
	terminalManager: TerminalSessionManager,
): Promise<string[]> {
	if (interruptedTaskIds.length === 0) {
		return [];
	}
	const workspaceState = await loadWorkspaceState(cwd);
	const worktreeTaskIds = collectProjectWorktreeTaskIdsForRemoval(workspaceState.board);
	const worktreeTaskIdsToCleanup = interruptedTaskIds.filter((taskId) => worktreeTaskIds.has(taskId));
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
	return worktreeTaskIdsToCleanup;
}

async function cleanupInterruptedTaskWorktrees(repoPath: string, taskIds: string[]): Promise<void> {
	if (taskIds.length === 0) {
		return;
	}
	const deletions = await Promise.all(
		taskIds.map(async (taskId) => ({
			taskId,
			deleted: await deleteTaskWorktree({
				repoPath,
				taskId,
			}),
		})),
	);
	for (const { taskId, deleted } of deletions) {
		if (deleted.ok) {
			continue;
		}
		const message = deleted.error ?? `Could not delete task workspace for task "${taskId}" during shutdown.`;
		console.warn(`[kanbanana] ${message}`);
	}
}

function shouldInterruptSessionOnShutdown(summary: RuntimeTaskSessionSummary): boolean {
	if (summary.state === "running") {
		return true;
	}
	return summary.state === "awaiting_review";
}

function collectShutdownInterruptedTaskIds(
	interruptedSummaries: RuntimeTaskSessionSummary[],
	terminalManager: TerminalSessionManager,
): string[] {
	const taskIds = new Set(interruptedSummaries.map((summary) => summary.taskId));
	for (const summary of terminalManager.listSummaries()) {
		if (!shouldInterruptSessionOnShutdown(summary)) {
			continue;
		}
		taskIds.add(summary.taskId);
	}
	return Array.from(taskIds);
}

async function startServer(): Promise<{ url: string; close: () => Promise<void>; shutdown: () => Promise<void> }> {
	const webUiDir = getWebUiDir();
	const launchedFromGitRepo = hasGitRepository(process.cwd());
	const initialWorkspace = launchedFromGitRepo ? await loadWorkspaceContext(process.cwd()) : null;
	let indexedWorkspace: RuntimeWorkspaceIndexEntry | null = null;
	if (!initialWorkspace) {
		const indexedWorkspaces = await listWorkspaceIndexEntries();
		indexedWorkspace = indexedWorkspaces[0] ?? null;
	}
	let activeWorkspaceId: string | null = initialWorkspace?.workspaceId ?? indexedWorkspace?.workspaceId ?? null;
	let activeWorkspacePath: string | null = initialWorkspace?.repoPath ?? indexedWorkspace?.repoPath ?? null;
	const getActiveWorkspacePath = () => activeWorkspacePath;
	const getActiveWorkspaceId = () => activeWorkspaceId;
	let runtimeConfig = await loadRuntimeConfig(activeWorkspacePath ?? process.cwd());
	const workspacePathsById = new Map<string, string>(
		activeWorkspaceId && activeWorkspacePath ? [[activeWorkspaceId, activeWorkspacePath]] : [],
	);
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
		runtimeConfig = await loadRuntimeConfig(repoPath);
	};

	const clearActiveWorkspace = (): void => {
		activeWorkspaceId = null;
		activeWorkspacePath = null;
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
			if (!(await pathIsDirectory(project.repoPath))) {
				removedProjects.push(project);
				await removeWorkspaceIndexEntry(project.workspaceId);
				await removeWorkspaceStateFiles(project.workspaceId);
				disposeWorkspaceRuntimeResources(project.workspaceId, {
					disconnectClients: true,
					closeClientErrorMessage: `Project no longer exists on disk and was removed: ${project.repoPath}`,
				});
				continue;
			}

			if (hasGitRepository(project.repoPath)) {
				existingProjects.push(project);
				continue;
			}

			removedProjects.push(project);
			await removeWorkspaceIndexEntry(project.workspaceId);
			await removeWorkspaceStateFiles(project.workspaceId);
			disposeWorkspaceRuntimeResources(project.workspaceId, {
				disconnectClients: true,
				closeClientErrorMessage: `Project is not a git repository and was removed: ${project.repoPath}`,
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
		if (activeWorkspaceMissing) {
			if (projects[0]) {
				await setActiveWorkspace(projects[0].workspaceId, projects[0].repoPath);
			} else {
				clearActiveWorkspace();
			}
		}

		if (requestedWorkspaceId) {
			const requestedWorkspace = projects.find((project) => project.workspaceId === requestedWorkspaceId);
			if (requestedWorkspace) {
				if (
					activeWorkspaceId !== requestedWorkspace.workspaceId ||
					activeWorkspacePath !== requestedWorkspace.repoPath
				) {
					await setActiveWorkspace(requestedWorkspace.workspaceId, requestedWorkspace.repoPath);
				}
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

	if (initialWorkspace) {
		await ensureTerminalManagerForWorkspace(initialWorkspace.workspaceId, initialWorkspace.repoPath);
	}

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

	const resolveWorkspaceScopeFromRequest = async (
		request: IncomingMessage,
		requestUrl: URL,
	): Promise<{
		requestedWorkspaceId: string | null;
		workspaceScope: RuntimeTrpcWorkspaceScope | null;
	}> => {
		const requestedWorkspaceId = readWorkspaceIdFromRequest(request, requestUrl);
		if (!requestedWorkspaceId) {
			return {
				requestedWorkspaceId: null,
				workspaceScope: null,
			};
		}
		const requestedWorkspaceContext = await loadWorkspaceContextById(requestedWorkspaceId);
		if (!requestedWorkspaceContext) {
			return {
				requestedWorkspaceId,
				workspaceScope: null,
			};
		}
		return {
			requestedWorkspaceId,
			workspaceScope: {
				workspaceId: requestedWorkspaceContext.workspaceId,
				workspacePath: requestedWorkspaceContext.repoPath,
			},
		};
	};

	const getScopedTerminalManager = async (scope: RuntimeTrpcWorkspaceScope): Promise<TerminalSessionManager> =>
		await ensureTerminalManagerForWorkspace(scope.workspaceId, scope.workspacePath);

	const loadScopedRuntimeConfig = async (scope: RuntimeTrpcWorkspaceScope) => {
		if (scope.workspaceId === getActiveWorkspaceId()) {
			return runtimeConfig;
		}
		return await loadRuntimeConfig(scope.workspacePath);
	};

	const trpcHttpHandler = createHTTPHandler({
		basePath: "/api/trpc/",
		router: runtimeAppRouter,
		createContext: async ({ req }) => {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const scope = await resolveWorkspaceScopeFromRequest(req, requestUrl);
			return {
				requestedWorkspaceId: scope.requestedWorkspaceId,
				workspaceScope: scope.workspaceScope,
				runtimeApi: createRuntimeApi({
					getActiveWorkspaceId,
					loadScopedRuntimeConfig,
					setActiveRuntimeConfig: (nextRuntimeConfig) => {
						runtimeConfig = nextRuntimeConfig;
					},
					getScopedTerminalManager,
					resolveInteractiveShellCommand,
					runShortcutCommand,
				}),
				workspaceApi: createWorkspaceApi({
					ensureTerminalManagerForWorkspace,
					broadcastRuntimeWorkspaceStateUpdated,
					broadcastRuntimeProjectsUpdated,
					buildWorkspaceStateSnapshot,
				}),
				projectsApi: createProjectsApi({
					workspacePathsById,
					getActiveWorkspacePath,
					getActiveWorkspaceId,
					setActiveWorkspace,
					clearActiveWorkspace,
					resolveProjectInputPath,
					assertPathIsDirectory,
					hasGitRepository,
					summarizeProjectTaskCounts,
					toProjectSummary,
					broadcastRuntimeProjectsUpdated,
					getTerminalManagerForWorkspace,
					disposeWorkspaceRuntimeResources,
					collectProjectWorktreeTaskIdsForRemoval,
					warn: (message) => {
						console.warn(`[kanbanana] ${message}`);
					},
					buildProjectsPayload,
					pickDirectoryPathFromSystemDialog,
				}),
				hooksApi: createHooksApi({
					workspacePathsById,
					ensureTerminalManagerForWorkspace,
					broadcastRuntimeWorkspaceStateUpdated,
					runtimeStateClientsByWorkspaceId,
					sendRuntimeStateMessage,
				}),
			};
		},
	});

	const server = createServer(async (req, res) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);
			if (pathname.startsWith("/api/trpc")) {
				await trpcHttpHandler(req, res);
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
			requestUrl = new URL(request.url ?? "/", KANBANANA_RUNTIME_ORIGIN);
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
		server.listen(KANBANANA_RUNTIME_PORT, KANBANANA_RUNTIME_HOST, () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});

	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("Failed to start local server.");
	}
	const url = activeWorkspaceId
		? buildKanbananaRuntimeUrl(`/${encodeURIComponent(activeWorkspaceId)}`)
		: KANBANANA_RUNTIME_ORIGIN;

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
		const interruptedByWorkspace: Array<{
			workspacePath: string;
			terminalManager: TerminalSessionManager;
			interruptedTaskIds: string[];
		}> = [];
		for (const [workspaceId, terminalManager] of terminalManagersByWorkspaceId.entries()) {
			const interrupted = terminalManager.markInterruptedAndStopAll();
			const interruptedTaskIds = collectShutdownInterruptedTaskIds(interrupted, terminalManager);
			const workspacePath = workspacePathsById.get(workspaceId);
			if (!workspacePath) {
				continue;
			}
			interruptedByWorkspace.push({
				workspacePath,
				terminalManager,
				interruptedTaskIds,
			});
		}
		await Promise.all(
			interruptedByWorkspace.map(async (workspace) => {
				const worktreeTaskIds = await persistInterruptedSessions(
					workspace.workspacePath,
					workspace.interruptedTaskIds,
					workspace.terminalManager,
				);
				await cleanupInterruptedTaskWorktrees(workspace.workspacePath, worktreeTaskIds);
			}),
		);
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
	if (isMcpSubcommand(argv)) {
		await runMcpSubcommand(argv);
		return;
	}
	if (isHooksSubcommand(argv)) {
		await runHooksSubcommand(argv);
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

	if (options.agent) {
		const didChange = await persistCliAgentSelection(process.cwd(), options.agent);
		if (didChange) {
			console.log(`Default agent set to ${options.agent}.`);
		}
	}

	let runtime: Awaited<ReturnType<typeof startServer>>;
	try {
		runtime = await startServer();
	} catch (error) {
		if (isAddressInUseError(error) && (await tryOpenExistingServer(options.noOpen))) {
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
