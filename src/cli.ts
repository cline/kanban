#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createSampleBoard } from "./index.js";
import type {
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeShortcutRunRequest,
	RuntimeShortcutRunResponse,
	RuntimeSlashCommandsResponse,
	RuntimeTaskSessionListResponse,
	RuntimeTaskSessionStartRequest,
	RuntimeTaskSessionStartResponse,
	RuntimeTaskSessionStopRequest,
	RuntimeTaskSessionStopResponse,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceFileSearchResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeEnsureRequest,
} from "./runtime/api-contract.js";
import { loadRuntimeConfig, saveRuntimeConfig } from "./runtime/config/runtime-config.js";
import { loadWorkspaceState, saveWorkspaceState } from "./runtime/state/workspace-state.js";
import { buildRuntimeConfigResponse, resolveAgentCommand } from "./runtime/terminal/agent-registry.js";
import { TerminalSessionManager } from "./runtime/terminal/session-manager.js";
import { discoverRuntimeSlashCommands } from "./runtime/terminal/slash-commands.js";
import { createTerminalWebSocketBridge } from "./runtime/terminal/ws-server.js";
import { getWorkspaceChanges } from "./runtime/workspace/get-workspace-changes.js";
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
	return body;
}

function validateRuntimeConfigSaveRequest(body: RuntimeConfigSaveRequest): RuntimeConfigSaveRequest {
	if (
		body.selectedAgentId !== "claude" &&
		body.selectedAgentId !== "codex" &&
		body.selectedAgentId !== "gemini" &&
		body.selectedAgentId !== "opencode" &&
		body.selectedAgentId !== "custom"
	) {
		throw new Error("Invalid runtime config payload.");
	}
	if (typeof body.customAgentCommand !== "string" && body.customAgentCommand !== null) {
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
	let runtimeConfig = await loadRuntimeConfig();
	const terminalManager = new TerminalSessionManager();
	try {
		const existingWorkspace = await loadWorkspaceState(process.cwd());
		terminalManager.hydrateFromRecord(existingWorkspace.sessions);
	} catch {
		// Workspace state will be created on demand.
	}

	try {
		await readFile(join(webUiDir, "index.html"));
	} catch {
		console.error("Could not find web UI assets.");
		console.error("Run `npm run build` to generate and package the web UI.");
		process.exit(1);
	}

	const server = createServer(async (req, res) => {
		try {
			const requestUrl = new URL(req.url ?? "/", "http://localhost");
			const pathname = normalizeRequestPath(requestUrl.pathname);

			if (pathname === "/api/runtime/config" && req.method === "GET") {
				const payload: RuntimeConfigResponse = buildRuntimeConfigResponse(runtimeConfig);
				sendJson(res, 200, payload);
				return;
			}

			if (pathname === "/api/runtime/slash-commands" && req.method === "GET") {
				try {
					const resolved = resolveAgentCommand(runtimeConfig);
					if (!resolved) {
						sendJson(res, 200, {
							agentId: null,
							commands: [],
							error: "No runnable agent command is configured.",
						} satisfies RuntimeSlashCommandsResponse);
						return;
					}
					const taskId = requestUrl.searchParams.get("taskId")?.trim();
					let commandCwd = process.cwd();
					if (taskId) {
						const taskBaseRef = await resolveTaskBaseRef(process.cwd(), taskId);
						commandCwd = await resolveTaskCwd({
							cwd: process.cwd(),
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
				try {
					const body = validateRuntimeConfigSaveRequest(await readJsonBody<RuntimeConfigSaveRequest>(req));
					runtimeConfig = await saveRuntimeConfig({
						selectedAgentId: body.selectedAgentId,
						customAgentCommand: body.customAgentCommand,
						shortcuts: body.shortcuts ?? runtimeConfig.shortcuts,
					});
					const payload: RuntimeConfigResponse = buildRuntimeConfigResponse(runtimeConfig);
					sendJson(res, 200, payload);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/runtime/task-sessions" && req.method === "GET") {
				const payload: RuntimeTaskSessionListResponse = {
					sessions: terminalManager.listSummaries(),
				};
				sendJson(res, 200, payload);
				return;
			}

			if (pathname === "/api/runtime/task-session/start" && req.method === "POST") {
				try {
					const body = validateTaskSessionStartRequest(await readJsonBody<RuntimeTaskSessionStartRequest>(req));
					const resolved = resolveAgentCommand(runtimeConfig);
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
							? await resolveTaskBaseRef(process.cwd(), body.taskId)
							: typeof body.baseRef === "string"
								? body.baseRef.trim() || null
								: null;
					const taskCwd = await resolveTaskCwd({
						cwd: process.cwd(),
						taskId: body.taskId,
						baseRef: taskBaseRef,
						ensure: true,
					});
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
				try {
					const body = validateTaskSessionStopRequest(await readJsonBody<RuntimeTaskSessionStopRequest>(req));
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

			if (pathname === "/api/runtime/shortcut/run" && req.method === "POST") {
				try {
					const body = validateShortcutRunRequest(await readJsonBody<RuntimeShortcutRunRequest>(req));
					const response = await runShortcutCommand(body.command, process.cwd());
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/changes" && req.method === "GET") {
				try {
					const query = validateWorkspaceChangesRequest(requestUrl.searchParams);
					const taskBaseRef =
						query.baseRef === undefined ? await resolveTaskBaseRef(process.cwd(), query.taskId) : query.baseRef;
					const taskCwd = await resolveTaskCwd({
						cwd: process.cwd(),
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
				try {
					const body = validateWorktreeEnsureRequest(await readJsonBody<RuntimeWorktreeEnsureRequest>(req));
					const response = await ensureTaskWorktree({
						cwd: process.cwd(),
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
				try {
					const body = validateWorktreeDeleteRequest(await readJsonBody<RuntimeWorktreeDeleteRequest>(req));
					const response = await deleteTaskWorktree({
						cwd: process.cwd(),
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
				try {
					const query = validateTaskWorkspaceInfoRequest(requestUrl.searchParams);
					const taskBaseRef =
						query.baseRef === undefined ? await resolveTaskBaseRef(process.cwd(), query.taskId) : query.baseRef;
					const response = await getTaskWorkspaceInfo({
						cwd: process.cwd(),
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
				try {
					const query = validateWorkspaceFileSearchRequest(requestUrl.searchParams);
					const files = await searchWorkspaceFiles(process.cwd(), query.query, query.limit);
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
				try {
					const response: RuntimeWorkspaceStateResponse = await loadWorkspaceState(process.cwd());
					for (const summary of terminalManager.listSummaries()) {
						response.sessions[summary.taskId] = summary;
					}
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/workspace/state" && req.method === "PUT") {
				try {
					const body = validateWorkspaceStateSaveRequest(
						await readJsonBody<RuntimeWorkspaceStateSaveRequest>(req),
					);
					for (const summary of terminalManager.listSummaries()) {
						body.sessions[summary.taskId] = summary;
					}
					const response: RuntimeWorkspaceStateResponse = await saveWorkspaceState(process.cwd(), body);
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
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
	const terminalWebSocketBridge = createTerminalWebSocketBridge({
		server,
		terminalManager,
		isTerminalWebSocketPath: (pathname) => normalizeRequestPath(pathname) === "/api/terminal/ws",
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
	const url = `http://127.0.0.1:${address.port}`;

	const close = async () => {
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
		const interrupted = terminalManager.markInterruptedAndStopAll();
		const interruptedTaskIds = interrupted.map((summary) => summary.taskId);
		await persistInterruptedSessions(process.cwd(), interruptedTaskIds, terminalManager);
		await close();
	};

	return {
		url,
		close,
		shutdown,
	};
}

async function run(): Promise<void> {
	const options = parseCliOptions(process.argv.slice(2));

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

	const runtime = await startServer(options.port);
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
