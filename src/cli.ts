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
	RuntimeAcpHealthResponse,
	RuntimeAcpTurnRequest,
	RuntimeWorkspaceChangesRequest,
} from "./runtime/acp/api-contract.js";
import { cancelAcpTurn, runAcpTurn, shutdownAcpRuntimeSessions } from "./runtime/acp/run-acp-turn.js";
import { getWorkspaceChanges } from "./runtime/workspace/get-workspace-changes.js";

interface CliOptions {
	help: boolean;
	version: boolean;
	json: boolean;
	noOpen: boolean;
	port: number | null;
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

function parseCliOptions(argv: string[]): CliOptions {
	let help = false;
	let version = false;
	let json = false;
	let noOpen = false;
	let port: number | null = null;

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

function getConfiguredAcpCommand(): string | null {
	const command = process.env.KANBANANA_ACP_COMMAND?.trim();
	if (!command) {
		return null;
	}
	return command;
}

function detectInstalledAcpCommands(): string[] {
	const candidates = ["codex", "claude", "gemini"];
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

function validateTurnRequest(body: RuntimeAcpTurnRequest): RuntimeAcpTurnRequest {
	if (
		typeof body.taskId !== "string" ||
		typeof body.taskTitle !== "string" ||
		typeof body.taskDescription !== "string" ||
		typeof body.prompt !== "string"
	) {
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

function validateWorkspaceChangesRequest(query: URLSearchParams): RuntimeWorkspaceChangesRequest {
	const taskId = query.get("taskId");
	if (!taskId) {
		throw new Error("Missing taskId query parameter.");
	}
	return { taskId };
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

async function startServer(port: number | null): Promise<{ url: string; close: () => Promise<void> }> {
	const webUiDir = getWebUiDir();

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
				const configuredCommand = getConfiguredAcpCommand();
				const detectedCommands = detectInstalledAcpCommands();
				const payload: RuntimeAcpHealthResponse = configuredCommand
					? { available: true, configuredCommand, detectedCommands }
					: {
							available: false,
							configuredCommand: null,
							detectedCommands,
							reason: "Set KANBANANA_ACP_COMMAND to an ACP provider command (for example: codex --acp).",
						};
				sendJson(res, 200, payload);
				return;
			}

			if (pathname === "/api/acp/turn" && req.method === "POST") {
				const configuredCommand = getConfiguredAcpCommand();
				if (!configuredCommand) {
					sendJson(res, 501, {
						error: "ACP command is not configured. Set KANBANANA_ACP_COMMAND.",
					});
					return;
				}

				try {
					const body = validateTurnRequest(await readJsonBody<RuntimeAcpTurnRequest>(req));
					const response = await runAcpTurn({
						commandLine: configuredCommand,
						cwd: process.cwd(),
						request: body,
					});
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

			if (pathname === "/api/workspace/changes" && req.method === "GET") {
				try {
					validateWorkspaceChangesRequest(requestUrl.searchParams);
					const response = await getWorkspaceChanges(process.cwd());
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
		server.listen(port ?? 0, "127.0.0.1", () => {
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
