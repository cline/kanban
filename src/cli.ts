#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import closeWithGrace from "close-with-grace";
import { Command, Option } from "commander";
import packageJson from "../package.json" with { type: "json" };

import { registerHooksCommand } from "./commands/hooks.js";
import { registerTaskCommand } from "./commands/task.js";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "./config/runtime-config.js";
import type { RuntimeCommandRunResponse } from "./core/api-contract.js";
import { createGitProcessEnv } from "./core/git-process-env.js";
import {
	buildKanbanRuntimeUrl,
	DEFAULT_KANBAN_RUNTIME_PORT,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	parseRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
} from "./core/runtime-endpoint.js";
import { terminateProcessForTimeout } from "./server/process-termination.js";
import type { RuntimeStateHub } from "./server/runtime-state-hub.js";
import type { TerminalSessionManager } from "./terminal/session-manager.js";

interface CliOptions {
	noOpen: boolean;
	skipShutdownCleanup: boolean;
	host: string | null;
	port: { mode: "fixed"; value: number } | { mode: "auto" } | null;
}

const KANBAN_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

function parseCliPortValue(rawValue: string): { mode: "fixed"; value: number } | { mode: "auto" } {
	const normalized = rawValue.trim().toLowerCase();
	if (!normalized) {
		throw new Error("Missing value for --port.");
	}
	if (normalized === "auto") {
		return { mode: "auto" };
	}
	try {
		return { mode: "fixed", value: parseRuntimePort(normalized) };
	} catch {
		throw new Error(`Invalid port value: ${rawValue}. Expected an integer from 1-65535 or "auto".`);
	}
}

interface RootCommandOptions {
	host?: string;
	port?: { mode: "fixed"; value: number } | { mode: "auto" };
	open?: boolean;
	skipShutdownCleanup?: boolean;
}

/**
 * Decide whether this CLI invocation should auto-open a browser tab.
 *
 * This uses a positive allowlist for app-launch shapes like `kanban`,
 * `kanban --agent codex`, and `kanban --port 3484`. Any subcommand or
 * unexpected argument is treated as a command-style invocation instead.
 */
function shouldAutoOpenBrowserTabForInvocation(argv: string[]): boolean {
	const launchFlags = new Set(["--open", "--no-open", "--skip-shutdown-cleanup"]);
	const launchOptionsWithValues = new Set(["--host", "--port", "--agent"]);

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (!arg) {
			continue;
		}
		if (!arg.startsWith("-")) {
			return false;
		}
		if (launchFlags.has(arg)) {
			continue;
		}
		const optionName = arg.split("=", 1)[0] ?? arg;
		if (!launchOptionsWithValues.has(optionName)) {
			return false;
		}
		if (arg.includes("=")) {
			continue;
		}
		const optionValue = argv[index + 1];
		if (!optionValue) {
			return false;
		}
		index += 1;
	}

	return true;
}

async function isPortAvailable(port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const probe = createNetServer();
		probe.once("error", () => {
			resolve(false);
		});
		probe.listen(port, getKanbanRuntimeHost(), () => {
			probe.close(() => {
				resolve(true);
			});
		});
	});
}

async function findAvailableRuntimePort(startPort: number): Promise<number> {
	for (let candidate = startPort; candidate <= 65535; candidate += 1) {
		if (await isPortAvailable(candidate)) {
			return candidate;
		}
	}
	throw new Error("No available runtime port found.");
}

