import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { Command, Option } from "commander";
import ora, { type Ora } from "ora";
import packageJson from "../package.json" with { type: "json" };
import { ensureDaemonLogDirectory, getDaemonLogPath } from "./cli/daemon-logs";
import {
	getOptionWasProvided,
	type LaunchCommandOptions,
	type NormalizedLaunchOptions,
	normalizeLaunchOptions,
	registerLaunchOptions,
	toLaunchArgs,
} from "./cli/launch-options";
import {
	getProcessStartedAt,
	isKanbanCommandLineProcess,
	isKanbanProcess,
	isProcessAlive,
	stopManagedProcess,
} from "./cli/process-control";
import {
	createManagedProcessLaunch,
	listManagedProcesses,
	type ManagedProcessLaunch,
	type ManagedProcessMode,
	type ManagedProcessRecord,
	registerManagedProcess,
	replaceManagedProcesses,
	unregisterManagedProcess,
} from "./cli/process-registry";
import { disposeCliTelemetryService } from "./cline-sdk/cline-telemetry-service.js";
import { registerHooksCommand } from "./commands/hooks";
import { registerTaskCommand } from "./commands/task";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "./config/runtime-config";
import type { RuntimeCommandRunResponse } from "./core/api-contract";
import { createGitProcessEnv } from "./core/git-process-env";
import {
	installGracefulShutdownHandlers,
	shouldSuppressImmediateDuplicateShutdownSignals,
} from "./core/graceful-shutdown";
import { buildKanbanCommandParts } from "./core/kanban-command";
import {
	buildKanbanRuntimeUrl,
	clearKanbanRuntimeTls,
	DEFAULT_KANBAN_RUNTIME_PORT,
	getKanbanRuntimeHost,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	getRuntimeFetch,
	isKanbanRemoteHost,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
	setKanbanRuntimeTls,
} from "./core/runtime-endpoint";
import { disablePasscode, generateInternalToken, generatePasscode } from "./security/passcode-manager";
import { terminateProcessForTimeout } from "./server/process-termination";
import type { RuntimeStateHub } from "./server/runtime-state-hub";
import { captureNodeException, flushNodeTelemetry } from "./telemetry/sentry-node.js";
import type { TerminalSessionManager } from "./terminal/session-manager";
import { runOnDemandUpdate } from "./update/update";

const KANBAN_VERSION = typeof packageJson.version === "string" ? packageJson.version : "0.1.0";

interface RootCommandOptions extends LaunchCommandOptions {
	update?: boolean;
	__daemonChild?: boolean;
}

