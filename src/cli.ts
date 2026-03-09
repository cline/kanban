#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import packageJson from "../package.json" with { type: "json" };

import { isHooksSubcommand, runHooksSubcommand } from "./commands/hooks.js";
import { isMcpSubcommand, runMcpSubcommand } from "./commands/mcp.js";
import type {
	RuntimeAgentId,
	RuntimeShortcutRunResponse,
} from "./core/api-contract.js";
import { loadRuntimeConfig, updateRuntimeConfig } from "./config/runtime-config.js";
import { createGitProcessEnv } from "./core/git-process-env.js";
import { resolveProjectInputPath } from "./projects/project-path.js";
import {
	buildKanbanRuntimeUrl,
	KANBAN_RUNTIME_ORIGIN,
} from "./core/runtime-endpoint.js";
import { openInBrowser } from "./server/browser.js";
import { createRuntimeStateHub } from "./server/runtime-state-hub.js";
import { createRuntimeServer } from "./server/runtime-server.js";
import { shutdownRuntimeServer } from "./server/shutdown-coordinator.js";
import { resolveInteractiveShellCommand } from "./server/shell.js";
import {
	loadWorkspaceContext,
} from "./state/workspace-state.js";
import {
	collectProjectWorktreeTaskIdsForRemoval,
	createWorkspaceRegistry,
} from "./server/workspace-registry.js";
import type { TerminalSessionManager } from "./terminal/session-manager.js";
import { autoUpdateOnStartup } from "./update/auto-update.js";

interface CliOptions {
	help: boolean;
	version: boolean;
	noOpen: boolean;
	agent: RuntimeAgentId | null;
}

const CLI_AGENT_IDS: readonly RuntimeAgentId[] = ["claude", "codex", "gemini", "opencode", "cline"];
const KANBAN_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

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

function printHelp(): void {
	console.log("kanban");
	console.log("Local orchestration board for coding agents.");
	console.log("");
	console.log("Usage:");
	console.log("  kanban [--agent <id>] [--no-open] [--help] [--version]");
	console.log("  kanban mcp");
	console.log("");
	console.log(`Runtime URL: ${KANBAN_RUNTIME_ORIGIN}`);
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


function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EADDRINUSE"
	);
}

async function canReachKanbanServer(workspaceId: string | null): Promise<boolean> {
	try {
		const headers: Record<string, string> = {};
		if (workspaceId) {
			headers["x-kanban-workspace-id"] = workspaceId;
		}
		const response = await fetch(buildKanbanRuntimeUrl("/api/trpc/projects.list"), {
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
	const running = await canReachKanbanServer(workspaceId);
	if (!running) {
		return false;
	}
	const projectUrl = workspaceId
		? buildKanbanRuntimeUrl(`/${encodeURIComponent(workspaceId)}`)
		: KANBAN_RUNTIME_ORIGIN;
	console.log(`Kanban already running at ${KANBAN_RUNTIME_ORIGIN}`);
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

async function startServer(): Promise<{ url: string; close: () => Promise<void>; shutdown: () => Promise<void> }> {
	let runtimeStateHub: ReturnType<typeof createRuntimeStateHub> | undefined;
	const workspaceRegistry = await createWorkspaceRegistry({
		cwd: process.cwd(),
		loadRuntimeConfig,
		hasGitRepository,
		pathIsDirectory,
		onTerminalManagerReady: (workspaceId, manager) => {
			runtimeStateHub?.trackTerminalManager(workspaceId, manager);
		},
	});
	runtimeStateHub = createRuntimeStateHub({
		workspaceRegistry,
	});
	const runtimeHub = runtimeStateHub;
	for (const { workspaceId, terminalManager } of workspaceRegistry.listManagedWorkspaces()) {
		runtimeHub.trackTerminalManager(workspaceId, terminalManager);
	}

	const disposeTrackedWorkspace = (
		workspaceId: string,
		options?: {
			stopTerminalSessions?: boolean;
		},
	): { terminalManager: TerminalSessionManager | null; workspacePath: string | null } => {
		const disposed = workspaceRegistry.disposeWorkspace(workspaceId, {
			stopTerminalSessions: options?.stopTerminalSessions,
		});
		runtimeHub.disposeWorkspace(workspaceId);
		return disposed;
	};

	const runtimeServer = await createRuntimeServer({
		workspaceRegistry,
		runtimeStateHub: runtimeHub,
		warn: (message) => {
			console.warn(`[kanban] ${message}`);
		},
		ensureTerminalManagerForWorkspace: workspaceRegistry.ensureTerminalManagerForWorkspace,
		resolveInteractiveShellCommand,
		runShortcutCommand,
		resolveProjectInputPath,
		assertPathIsDirectory,
		hasGitRepository,
		disposeWorkspace: disposeTrackedWorkspace,
		collectProjectWorktreeTaskIdsForRemoval,
		pickDirectoryPathFromSystemDialog,
	});

	const close = async () => {
		await runtimeServer.close();
	};

	const shutdown = async () => {
		await shutdownRuntimeServer({
			workspaceRegistry,
			warn: (message) => {
				console.warn(`[kanban] ${message}`);
			},
			closeRuntimeServer: close,
		});
	};

	return {
		url: runtimeServer.url,
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
		console.log(KANBAN_VERSION);
		return;
	}

	autoUpdateOnStartup({
		currentVersion: KANBAN_VERSION,
	});

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
	console.log(`Kanban running at ${runtime.url}`);
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
	console.error(`Failed to start Kanban: ${message}`);
	process.exit(1);
});
