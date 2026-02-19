#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createSampleBoard } from "./index.js";
import type {
	RuntimeAcpCancelRequest,
	RuntimeAcpCommandSource,
	RuntimeAcpHealthResponse,
	RuntimeAcpProbeRequest,
	RuntimeAcpTurnRequest,
	RuntimeAcpTurnStreamEvent,
	RuntimeConfigResponse,
	RuntimeConfigSaveRequest,
	RuntimeShortcutRunRequest,
	RuntimeShortcutRunResponse,
	RuntimeTaskWorkspaceInfoRequest,
	RuntimeWorkspaceChangesRequest,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
	RuntimeWorktreeDeleteRequest,
	RuntimeWorktreeEnsureRequest,
} from "./runtime/acp/api-contract.js";
import { probeAcpCommand } from "./runtime/acp/probe-acp-command.js";
import { cancelAcpTurn, runAcpTurn, shutdownAcpRuntimeSessions } from "./runtime/acp/run-acp-turn.js";
import { loadRuntimeConfig, saveRuntimeConfig } from "./runtime/config/runtime-config.js";
import { loadWorkspaceState, saveWorkspaceState } from "./runtime/state/workspace-state.js";
import { getWorkspaceChanges } from "./runtime/workspace/get-workspace-changes.js";
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

interface SupportedAcpAgentDefinition {
	id: string;
	label: string;
	binary: string;
	command: string;
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

const SUPPORTED_ACP_AGENTS: SupportedAcpAgentDefinition[] = [
	{
		id: "codex_acp_bridge",
		label: "OpenAI Codex (ACP bridge)",
		binary: "npx",
		command: "npx @zed-industries/codex-acp@latest",
	},
	{
		id: "claude_acp_bridge",
		label: "Claude Code (ACP bridge)",
		binary: "npx",
		command: "npx @zed-industries/claude-code-acp@latest",
	},
	{
		id: "gemini_npx_acp",
		label: "Gemini CLI (npx ACP)",
		binary: "npx",
		command: "npx @google/gemini-cli@latest --experimental-acp",
	},
	{
		id: "gemini_local_acp",
		label: "Gemini CLI (local install)",
		binary: "gemini",
		command: "gemini --experimental-acp",
	},
];

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

function resolveAcpCommand(configCommand: string | null): {
	command: string | null;
	source: RuntimeAcpCommandSource;
} {
	const envCommand = process.env.KANBANANA_ACP_COMMAND?.trim();
	if (envCommand) {
		return {
			command: envCommand,
			source: "env",
		};
	}
	if (configCommand) {
		return {
			command: configCommand,
			source: "config",
		};
	}
	return {
		command: null,
		source: "none",
	};
}

function detectInstalledAcpCommands(): string[] {
	const candidates = ["npx", "codex", "claude", "gemini"];
	const lookupCommand = process.platform === "win32" ? "where" : "which";
	const detected: string[] = [];

	for (const candidate of candidates) {
		const result = spawnSync(lookupCommand, [candidate], {
			stdio: "ignore",
		});
		if (result.status === 0) {
			detected.push(candidate);
		}
	}

	return detected;
}

function normalizeCommandLineValue(commandLine: string | null | undefined): string | null {
	if (!commandLine) {
		return null;
	}
	const trimmed = commandLine.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}
	return trimmed.replace(/\s+/g, " ");
}

function buildRuntimeConfigResponse(
	runtimeConfig: Awaited<ReturnType<typeof loadRuntimeConfig>>,
): RuntimeConfigResponse {
	const resolved = resolveAcpCommand(runtimeConfig.acpCommand);
	const detectedCommands = detectInstalledAcpCommands();
	const detectedSet = new Set(detectedCommands);
	const normalizedEffectiveCommand = normalizeCommandLineValue(resolved.command);

	return {
		acpCommand: runtimeConfig.acpCommand,
		effectiveCommand: resolved.command,
		commandSource: resolved.source,
		configPath: runtimeConfig.configPath,
		detectedCommands,
		supportedAgents: SUPPORTED_ACP_AGENTS.map((agent) => ({
			id: agent.id,
			label: agent.label,
			binary: agent.binary,
			command: agent.command,
			installed: detectedSet.has(agent.binary),
			configured: normalizedEffectiveCommand === normalizeCommandLineValue(agent.command),
		})),
		shortcuts: runtimeConfig.shortcuts,
	};
}

function validateTurnRequest(body: RuntimeAcpTurnRequest): RuntimeAcpTurnRequest {
	if (
		typeof body.taskId !== "string" ||
		typeof body.taskTitle !== "string" ||
		typeof body.taskDescription !== "string" ||
		typeof body.prompt !== "string"
	) {
		throw new Error("Invalid turn request payload.");
	}
	if (typeof body.baseRef !== "string" && body.baseRef !== null && body.baseRef !== undefined) {
		throw new Error("Invalid turn request payload.");
	}
	return body;
}

function validateCancelRequest(body: RuntimeAcpCancelRequest): RuntimeAcpCancelRequest {
	if (typeof body.taskId !== "string") {
		throw new Error("Invalid cancel request payload.");
	}
	return body;
}