async function applyRuntimePortOption(portOption: CliOptions["port"]): Promise<number | null> {
	if (!portOption) {
		return null;
	}
	if (portOption.mode === "fixed") {
		setKanbanRuntimePort(portOption.value);
		return portOption.value;
	}
	const autoPort = await findAvailableRuntimePort(DEFAULT_KANBAN_RUNTIME_PORT);
	setKanbanRuntimePort(autoPort);
	return autoPort;
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

async function tryOpenExistingServer(options: { noOpen: boolean; shouldAutoOpenBrowser: boolean }): Promise<boolean> {
	let workspaceId: string | null = null;
	if (hasGitRepository(process.cwd())) {
		const { loadWorkspaceContext } = await import("./state/workspace-state.js");
		const context = await loadWorkspaceContext(process.cwd());
		workspaceId = context.workspaceId;
	}
	const running = await canReachKanbanServer(workspaceId);
	if (!running) {
		return false;
	}
	const projectUrl = workspaceId
		? buildKanbanRuntimeUrl(`/${encodeURIComponent(workspaceId)}`)
		: getKanbanRuntimeOrigin();
	console.log(`Kanban already running at ${getKanbanRuntimeOrigin()}`);
	if (!options.noOpen && options.shouldAutoOpenBrowser) {
		try {
			const { openInBrowser } = await import("./server/browser.js");
			openInBrowser(projectUrl, {
				warn: (message) => {
					console.warn(message);
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`Could not open browser automatically: ${message}`);
		}
	}
	console.log(`Project URL: ${projectUrl}`);
	return true;
}

async function runScopedCommand(command: string, cwd: string): Promise<RuntimeCommandRunResponse> {
	const startedAt = Date.now();
	const outputLimitBytes = 64 * 1024;

	return await new Promise<RuntimeCommandRunResponse>((resolve, reject) => {
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
			terminateProcessForTimeout(child);
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

async function startServer(): Promise<{
	url: string;
	close: () => Promise<void>;
	shutdown: (options?: { skipSessionCleanup?: boolean }) => Promise<void>;
}> {
	/*
		Server-only modules are loaded lazily because task-oriented subcommands like
		`kanban task create` and `kanban hooks ingest` do not need the runtime server.

		A regression in 25ba59f showed that eagerly importing the runtime stack here
		could leave the source CLI process alive after the command had already printed
		its JSON result. The issue first appeared after the native Cline SDK runtime
		was added to the server import graph. We have not yet isolated the deepest
		handle creator inside that graph, so we keep command-style subcommands on the
		lightweight path and only load the server stack when we actually start Kanban.
	*/
	const [
		{ resolveProjectInputPath },
		{ pickDirectoryPathFromSystemDialog },
		{ createRuntimeServer },
		{ createRuntimeStateHub },
		{ resolveInteractiveShellCommand },
		{ shutdownRuntimeServer },
		{ collectProjectWorktreeTaskIdsForRemoval, createWorkspaceRegistry },
	] = await Promise.all([
		import("./projects/project-path.js"),
		import("./server/directory-picker.js"),
		import("./server/runtime-server.js"),
		import("./server/runtime-state-hub.js"),
		import("./server/shell.js"),
		import("./server/shutdown-coordinator.js"),
		import("./server/workspace-registry.js"),
	]);
	let runtimeStateHub: RuntimeStateHub | undefined;
	const workspaceRegistry = await createWorkspaceRegistry({
		cwd: process.cwd(),
		loadGlobalRuntimeConfig,
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
		runCommand: runScopedCommand,
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

	const shutdown = async (options?: { skipSessionCleanup?: boolean }) => {
		await shutdownRuntimeServer({
			workspaceRegistry,
			warn: (message) => {
				console.warn(`[kanban] ${message}`);
			},
			closeRuntimeServer: close,
			skipSessionCleanup: options?.skipSessionCleanup ?? false,
		});
	};

	return {
		url: runtimeServer.url,
		close,
		shutdown,
	};
}

async function startServerWithAutoPortRetry(options: CliOptions): Promise<Awaited<ReturnType<typeof startServer>>> {
	if (options.port?.mode !== "auto") {
		return await startServer();
	}

	while (true) {
		try {
			return await startServer();
		} catch (error) {
			if (!isAddressInUseError(error)) {
				throw error;
			}
			const currentPort = getKanbanRuntimePort();
			const retryPort = await findAvailableRuntimePort(currentPort + 1);
			setKanbanRuntimePort(retryPort);
			console.warn(`Runtime port ${currentPort} became busy during startup, retrying on ${retryPort}.`);
		}
	}
}

async function runMainCommand(options: CliOptions, shouldAutoOpenBrowser: boolean): Promise<void> {
	if (options.host) {
		setKanbanRuntimeHost(options.host);
		console.log(`Binding to host ${options.host}.`);
	}

	const [{ openInBrowser }, { autoUpdateOnStartup, runPendingAutoUpdateOnShutdown }] = await Promise.all([
		import("./server/browser.js"),
		import("./update/auto-update.js"),
	]);

	const selectedPort = await applyRuntimePortOption(options.port);
	if (selectedPort !== null) {
		console.log(`Using runtime port ${selectedPort}.`);
	}

	autoUpdateOnStartup({
		currentVersion: KANBAN_VERSION,
	});

	let runtime: Awaited<ReturnType<typeof startServer>>;
	try {
		runtime = await startServerWithAutoPortRetry(options);
	} catch (error) {
		if (
			options.port?.mode !== "auto" &&
			isAddressInUseError(error) &&
			(await tryOpenExistingServer({ noOpen: options.noOpen, shouldAutoOpenBrowser }))
		) {
			return;
		}
		throw error;
	}
	console.log(`Kanban running at ${runtime.url}`);
	if (!options.noOpen && shouldAutoOpenBrowser) {
		try {
			openInBrowser(runtime.url, {
				warn: (message) => {
					console.warn(message);
				},
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`Could not open browser automatically: ${message}`);
		}
	}
	console.log("Press Ctrl+C to stop.");

	let isShuttingDown = false;
	const shutdown = async (signal: NodeJS.Signals | null) => {
		if (isShuttingDown) {
			process.exit(130);
			return;
		}
		isShuttingDown = true;
		runPendingAutoUpdateOnShutdown();
		try {
			if (options.skipShutdownCleanup) {
				console.warn("Skipping shutdown task cleanup for this instance.");
			}
			await runtime.shutdown({
				skipSessionCleanup: options.skipShutdownCleanup,
			});
			process.exit(signal ? 130 : 0);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Shutdown failed: ${message}`);
			process.exit(1);
		}
	};

	closeWithGrace(
		{
			delay: 10000,
			skip: ["uncaughtException", "unhandledRejection", "beforeExit"],
			onTimeout: (delayMs) => {
				console.error(`Forced exit after shutdown timeout (${delayMs}ms).`);
			},
			onSecondSignal: (signal) => {
				console.error(`Forced exit on second signal: ${signal}`);
			},
		},
		async ({ signal }) => {
			await shutdown(signal ?? null);
		},
	);
}

function createProgram(invocationArgs: string[]): Command {
	const shouldAutoOpenBrowser = shouldAutoOpenBrowserTabForInvocation(invocationArgs);
	const program = new Command();
	program
		.name("kanban")
		.description("Local orchestration board for coding agents.")
		.version(KANBAN_VERSION, "-v, --version", "Output the version number")
		.option("--host <ip>", "Host IP to bind the server to (default: 127.0.0.1).")
		.option("--port <number|auto>", "Runtime port (1-65535) or auto.", parseCliPortValue)
		.option("--no-open", "Do not open browser automatically.")
		.option("--skip-shutdown-cleanup", "Do not move sessions to trash or delete task worktrees on shutdown.")
		.showHelpAfterError()
		.addHelpText("after", `\nRuntime URL: ${getKanbanRuntimeOrigin()}`);

	program.addOption(
		new Option("--agent <id>", "Deprecated compatibility flag. Ignored.")
			.hideHelp(),
	);

	registerTaskCommand(program);
	registerHooksCommand(program);

	program
		.command("mcp")
		.description("Deprecated compatibility command.")
		.action(() => {
			console.warn("Deprecated. Please uninstall Kanban MCP.");
		});

	program.action(async (options: RootCommandOptions) => {
		await runMainCommand({
			host: options.host ?? null,
			port: options.port ?? null,
			noOpen: options.open === false,
			skipShutdownCleanup: options.skipShutdownCleanup === true,
		}, shouldAutoOpenBrowser);
	});

	return program;
}

async function run(): Promise<void> {
	const argv = process.argv.slice(2);
	const program = createProgram(argv);
	await program.parseAsync(argv, { from: "user" });
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start Kanban: ${message}`);
	process.exit(1);
});
