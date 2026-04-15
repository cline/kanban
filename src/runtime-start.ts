import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { fileURLToPath } from "node:url";
import { loadGlobalRuntimeConfig, loadRuntimeConfig } from "./config/runtime-config";
import { createGitProcessEnv } from "./core/git-process-env";
import {
	DEFAULT_KANBAN_RUNTIME_HOST,
	getKanbanRuntimeOrigin,
	getKanbanRuntimePort,
	setKanbanRuntimeHost,
	setKanbanRuntimePort,
} from "./core/runtime-endpoint";
import { runScopedCommand } from "./core/scoped-command";
import type { RuntimeStateHub } from "./server/runtime-state-hub";
import type { TerminalSessionManager } from "./terminal/session-manager";

function readRuntimeVersion(): string {
	try {
		const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
		return packageJson.version;
	} catch {
		return "0.0.0";
	}
}

export interface RuntimeCallbacks {
	pickDirectory?: () => Promise<string | null>;
	warn?: (message: string) => void;
}

export interface RuntimeStartOptions {
	host?: string;
	port?: number | "auto";
	authToken?: string;
	cwd?: string;
	isLocal?: boolean;
	openInBrowser?: boolean;
	callbacks?: RuntimeCallbacks;
}

/** @deprecated Use {@link RuntimeStartOptions} instead. */
export type RuntimeOptions = RuntimeStartOptions;

export interface RuntimeShutdownOptions {
	skipSessionCleanup?: boolean;
}

export interface RuntimeHandle {
	url: string;
	shutdown: (options?: RuntimeShutdownOptions) => Promise<void>;
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

async function pathIsDirectory(path: string): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isDirectory();
	} catch {
		return false;
	}
}

async function assertPathIsDirectory(path: string): Promise<void> {
	const info = await stat(path);
	if (!info.isDirectory()) {
		throw new Error(`Project path is not a directory: ${path}`);
	}
}

function isAddressInUseError(error: unknown): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "EADDRINUSE"
	);
}

async function isPortAvailable(port: number, host: string): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const probe = createNetServer();
		probe.once("error", () => {
			resolve(false);
		});
		probe.listen(port, host, () => {
			probe.close(() => {
				resolve(true);
			});
		});
	});
}

async function findAvailableRuntimePort(startPort: number, host: string): Promise<number> {
	for (let candidate = startPort; candidate <= 65535; candidate += 1) {
		if (await isPortAvailable(candidate, host)) {
			return candidate;
		}
	}
	throw new Error("No available runtime port found.");
}

async function bootServer(
	warn: (message: string) => void,
	pickDirectory: () => Promise<string | null>,
	isLocal: boolean,
	runtimeVersion: string,
	runtimeCwd: string,
	authToken: string | undefined,
): Promise<{
	url: string;
	close: () => Promise<void>;
	shutdown: (options?: { skipSessionCleanup?: boolean }) => Promise<void>;
}> {
	const [
		{ resolveProjectInputPath },
		{ createRuntimeServer },
		{ createRuntimeStateHub },
		{ resolveInteractiveShellCommand },
		{ shutdownRuntimeServer },
		{ collectProjectWorktreeTaskIdsForRemoval, createWorkspaceRegistry },
	] = await Promise.all([
		import("./projects/project-path.js"),
		import("./server/runtime-server.js"),
		import("./server/runtime-state-hub.js"),
		import("./server/shell.js"),
		import("./server/shutdown-coordinator.js"),
		import("./server/workspace-registry.js"),
	]);
	let runtimeStateHub: RuntimeStateHub | undefined;
	const workspaceRegistry = await createWorkspaceRegistry({
		cwd: runtimeCwd,
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
		isLocal,
		runtimeVersion,
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
			warn(`[kanban] ${message}`);
		},
		ensureTerminalManagerForWorkspace: workspaceRegistry.ensureTerminalManagerForWorkspace,
		resolveInteractiveShellCommand,
		runCommand: runScopedCommand,
		resolveProjectInputPath,
		assertPathIsDirectory,
		hasGitRepository,
		disposeWorkspace: disposeTrackedWorkspace,
		collectProjectWorktreeTaskIdsForRemoval,
		pickDirectoryPathFromSystemDialog: async () => await pickDirectory(),
		authToken,
		// Lazy getter: when port 0 is used, getKanbanRuntimeOrigin() returns
		// the correct origin only after server.listen() updates the global port.
		allowedOrigins: authToken ? () => [getKanbanRuntimeOrigin()] : undefined,
		version: runtimeVersion,
	});

	const close = async () => {
		await runtimeServer.close();
	};

	const shutdown = async (options?: { skipSessionCleanup?: boolean }) => {
		await shutdownRuntimeServer({
			workspaceRegistry,
			warn: (message) => {
				warn(`[kanban] ${message}`);
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

export async function startRuntime(options?: RuntimeStartOptions): Promise<RuntimeHandle> {
	const host = options?.host ?? DEFAULT_KANBAN_RUNTIME_HOST;
	const portOption = options?.port;
	const warn = options?.callbacks?.warn ?? console.warn;
	const runtimeCwd = options?.cwd ?? process.cwd();

	const defaultPickDirectory = async (): Promise<string | null> => {
		const { pickDirectoryPathFromSystemDialog } = await import("./server/directory-picker.js");
		return Promise.resolve(pickDirectoryPathFromSystemDialog());
	};
	const pickDirectory = options?.callbacks?.pickDirectory ?? defaultPickDirectory;
	const isLocal = options?.isLocal ?? true;
	const runtimeVersion = readRuntimeVersion();

	setKanbanRuntimeHost(host);

	// Publish the auth token to process.env so that PTY child processes
	// (agents) inherit it automatically — same pattern as KANBAN_RUNTIME_HOST
	// and KANBAN_RUNTIME_PORT.  This lets `kanban task create` invoked from
	// within an agent PTY resolve the correct runtime connection without
	// needing the filesystem descriptor fallback.
	if (options?.authToken) {
		process.env.KANBAN_AUTH_TOKEN = options.authToken;
	}

	if (portOption === "auto") {
		// Use port 0 — the OS picks an available ephemeral port atomically,
		// eliminating the TOCTOU race inherent in probe-then-listen.
		// The actual port is read back after server.listen() completes.
		setKanbanRuntimePort(0);
	} else if (typeof portOption === "number") {
		setKanbanRuntimePort(portOption);
	}

	const isAutoPort = portOption === "auto";

	const boot = async (): Promise<RuntimeHandle> => {
		const server = await bootServer(warn, pickDirectory, isLocal, runtimeVersion, runtimeCwd, options?.authToken);
		return {
			url: server.url,
			shutdown: async (shutdownOptions?: RuntimeShutdownOptions) => {
				await server.shutdown({
					skipSessionCleanup: shutdownOptions?.skipSessionCleanup,
				});
			},
		};
	};

	if (!isAutoPort) {
		return await boot();
	}

	// Auto-port retry loop: if the port became busy between the probe and
	// the actual listen, pick the next available port and retry.
	while (true) {
		try {
			return await boot();
		} catch (error) {
			if (!isAddressInUseError(error)) {
				throw error;
			}
			const currentPort = getKanbanRuntimePort();
			const retryPort = await findAvailableRuntimePort(currentPort + 1, host);
			setKanbanRuntimePort(retryPort);
			warn(`Runtime port ${currentPort} became busy during startup, retrying on ${retryPort}.`);
		}
	}
}