function validateAcpProbeRequest(body: RuntimeAcpProbeRequest): RuntimeAcpProbeRequest {
	if (typeof body.command !== "string") {
		throw new Error("Invalid ACP probe payload.");
	}
	const command = body.command.trim();
	if (!command) {
		throw new Error("ACP probe command cannot be empty.");
	}
	return {
		command,
	};
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
	if (typeof body.acpCommand !== "string" && body.acpCommand !== null) {
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

async function startServer(port: number): Promise<{ url: string; close: () => Promise<void> }> {
	const webUiDir = getWebUiDir();
	let runtimeConfig = await loadRuntimeConfig(process.cwd());

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

			if (pathname === "/api/acp/health" && req.method === "GET") {
				const resolved = resolveAcpCommand(runtimeConfig.acpCommand);
				const detectedCommands = detectInstalledAcpCommands();
				if (!resolved.command) {
					sendJson(res, 200, {
						available: false,
						configuredCommand: null,
						commandSource: "none",
						detectedCommands,
						reason: "Set an ACP command in Settings (for example: npx @zed-industries/codex-acp@latest).",
					} satisfies RuntimeAcpHealthResponse);
					return;
				}

				const probe = await probeAcpCommand(resolved.command, process.cwd());
				const healthPayload: RuntimeAcpHealthResponse = probe.ok
					? {
							available: true,
							configuredCommand: resolved.command,
							commandSource: resolved.source,
							detectedCommands,
						}
					: {
							available: false,
							configuredCommand: resolved.command,
							commandSource: resolved.source,
							detectedCommands,
							reason:
								probe.reason ??
								`Configured ACP command '${resolved.command}' did not complete ACP initialization.`,
						};
				sendJson(res, 200, healthPayload);
				return;
			}

			if (pathname === "/api/acp/turn" && req.method === "POST") {
				const resolved = resolveAcpCommand(runtimeConfig.acpCommand);
				if (!resolved.command) {
					sendJson(res, 501, {
						error: "ACP command is not configured. Open Settings and choose an ACP agent command.",
					});
					return;
				}

				try {
					const body = validateTurnRequest(await readJsonBody<RuntimeAcpTurnRequest>(req));
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
					const wantsStream = requestUrl.searchParams.get("stream") === "1";
					if (wantsStream) {
						res.writeHead(200, {
							"Content-Type": "application/x-ndjson; charset=utf-8",
							"Cache-Control": "no-store",
							Connection: "keep-alive",
						});
						res.socket?.setNoDelay(true);
						res.flushHeaders();

						const writeEvent = (event: RuntimeAcpTurnStreamEvent): void => {
							if (res.writableEnded) {
								return;
							}
							res.write(`${JSON.stringify(event)}\n`);
						};
						const handleClose = () => {
							void cancelAcpTurn(body.taskId);
						};
						req.once("close", handleClose);

						try {
							const response = await runAcpTurn({
								commandLine: resolved.command,
								cwd: taskCwd,
								request: body,
								listeners: {
									onEntry: (entry) => writeEvent({ type: "entry", entry }),
									onStatus: (status) => writeEvent({ type: "status", status }),
									onAvailableCommands: (commands) => writeEvent({ type: "available_commands", commands }),
								},
							});
							writeEvent({ type: "complete", stopReason: response.stopReason });
						} catch (error) {
							const message = error instanceof Error ? error.message : String(error);
							writeEvent({ type: "error", error: message });
						} finally {
							req.off("close", handleClose);
							res.end();
						}
						return;
					}

					const response = await runAcpTurn({
						commandLine: resolved.command,
						cwd: taskCwd,
						request: body,
					});
					sendJson(res, 200, response);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					const status = message.includes("already has an active ACP turn") ? 409 : 500;
					sendJson(res, status, { error: message });
				}
				return;
			}

			if (pathname === "/api/runtime/config" && req.method === "GET") {
				const payload = buildRuntimeConfigResponse(runtimeConfig);
				sendJson(res, 200, payload);
				return;
			}

			if (pathname === "/api/runtime/config" && req.method === "PUT") {
				try {
					const body = validateRuntimeConfigSaveRequest(await readJsonBody<RuntimeConfigSaveRequest>(req));
					runtimeConfig = await saveRuntimeConfig(process.cwd(), {
						acpCommand: body.acpCommand,
						shortcuts: body.shortcuts ?? runtimeConfig.shortcuts,
					});
					const payload = buildRuntimeConfigResponse(runtimeConfig);
					sendJson(res, 200, payload);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
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

			if (pathname === "/api/acp/cancel" && req.method === "POST") {
				try {
					const body = validateCancelRequest(await readJsonBody<RuntimeAcpCancelRequest>(req));
					const cancelled = await cancelAcpTurn(body.taskId);
					sendJson(res, 200, { cancelled });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					sendJson(res, 500, { error: message });
				}
				return;
			}

			if (pathname === "/api/runtime/acp/probe" && req.method === "POST") {
				try {
					const body = validateAcpProbeRequest(await readJsonBody<RuntimeAcpProbeRequest>(req));
					const result = await probeAcpCommand(body.command, process.cwd());
					sendJson(res, 200, result);
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

			if (pathname === "/api/workspace/state" && req.method === "GET") {
				try {
					const response: RuntimeWorkspaceStateResponse = await loadWorkspaceState(process.cwd());
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

	return {
		url,
		close: async () => {
			await new Promise<void>((resolveClose, rejectClose) => {
				server.close((error) => {
					if (error) {
						rejectClose(error);
						return;
					}
					resolveClose();
				});
			});
		},
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

	const shutdown = async () => {
		await shutdownAcpRuntimeSessions();
		await runtime.close();
		process.exit(0);
	};
	process.on("SIGINT", () => {
		void shutdown();
	});
	process.on("SIGTERM", () => {
		void shutdown();
	});
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start Kanbanana: ${message}`);
	process.exit(1);
});
