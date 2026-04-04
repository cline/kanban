// CLI startup uses top-level imports per AGENTS.md. If startup optimization is
// needed in the future, prefer entrypoint/module-boundary refactors over
// dynamic imports.

import { spawnSync } from "node:child_process";
import { Command, Option } from "commander";
import ora, { type Ora } from "ora";
import packageJson from "../package.json" with { type: "json" };
import { disposeCliTelemetryService } from "./cline-sdk/cline-telemetry-service.js";
import { registerHooksCommand } from "./commands/hooks";
import { registerTaskCommand } from "./commands/task";
import { registerTokenCommand } from "./commands/token";
import { createGitProcessEnv } from "./core/git-process-env";
import {
	installGracefulShutdownHandlers,
	shouldSuppressImmediateDuplicateShutdownSignals,
} from "./core/graceful-shutdown";
import { buildKanbanRuntimeUrl, getKanbanRuntimeOrigin, parseRuntimePort } from "./core/runtime-endpoint";
import { type RuntimeHandle, startRuntime } from "./runtime-start.js";
import { openInBrowser } from "./server/browser.js";
import { loadWorkspaceContext } from "./state/workspace-state.js";
import { captureNodeException, flushNodeTelemetry } from "./telemetry/sentry-node.js";
import { autoUpdateOnStartup, runOnDemandUpdate, runPendingAutoUpdateOnShutdown } from "./update/update.js";

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
	update?: boolean;
}

type ShutdownIndicatorResult = "done" | "interrupted" | "failed";

interface ShutdownIndicator {
	start: () => void;
	stop: (result?: ShutdownIndicatorResult) => void;
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

function createShutdownIndicator(stream: NodeJS.WriteStream = process.stderr): ShutdownIndicator {
	let spinner: Ora | null = null;
	let running = false;

	return {
		start() {
			if (running) {
				return;
			}
			running = true;
			if (!stream.isTTY) {
				stream.write("Cleaning up...\n");
				return;
			}
			spinner = ora({
				text: "Cleaning up...",
				stream,
			}).start();
		},
		stop(result = "done") {
			if (!running) {
				return;
			}
			running = false;
			if (spinner) {
				if (result === "done") {
					spinner.succeed("Cleaning up... done");
				} else if (result === "failed") {
					spinner.fail("Cleaning up... failed");
				} else {
					spinner.warn("Cleaning up... interrupted");
				}
				spinner = null;
				return;
			}

			const suffix = result === "done" ? "done" : result === "interrupted" ? "interrupted" : "failed";
			stream.write(`Cleanup ${suffix}.\n`);
		},
	};
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

async function runMainCommand(options: CliOptions, shouldAutoOpenBrowser: boolean): Promise<void> {
	if (options.host) {
		console.log(`Binding to host ${options.host}.`);
	}

	const portOption = options.port;
	if (portOption?.mode === "fixed") {
		console.log(`Using runtime port ${portOption.value}.`);
	}

	autoUpdateOnStartup({
		currentVersion: KANBAN_VERSION,
	});

	let runtime: RuntimeHandle;
	try {
		runtime = await startRuntime({
			host: options.host ?? undefined,
			port: portOption?.mode === "auto" ? "auto" : portOption?.mode === "fixed" ? portOption.value : undefined,
			callbacks: { warn: console.warn },
		});
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
	console.log(`Cline Kanban running at ${runtime.url}`);
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
	const shutdownIndicator = createShutdownIndicator();
	const shutdown = async () => {
		if (isShuttingDown) {
			return;
		}
		isShuttingDown = true;
		runPendingAutoUpdateOnShutdown();
		if (options.skipShutdownCleanup) {
			console.warn("Skipping shutdown task cleanup for this instance.");
		}
		await runtime.shutdown({
			skipSessionCleanup: options.skipShutdownCleanup,
		});
		await disposeCliTelemetryService().catch(() => {});
	};

	installGracefulShutdownHandlers({
		process,
		delayMs: 10000,
		exit: (code) => {
			process.exit(code);
		},
		onShutdown: async () => {
			shutdownIndicator.start();
			try {
				await shutdown();
				shutdownIndicator.stop("done");
			} catch (error) {
				shutdownIndicator.stop("failed");
				throw error;
			}
		},
		onShutdownError: (error) => {
			shutdownIndicator.stop("failed");
			captureNodeException(error, { area: "shutdown" });
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Shutdown failed: ${message}`);
		},
		onTimeout: (delayMs) => {
			shutdownIndicator.stop("interrupted");
			console.error(`Forced exit after shutdown timeout (${delayMs}ms).`);
		},
		onSecondSignal: (signal) => {
			shutdownIndicator.stop("interrupted");
			console.error(`Forced exit on second signal: ${signal}`);
		},
		suppressImmediateDuplicateSignals: shouldSuppressImmediateDuplicateShutdownSignals(),
	});
}

async function runUpdateCommand(): Promise<void> {
	const result = await runOnDemandUpdate({
		currentVersion: KANBAN_VERSION,
	});

	if (result.status === "updated" || result.status === "already_up_to_date" || result.status === "cache_refreshed") {
		console.log(result.message);
		return;
	}

	throw new Error(result.message);
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
		.option("--update", "Update Kanban to the latest published version and exit.")
		.showHelpAfterError()
		.addHelpText("after", `\nRuntime URL: ${getKanbanRuntimeOrigin()}`);

	program.addOption(new Option("--agent <id>", "Deprecated compatibility flag. Ignored.").hideHelp());

	registerTaskCommand(program);
	registerHooksCommand(program);
	registerTokenCommand(program);

	program
		.command("mcp")
		.description("Deprecated compatibility command.")
		.action(() => {
			console.warn("Deprecated. Please uninstall Kanban MCP.");
		});

	program
		.command("update")
		.description("Update Kanban to the latest published version.")
		.action(async () => {
			await runUpdateCommand();
		});

	program.action(async (options: RootCommandOptions) => {
		if (options.update === true) {
			await runUpdateCommand();
			return;
		}
		await runMainCommand(
			{
				host: options.host ?? null,
				port: options.port ?? null,
				noOpen: options.open === false,
				skipShutdownCleanup: options.skipShutdownCleanup === true,
			},
			shouldAutoOpenBrowser,
		);
	});

	return program;
}

async function run(): Promise<void> {
	const argv = process.argv.slice(2);
	const program = createProgram(argv);
	await program.parseAsync(argv, { from: "user" });
	if (!shouldAutoOpenBrowserTabForInvocation(argv)) {
		await Promise.allSettled([disposeCliTelemetryService(), flushNodeTelemetry()]);
		process.exit(process.exitCode ?? 0);
	}
}

void run().catch(async (error) => {
	captureNodeException(error, { area: "startup" });
	await Promise.allSettled([disposeCliTelemetryService(), flushNodeTelemetry()]);
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to start Kanban: ${message}`);
	process.exit(1);
});