interface RuntimeRunOptions extends NormalizedLaunchOptions {
	mode: ManagedProcessMode;
	daemonChild?: boolean;
	launchArgs?: string[];
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
	const launchFlags = new Set(["--open", "--no-open", "--skip-shutdown-cleanup", "--https", "--no-passcode"]);
	const launchOptionsWithValues = new Set(["--host", "--port", "--agent", "--cert", "--key"]);

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

async function applyRuntimePortOption(portOption: NormalizedLaunchOptions["port"]): Promise<number | null> {
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

type TlsResult = { enabled: false } | { enabled: true };

async function resolveRuntimeTls(options: NormalizedLaunchOptions): Promise<TlsResult> {
	const wantsHttps = options.https || options.cert !== null || options.key !== null;
	if (!wantsHttps) {
		clearKanbanRuntimeTls();
		return { enabled: false };
	}
	if (!options.cert || !options.key) {
		throw new Error("HTTPS requires both --cert and --key. Use plain HTTP if you do not have a TLS certificate.");
	}
	const cert = readFileSync(resolve(options.cert), "utf8");
	const key = readFileSync(resolve(options.key), "utf8");
	// Trust the exact configured cert for Kanban's own subcommands without
	// disabling certificate validation for unrelated HTTPS endpoints.
	setKanbanRuntimeTls({ cert, key, ca: cert });
	return { enabled: true };
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

async function probeKanbanServer(): Promise<boolean> {
	const configuredHost = getKanbanRuntimeHost();
	const probeHost = configuredHost === "0.0.0.0" || configuredHost === "::" ? "127.0.0.1" : configuredHost;
	if (probeHost !== configuredHost) {
		setKanbanRuntimeHost(probeHost);
	}
	try {
		const runtimeFetch = await getRuntimeFetch();
		const response = await runtimeFetch(buildKanbanRuntimeUrl("/api/health"), {
			method: "GET",
			signal: AbortSignal.timeout(1_500),
		});
		if (!response.ok) {
			return false;
		}
		const payload = (await response.json().catch(() => null)) as { service?: unknown } | null;
		if (payload?.service !== "kanban") {
			return false;
		}
		return true;
	} catch {
		return false;
	} finally {
		if (probeHost !== configuredHost) {
			setKanbanRuntimeHost(configuredHost);
		}
	}
}

async function canReachKanbanServer(workspaceId: string | null): Promise<boolean> {
	try {
		if (await probeKanbanServer()) {
			return true;
		}
		const headers: Record<string, string> = {};
		if (workspaceId) {
			headers["x-kanban-workspace-id"] = workspaceId;
		}
		const runtimeFetch = await getRuntimeFetch();
		const response = await runtimeFetch(buildKanbanRuntimeUrl("/api/trpc/projects.list"), {
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
		{ clearPendingUpdateNotification, getPendingUpdateNotification },
	] = await Promise.all([
		import("./projects/project-path.js"),
		import("./server/directory-picker.js"),
		import("./server/runtime-server.js"),
		import("./server/runtime-state-hub.js"),
		import("./server/shell.js"),
		import("./server/shutdown-coordinator.js"),
		import("./server/workspace-registry.js"),
		import("./update/update.js"),
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
		getUpdateStatus: () => {
			const notification = getPendingUpdateNotification();
			if (!notification) {
				return {
					currentVersion: KANBAN_VERSION,
					latestVersion: null,
					updateAvailable: false,
					updateTiming: null,
					installCommand: null,
				};
			}
			return {
				currentVersion: notification.currentVersion,
				latestVersion: notification.latestVersion,
				updateAvailable: true,
				updateTiming: notification.updateTiming,
				installCommand: notification.installCommand,
			};
		},
		runUpdateNow: async () => {
			const result = await runOnDemandUpdate({
				currentVersion: KANBAN_VERSION,
			});
			if (
				result.status === "updated" ||
				result.status === "already_up_to_date" ||
				result.status === "cache_refreshed"
			) {
				// The pending notification is a one-shot signal recorded at startup.
				// Clearing it here prevents the modal from reappearing on page reload
				// after the user has already applied the update.
				clearPendingUpdateNotification();
			}
			return {
				status: result.status,
				currentVersion: result.currentVersion,
				latestVersion: result.latestVersion,
				message: result.message,
			};
		},
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

async function startServerWithAutoPortRetry(
	options: Pick<NormalizedLaunchOptions, "port">,
): Promise<Awaited<ReturnType<typeof startServer>>> {
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

async function runMainCommand(options: RuntimeRunOptions, shouldAutoOpenBrowser: boolean): Promise<void> {
	if (options.host) {
		setKanbanRuntimeHost(options.host);
		console.log(`Binding to host ${options.host}.`);
	}

	const [{ openInBrowser }, { autoUpdateOnStartup, runPendingAutoUpdateOnShutdown }] = await Promise.all([
		import("./server/browser.js"),
		import("./update/update.js"),
	]);

	const selectedPort = await applyRuntimePortOption(options.port);
	if (selectedPort !== null) {
		console.log(`Using runtime port ${selectedPort}.`);
	}

	const tlsResult = await resolveRuntimeTls(options);
	if (tlsResult.enabled) {
		console.log(`HTTPS enabled on ${getKanbanRuntimeOrigin()}`);
	}

	// Handle passcode generation for remote mode — deferred until after TLS
	// validation so that an invalid --cert/--key fails before a passcode is
	// printed (a passcode for a server that never starts is confusing).
	if (isKanbanRemoteHost()) {
		if (options.noPasscode) {
			disablePasscode();
			console.log("Passcode authentication disabled (--no-passcode). Ensure you have your own auth layer.");
		} else {
			const passcode = generatePasscode();
			generateInternalToken();
			// NOTE: passcode is printed ONLY here and never stored in logs or env.
			console.log(`\n🔐 Remote access passcode: ${passcode}\n\nShare this with users who need access.\n`);
		}
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
			(await tryOpenExistingServer({ noOpen: !options.open, shouldAutoOpenBrowser }))
		) {
			return;
		}
		throw error;
	}
	console.log(`Cline Kanban running at ${runtime.url}`);
	const managedRecord: ManagedProcessRecord = {
		pid: process.pid,
		host: getKanbanRuntimeHost(),
		port: getKanbanRuntimePort(),
		endpoint: new URL(runtime.url).host,
		startedAt: (getProcessStartedAt(process.pid) ?? new Date()).toISOString(),
		mode: options.mode,
		cwd: process.cwd(),
		logFile: options.mode === "background" ? (process.env.KANBAN_DAEMON_LOG_FILE ?? null) : null,
		launchArgs: options.launchArgs ?? [],
		launch: createManagedProcessLaunch(options, getKanbanRuntimePort(), getKanbanRuntimeHost()),
	};
	try {
		await registerManagedProcess(managedRecord);
	} catch (error) {
		await runtime.shutdown({ skipSessionCleanup: options.skipShutdownCleanup }).catch(() => {});
		throw new Error(`Could not register Kanban process: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!options.daemonChild && options.open && shouldAutoOpenBrowser) {
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
	if (options.mode === "foreground") {
		console.log("Press Ctrl+C to stop.");
	}

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
		await unregisterManagedProcess(process.pid).catch(() => {});
		await disposeCliTelemetryService().catch(() => {});
	};

	installGracefulShutdownHandlers({
		process,
		delayMs: 10000,
		exit: (code) => {
			process.exit(code);
		},
		reraiseSignal: (signal) => {
			process.kill(process.pid, signal);
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

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function managedLaunchToOptions(launch: ManagedProcessLaunch): NormalizedLaunchOptions {
	return {
		host: launch.host,
		port: { mode: "fixed", value: launch.port },
		open: launch.open,
		skipShutdownCleanup: launch.skipShutdownCleanup,
		https: launch.https,
		cert: launch.cert,
		key: launch.key,
		noPasscode: launch.noPasscode,
		agent: launch.agent,
	};
}

function mergeRestartOptions(
	base: NormalizedLaunchOptions,
	overrides: LaunchCommandOptions,
	command: Command,
): NormalizedLaunchOptions {
	const parsed = normalizeLaunchOptions(overrides);
	const merged = { ...base };
	const provided = (name: string) => getOptionWasProvided(command, name);
	if (provided("host")) merged.host = parsed.host;
	if (provided("port")) merged.port = parsed.port;
	if (provided("open")) merged.open = parsed.open;
	if (provided("skipShutdownCleanup")) merged.skipShutdownCleanup = parsed.skipShutdownCleanup;
	if (provided("https")) merged.https = parsed.https;
	if (provided("cert")) merged.cert = parsed.cert;
	if (provided("key")) merged.key = parsed.key;
	if (provided("noPasscode")) merged.noPasscode = parsed.noPasscode;
	if (provided("agent")) merged.agent = parsed.agent;
	return merged;
}

async function getActiveManagedProcesses(): Promise<ManagedProcessRecord[]> {
	const records = await listManagedProcesses();
	const active: ManagedProcessRecord[] = [];
	for (const record of records) {
		if (isKanbanProcess(record)) {
			active.push(record);
		}
	}
	if (active.length !== records.length) {
		await replaceManagedProcesses(active);
	}
	return active;
}

async function findManagedProcessAtEndpoint(host: string, port: number): Promise<ManagedProcessRecord | null> {
	const records = await getActiveManagedProcesses();
	for (const record of records) {
		if (record.host !== host || record.port !== port) {
			continue;
		}
		setKanbanRuntimeHost(host);
		setKanbanRuntimePort(port);
		if (await probeKanbanServer()) {
			return record;
		}
	}
	return null;
}

async function waitForDaemonRecord(pid: number, timeoutMs = 15_000): Promise<ManagedProcessRecord> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const records = await listManagedProcesses();
		const record = records.find((candidate) => candidate.pid === pid);
		if (record && isKanbanProcess(record)) {
			setKanbanRuntimeHost(record.host);
			setKanbanRuntimePort(record.port);
			if (await probeKanbanServer()) {
				return record;
			}
		}
		if (!isProcessAlive(pid)) {
			break;
		}
		await delay(100);
	}
	throw new Error(`Kanban daemon failed to become ready. Check the log file for PID ${pid}.`);
}

async function openRuntimeInBrowser(openBrowser: boolean, url: string): Promise<void> {
	if (!openBrowser) {
		return;
	}
	const { openInBrowser } = await import("./server/browser.js");
	openInBrowser(url, {
		warn: (message) => {
			console.warn(message);
		},
	});
}

async function startDaemonProcess(
	options: NormalizedLaunchOptions,
	cwd = process.cwd(),
	launchArgs = toLaunchArgs(options),
): Promise<ManagedProcessRecord> {
	if (options.host) {
		setKanbanRuntimeHost(options.host);
	}
	if (options.port?.mode === "fixed") {
		setKanbanRuntimePort(options.port.value);
	}
	await resolveRuntimeTls(options);

	if (options.port?.mode !== "auto") {
		const host = getKanbanRuntimeHost();
		const port = getKanbanRuntimePort();
		const existing = await findManagedProcessAtEndpoint(host, port);
		if (existing) {
			console.log(`Kanban already running (pid ${existing.pid}) at ${existing.endpoint}`);
			await openRuntimeInBrowser(options.open, getKanbanRuntimeOrigin());
			return existing;
		}
		const unregisteredProbe = await probeKanbanServer();
		if (unregisteredProbe) {
			throw new Error(
				`A Kanban server is already running at ${getKanbanRuntimeOrigin()} but is not registered for process management.`,
			);
		}
	}

	await ensureDaemonLogDirectory();
	const logFile = getDaemonLogPath();
	const logFd = openSync(logFile, "a");
	const childArgs = ["--__daemon-child", ...launchArgs];
	const commandParts = buildKanbanCommandParts(childArgs);
	const child = spawn(commandParts[0] ?? process.execPath, commandParts.slice(1), {
		cwd,
		env: {
			...process.env,
			KANBAN_DAEMON_MODE: "1",
			KANBAN_DAEMON_LOG_FILE: logFile,
		},
		stdio: ["ignore", logFd, logFd],
		detached: true,
		windowsHide: true,
	});
	child.on("error", () => {
		// Readiness polling reports the startup failure and points to the log.
	});
	closeSync(logFd);
	const pid = child.pid;
	child.unref();
	if (!pid) {
		throw new Error(`Could not start Kanban daemon. Check ${logFile}.`);
	}
	try {
		const record = await waitForDaemonRecord(pid);
		console.log(`Kanban started in background (pid ${record.pid}) at ${record.endpoint}`);
		console.log(`Log file: ${logFile}`);
		await openRuntimeInBrowser(options.open, getKanbanRuntimeOrigin());
		return record;
	} catch (error) {
		if (isProcessAlive(pid)) {
			await stopManagedProcess(pid, 1_000);
		}
		throw new Error(`${error instanceof Error ? error.message : String(error)} Log file: ${logFile}`);
	}
}

async function stopManagedRecord(record: ManagedProcessRecord): Promise<void> {
	if (!isKanbanProcess(record)) {
		await unregisterManagedProcess(record.pid);
		throw new Error(`PID ${record.pid} is not a Kanban process.`);
	}
	const result = await stopManagedProcess(record.pid);
	await unregisterManagedProcess(record.pid);
	if (!result.stopped) {
		throw new Error(`Could not stop Kanban process ${record.pid}.`);
	}
	const suffix = result.forced ? " (force-killed after graceful shutdown timed out)" : "";
	console.log(`Stopped Kanban process ${record.pid}${suffix}.`);
}

async function stopAllManagedProcesses(records: readonly ManagedProcessRecord[]): Promise<void> {
	const failures: string[] = [];
	for (const record of records) {
		try {
			await stopManagedRecord(record);
		} catch (error) {
			failures.push(error instanceof Error ? error.message : String(error));
		}
	}
	if (failures.length > 0) {
		throw new Error(failures.join("\n"));
	}
}

async function runStopCommand(pidValue?: string): Promise<void> {
	const records = await getActiveManagedProcesses();
	if (pidValue !== undefined) {
		const pid = Number.parseInt(pidValue, 10);
		if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== pidValue) {
			throw new Error(`Invalid PID: ${pidValue}.`);
		}
		const record = records.find((candidate) => candidate.pid === pid);
		if (!record) {
			if (!isKanbanCommandLineProcess(pid)) {
				throw new Error(`PID ${pid} is not a Kanban process.`);
			}
			const result = await stopManagedProcess(pid);
			if (!result.stopped) {
				throw new Error(`Could not stop Kanban process ${pid}.`);
			}
			console.log(
				`Stopped Kanban process ${pid}${result.forced ? " (force-killed after graceful shutdown timed out)" : ""}.`,
			);
			return;
		}
		await stopManagedRecord(record);
		return;
	}
	if (records.length === 0) {
		console.log("No running Kanban processes found.");
		return;
	}
	await stopAllManagedProcesses(records);
}

function formatStatusTable(records: readonly ManagedProcessRecord[]): string {
	const lines = ["PID\tENDPOINT\tSTARTED\tMODE\tSTATUS"];
	for (const record of records) {
		lines.push(`${record.pid}\t${record.endpoint}\t${record.startedAt}\t${record.mode}\trunning`);
	}
	return lines.join("\n");
}

async function runStatusCommand(asJson: boolean): Promise<void> {
	const records = await getActiveManagedProcesses();
	if (asJson) {
		console.log(JSON.stringify(records, null, 2));
		return;
	}
	console.log(records.length > 0 ? formatStatusTable(records) : "No running Kanban processes found.");
}

async function runRestartCommand(
	pidValue: string | undefined,
	overrides: LaunchCommandOptions,
	command: Command,
	overrideLaunchArgs: string[],
): Promise<void> {
	const records = await getActiveManagedProcesses();
	if (pidValue === undefined) {
		await stopAllManagedProcesses(records);
		await startDaemonProcess(normalizeLaunchOptions(overrides), process.cwd(), overrideLaunchArgs);
		return;
	}
	const pid = Number.parseInt(pidValue, 10);
	if (!Number.isInteger(pid) || pid <= 0 || String(pid) !== pidValue) {
		throw new Error(`Invalid PID: ${pidValue}.`);
	}
	const record = records.find((candidate) => candidate.pid === pid);
	if (!record) {
		throw new Error(`PID ${pid} is not a registered Kanban process.`);
	}
	const launchOptions = mergeRestartOptions(managedLaunchToOptions(record.launch), overrides, command);
	const restartLaunchArgs = [...record.launchArgs, ...overrideLaunchArgs];
	await stopManagedRecord(record);
	if (record.mode === "foreground") {
		await runMainCommand({ ...launchOptions, mode: "foreground", launchArgs: restartLaunchArgs }, true);
		return;
	}
	await startDaemonProcess(launchOptions, record.cwd, restartLaunchArgs);
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

const LAUNCH_OPTIONS_WITH_VALUES = new Set(["--host", "--port", "--agent", "--cert", "--key"]);

function removeInternalLaunchArguments(args: readonly string[]): string[] {
	return args.filter((argument) => argument !== "--__daemon-child");
}

function getLaunchArgumentsAfterCommand(
	invocationArgs: readonly string[],
	commandName: string,
	positionalToRemove?: string,
): string[] {
	const commandIndex = invocationArgs.indexOf(commandName);
	if (commandIndex < 0) {
		return [];
	}
	const args = invocationArgs.slice(commandIndex + 1);
	const result: string[] = [];
	let skipNextValue = false;
	let removedPositional = false;
	for (const argument of args) {
		if (skipNextValue) {
			result.push(argument);
			skipNextValue = false;
			continue;
		}
		const optionName = argument.split("=", 1)[0] ?? argument;
		if (LAUNCH_OPTIONS_WITH_VALUES.has(optionName) && !argument.includes("=")) {
			result.push(argument);
			skipNextValue = true;
			continue;
		}
		if (!removedPositional && positionalToRemove !== undefined && argument === positionalToRemove) {
			removedPositional = true;
			continue;
		}
		result.push(argument);
	}
	return removeInternalLaunchArguments(result);
}

function createProgram(invocationArgs: string[]): Command {
	const shouldAutoOpenBrowser = shouldAutoOpenBrowserTabForInvocation(invocationArgs);
	const program = new Command().enablePositionalOptions();
	program
		.name("kanban")
		.description("Local orchestration board for coding agents.")
		.version(KANBAN_VERSION, "-v, --version", "Output the version number");
	registerLaunchOptions(program)
		.option("--update", "Update Kanban to the latest published version and exit.")
		.addOption(new Option("--__daemon-child", "Internal daemon child marker.").hideHelp())
		.showHelpAfterError()
		.addHelpText("after", `\nRuntime URL: ${getKanbanRuntimeOrigin()}`);

	registerTaskCommand(program);
	registerHooksCommand(program);

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

	const startCommand = program.command("start").description("Start Kanban in the background.");
	registerLaunchOptions(startCommand).action(async (options: LaunchCommandOptions) => {
		await startDaemonProcess(
			normalizeLaunchOptions(options),
			process.cwd(),
			getLaunchArgumentsAfterCommand(invocationArgs, "start"),
		);
	});

	const stopCommand = program
		.command("stop [pid]")
		.description("Stop a Kanban process, or all Kanban processes when PID is omitted.");
	stopCommand.action(async (pid: string | undefined) => {
		await runStopCommand(pid);
	});

	const restartCommand = program
		.command("restart [pid]")
		.description("Restart a Kanban process, or all processes into one background instance.");
	registerLaunchOptions(restartCommand).action(
		async (pid: string | undefined, options: LaunchCommandOptions, command: Command) => {
			await runRestartCommand(pid, options, command, getLaunchArgumentsAfterCommand(invocationArgs, "restart", pid));
		},
	);

	program
		.command("status")
		.description("Show running foreground and background Kanban processes.")
		.option("--json", "Output machine-readable JSON.")
		.action(async (options: { json?: boolean }) => {
			await runStatusCommand(options.json === true);
		});

	program.action(async (options: RootCommandOptions) => {
		if (options.update === true) {
			await runUpdateCommand();
			return;
		}
		await runMainCommand(
			{
				...normalizeLaunchOptions(options),
				mode: options.__daemonChild === true ? "background" : "foreground",
				daemonChild: options.__daemonChild === true,
				launchArgs: removeInternalLaunchArguments(invocationArgs),
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
	const isDaemonChild = argv.includes("--__daemon-child");
	if (!shouldAutoOpenBrowserTabForInvocation(argv) && !isDaemonChild) {
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
