import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";

import type {
	RuntimeBoardData,
	RuntimeHookIngestResponse,
	RuntimeProjectAddResponse,
	RuntimeProjectRemoveResponse,
	RuntimeProjectsResponse,
	RuntimeShellSessionStartResponse,
	RuntimeStateStreamMessage,
	RuntimeStateStreamProjectsMessage,
	RuntimeStateStreamSnapshotMessage,
	RuntimeStateStreamTaskReadyForReviewMessage,
	RuntimeStateStreamWorkspaceStateMessage,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorktreeEnsureResponse,
} from "../../src/core/api-contract";
import { createGitTestEnv } from "../utilities/git-env";
import { createTempDir } from "../utilities/temp-dir";

const requireFromHere = createRequire(import.meta.url);

interface RuntimeStreamClient {
	socket: WebSocket;
	waitForMessage: (
		predicate: (message: RuntimeStateStreamMessage) => boolean,
		timeoutMs?: number,
	) => Promise<RuntimeStateStreamMessage>;
	collectFor: (durationMs: number) => Promise<RuntimeStateStreamMessage[]>;
	close: () => Promise<void>;
}

function createBoard(title: string): RuntimeBoardData {
	const now = Date.now();
	return {
		columns: [
			{
				id: "backlog",
				title: "Backlog",
				cards: [
					{
						id: "task-1",
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function createReviewBoard(taskId: string, title: string, existingTrashTaskId?: string): RuntimeBoardData {
	const now = Date.now();
	const trashCards = existingTrashTaskId
		? [
				{
					id: existingTrashTaskId,
					prompt: "Already trashed task",
					startInPlanMode: false,
					baseRef: "main",
					createdAt: now,
					updatedAt: now,
				},
			]
		: [];
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{
				id: "review",
				title: "Review",
				cards: [
					{
						id: taskId,
						prompt: title,
						startInPlanMode: false,
						baseRef: "main",
						createdAt: now,
						updatedAt: now,
					},
				],
			},
			{ id: "trash", title: "Trash", cards: trashCards },
		],
		dependencies: [],
	};
}

async function getAvailablePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => resolveListen());
	});
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : null;
	await new Promise<void>((resolveClose, rejectClose) => {
		server.close((error) => {
			if (error) {
				rejectClose(error);
				return;
			}
			resolveClose();
		});
	});
	if (!port) {
		throw new Error("Could not allocate a test port.");
	}
	return port;
}

function initGitRepository(path: string): void {
	const init = spawnSync("git", ["init"], {
		cwd: path,
		stdio: "ignore",
		env: createGitTestEnv(),
	});
	if (init.status !== 0) {
		throw new Error(`Failed to initialize git repository at ${path}`);
	}
}

function runGit(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		env: createGitTestEnv(),
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
	}
	return result.stdout.trim();
}

function commitAll(cwd: string, message: string): string {
	runGit(cwd, ["add", "."]);
	runGit(cwd, ["commit", "-qm", message]);
	return runGit(cwd, ["rev-parse", "HEAD"]);
}

function resolveShutdownIpcHookPath(): string {
	return resolve(process.cwd(), "test/integration/shutdown-ipc-hook.cjs");
}

function resolveTsxLoaderImportSpecifier(): string {
	return pathToFileURL(requireFromHere.resolve("tsx")).href;
}

async function waitForProcessStart(process: ChildProcess, timeoutMs = 10_000): Promise<{ runtimeUrl: string }> {
	return await new Promise((resolveStart, rejectStart) => {
		if (!process.stdout || !process.stderr) {
			rejectStart(new Error("Expected child process stdout/stderr pipes to be available."));
			return;
		}
		let settled = false;
		let stdout = "";
		let stderr = "";
		const timeoutId = setTimeout(() => {
			if (settled) {
				return;
			}
			settled = true;
			rejectStart(new Error(`Timed out waiting for server start.\nstdout:\n${stdout}\nstderr:\n${stderr}`));
		}, timeoutMs);
		const handleOutput = (chunk: Buffer, source: "stdout" | "stderr") => {
			const text = chunk.toString();
			if (source === "stdout") {
				stdout += text;
			} else {
				stderr += text;
			}
			const match = stdout.match(/Cline Kanban running at (http:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/);
			if (!match || settled) {
				return;
			}
			const runtimeUrl = match[1];
			if (!runtimeUrl) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			resolveStart({ runtimeUrl });
		};
		process.stdout.on("data", (chunk: Buffer) => {
			handleOutput(chunk, "stdout");
		});
		process.stderr.on("data", (chunk: Buffer) => {
			handleOutput(chunk, "stderr");
		});
		process.once("exit", (code, signal) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeoutId);
			rejectStart(
				new Error(
					`Server process exited before startup (code=${String(code)} signal=${String(signal)}).\nstdout:\n${stdout}\nstderr:\n${stderr}`,
				),
			);
		});
	});
}

function getShutdownSignal(): NodeJS.Signals {
	return process.platform === "win32" ? "SIGTERM" : "SIGINT";
}

async function requestGracefulShutdown(childProcess: ChildProcess): Promise<void> {
	if (typeof childProcess.send !== "function" || !childProcess.connected) {
		childProcess.kill(getShutdownSignal());
		return;
	}

	await new Promise<void>((resolveSend) => {
		childProcess.send({ type: "kanban.shutdown" }, (error) => {
			if (error) {
				childProcess.kill(getShutdownSignal());
			}
			resolveSend();
		});
	});
}

async function waitForExit(childProcess: ChildProcess, timeoutMs: number): Promise<boolean> {
	if (childProcess.exitCode !== null) {
		return true;
	}

	return await new Promise<boolean>((resolveExit) => {
		const handleExit = () => {
			clearTimeout(timeoutId);
			resolveExit(true);
		};
		const timeoutId = setTimeout(() => {
			childProcess.removeListener("exit", handleExit);
			resolveExit(false);
		}, timeoutMs);
		childProcess.once("exit", handleExit);
	});
}

async function startKanbanServer(input: { cwd: string; homeDir: string; port: number; extraArgs?: string[] }): Promise<{
	runtimeUrl: string;
	stop: () => Promise<void>;
}> {
	const cliEntrypoint = resolve(process.cwd(), "src/cli.ts");
	const shutdownIpcHookPath = resolveShutdownIpcHookPath();
	const tsxLoaderImportSpecifier = resolveTsxLoaderImportSpecifier();
	const child = spawn(
		process.execPath,
		[
			"--require",
			shutdownIpcHookPath,
			"--import",
			tsxLoaderImportSpecifier,
			cliEntrypoint,
			"--no-open",
			...(input.extraArgs ?? []),
		],
		{
			cwd: input.cwd,
			env: createGitTestEnv({
				HOME: input.homeDir,
				USERPROFILE: input.homeDir,
				KANBAN_RUNTIME_PORT: String(input.port),
			}),
			stdio: ["ignore", "pipe", "pipe", "ipc"],
		},
	);
	const { runtimeUrl } = await waitForProcessStart(child);
	return {
		runtimeUrl,
		stop: async () => {
			if (child.exitCode !== null) {
				return;
			}
			await requestGracefulShutdown(child);
			const didExitGracefully = await waitForExit(child, 5_000);
			if (didExitGracefully) {
				return;
			}

			child.kill("SIGKILL");
			const didExitAfterForce = await waitForExit(child, 5_000);
			if (!didExitAfterForce) {
				throw new Error("Timed out stopping kanban test server process.");
			}
		},
	};
}

async function connectRuntimeStream(url: string): Promise<RuntimeStreamClient> {
	const socket = new WebSocket(url);
	const emitter = new EventEmitter();
	const queue: RuntimeStateStreamMessage[] = [];

	socket.on("message", (raw) => {
		try {
			const parsed = JSON.parse(String(raw)) as RuntimeStateStreamMessage;
			queue.push(parsed);
			emitter.emit("message");
		} catch {
			// Ignore malformed messages in tests.
		}
	});

	await new Promise<void>((resolveOpen, rejectOpen) => {
		const timeoutId = setTimeout(() => {
			rejectOpen(new Error(`Timed out connecting websocket: ${url}`));
		}, 5_000);
		socket.once("open", () => {
			clearTimeout(timeoutId);
			resolveOpen();
		});
		socket.once("error", (error) => {
			clearTimeout(timeoutId);
			rejectOpen(error);
		});
	});

	const waitForMessage = async (
		predicate: (message: RuntimeStateStreamMessage) => boolean,
		timeoutMs = 5_000,
	): Promise<RuntimeStateStreamMessage> =>
		await new Promise((resolveMessage, rejectMessage) => {
			let settled = false;
			const tryResolve = () => {
				if (settled) {
					return;
				}
				const index = queue.findIndex(predicate);
				if (index < 0) {
					return;
				}
				const [message] = queue.splice(index, 1);
				if (!message) {
					return;
				}
				settled = true;
				clearTimeout(timeoutId);
				emitter.removeListener("message", tryResolve);
				resolveMessage(message);
			};
			const timeoutId = setTimeout(() => {
				if (settled) {
					return;
				}
				settled = true;
				emitter.removeListener("message", tryResolve);
				rejectMessage(new Error("Timed out waiting for expected websocket message."));
			}, timeoutMs);
			emitter.on("message", tryResolve);
			tryResolve();
		});

	return {
		socket,
		waitForMessage,
		collectFor: async (durationMs: number) => {
			await new Promise((resolveDelay) => {
				setTimeout(resolveDelay, durationMs);
			});
			const messages = queue.slice();
			queue.length = 0;
			return messages;
		},
		close: async () => {
			if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
				return;
			}
			await new Promise<void>((resolveClose) => {
				socket.once("close", () => resolveClose());
				socket.close();
			});
		},
	};
}

async function requestJson<T>(input: {
	baseUrl: string;
	procedure: string;
	type: "query" | "mutation";
	workspaceId?: string | null;
	payload?: unknown;
}): Promise<{ status: number; payload: T }> {
	const unwrapTrpcPayload = (value: unknown): unknown => {
		const envelope = Array.isArray(value) ? value[0] : value;
		if (!envelope || typeof envelope !== "object") {
			return value;
		}
		if ("result" in envelope) {
			const result = (envelope as { result?: { data?: unknown } }).result;
			const data = result?.data;
			if (data && typeof data === "object" && "json" in data) {
				return (data as { json: unknown }).json;
			}
			return data;
		}
		if ("error" in envelope) {
			return (envelope as { error: unknown }).error;
		}
		return value;
	};
	const headers = new Headers();
	if (input.workspaceId) {
		headers.set("x-kanban-workspace-id", input.workspaceId);
	}
	let url = `${input.baseUrl}/api/trpc/${input.procedure}`;
	let method: "GET" | "POST";
	let body: string | undefined;
	if (input.type === "query") {
		method = "GET";
		if (input.payload !== undefined) {
			url += `?input=${encodeURIComponent(JSON.stringify(input.payload))}`;
		}
	} else {
		method = "POST";
		body = input.payload === undefined ? undefined : JSON.stringify(input.payload);
	}
	if (body !== undefined) {
		headers.set("Content-Type", "application/json");
	}
	const response = await fetch(url, {
		method,
		headers,
		body,
	});
	const payload = unwrapTrpcPayload(await response.json().catch(() => null)) as T;
	return {
		status: response.status,
		payload,
	};
}

describe.sequential("runtime state stream integration", () => {
	it("starts outside a git repository with no active workspace", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-no-git-");
		const { path: nonGitPath, cleanup: cleanupNonGitPath } = createTempDir("kanban-no-git-");

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: nonGitPath,
			homeDir: tempHome,
			port,
		});

		let stream: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			expect(runtimeUrl.pathname).toBe("/");

			const projectsResponse = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
			});
			expect(projectsResponse.status).toBe(200);
			expect(projectsResponse.payload.currentProjectId).toBeNull();
			expect(projectsResponse.payload.projects).toEqual([]);

			stream = await connectRuntimeStream(`ws://127.0.0.1:${port}/api/runtime/ws`);
			const snapshot = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.currentProjectId).toBeNull();
			expect(snapshot.workspaceState).toBeNull();
			expect(snapshot.projects).toEqual([]);
		} finally {
			if (stream) {
				await stream.close();
			}
			await server.stop();
			cleanupNonGitPath();
			cleanupHome();
		}
	}, 30_000);

	it("starts from the home directory with no active workspace", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-home-dir-launch-");

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: tempHome,
			homeDir: tempHome,
			port,
		});

		let stream: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			expect(runtimeUrl.pathname).toBe("/");

			const projectsResponse = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
			});
			expect(projectsResponse.status).toBe(200);
			expect(projectsResponse.payload.currentProjectId).toBeNull();
			expect(projectsResponse.payload.projects).toEqual([]);

			stream = await connectRuntimeStream(`ws://127.0.0.1:${port}/api/runtime/ws`);
			const snapshot = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.currentProjectId).toBeNull();
			expect(snapshot.workspaceState).toBeNull();
			expect(snapshot.projects).toEqual([]);
		} finally {
			if (stream) {
				await stream.close();
			}
			await server.stop();
			cleanupHome();
		}
	}, 30_000);

	it("launches outside git using the first indexed project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-first-project-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-first-project-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		const nonGitPath = join(tempRoot, "non-git");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		mkdirSync(nonGitPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbanServer({
			cwd: projectAPath,
			homeDir: tempHome,
			port: firstPort,
		});

		let workspaceAId: string | null = null;
		try {
			const firstRuntimeUrl = new URL(firstServer.runtimeUrl);
			workspaceAId = decodeURIComponent(firstRuntimeUrl.pathname.slice(1));
			expect(workspaceAId).not.toBe("");

			const addProjectResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: projectBPath,
				},
			});
			expect(addProjectResponse.status).toBe(200);
			expect(addProjectResponse.payload.ok).toBe(true);
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startKanbanServer({
			cwd: nonGitPath,
			homeDir: tempHome,
			port: secondPort,
		});

		let secondStream: RuntimeStreamClient | null = null;
		try {
			const secondRuntimeUrl = new URL(secondServer.runtimeUrl);
			expect(workspaceAId).not.toBeNull();
			if (!workspaceAId) {
				throw new Error("Missing workspace id for project A.");
			}
			const secondWorkspaceId = decodeURIComponent(secondRuntimeUrl.pathname.slice(1));
			expect(secondWorkspaceId).toBe(workspaceAId);
			const expectedProjectAPath = await realpath(projectAPath).catch(() => resolve(projectAPath));

			const projectsResponse = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "projects.list",
				type: "query",
			});
			expect(projectsResponse.status).toBe(200);
			expect(projectsResponse.payload.currentProjectId).toBe(workspaceAId);

			secondStream = await connectRuntimeStream(`ws://127.0.0.1:${secondPort}/api/runtime/ws`);
			const snapshot = (await secondStream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.currentProjectId).toBe(workspaceAId);
			expect(snapshot.workspaceState?.repoPath).toBe(expectedProjectAPath);
		} finally {
			if (secondStream) {
				await secondStream.close();
			}
			await secondServer.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 45_000);

	it("requires explicit confirmation before initializing git for a non-git added project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-project-add-git-confirm-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-project-add-git-confirm-");

		const projectAPath = join(tempRoot, "project-a");
		const nonGitPath = join(tempRoot, "non-git-project");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(nonGitPath, { recursive: true });
		initGitRepository(projectAPath);

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: projectAPath,
			homeDir: tempHome,
			port,
		});

		let workspaceAId: string | null = null;
		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			workspaceAId = decodeURIComponent(runtimeUrl.pathname.slice(1));
			expect(workspaceAId).not.toBe("");

			const addWithoutInitResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: nonGitPath,
				},
			});
			expect(addWithoutInitResponse.status).toBe(200);
			expect(addWithoutInitResponse.payload.ok).toBe(false);
			expect(addWithoutInitResponse.payload.requiresGitInitialization).toBe(true);
			expect(existsSync(join(nonGitPath, ".git"))).toBe(false);

			const projectsAfterDeclinedInit = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
				workspaceId: workspaceAId,
			});
			expect(projectsAfterDeclinedInit.status).toBe(200);
			expect(projectsAfterDeclinedInit.payload.projects).toHaveLength(1);

			const addWithInitResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: nonGitPath,
					initializeGit: true,
				},
			});
			expect(addWithInitResponse.status).toBe(200);
			expect(addWithInitResponse.payload.ok).toBe(true);
			expect(addWithInitResponse.payload.project).not.toBeNull();
			expect(existsSync(join(nonGitPath, ".git"))).toBe(true);
		} finally {
			await server.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 45_000);

	it("streams per-project snapshots and isolates workspace updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-stream-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-projects-stream-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: projectAPath,
			homeDir: tempHome,
			port,
		});

		let streamA: RuntimeStreamClient | null = null;
		let streamB: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			const workspaceAId = decodeURIComponent(runtimeUrl.pathname.slice(1));
			expect(workspaceAId).not.toBe("");
			const expectedProjectAPath = await realpath(projectAPath).catch(() => resolve(projectAPath));
			const expectedProjectBPath = await realpath(projectBPath).catch(() => resolve(projectBPath));

			const addProjectResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: projectBPath,
				},
			});
			expect(addProjectResponse.status).toBe(200);
			expect(addProjectResponse.payload.ok).toBe(true);
			const workspaceBId = addProjectResponse.payload.project?.id ?? null;
			expect(workspaceBId).not.toBeNull();
			if (!workspaceBId) {
				throw new Error("Missing project id for added workspace.");
			}

			streamA = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceAId)}`,
			);
			const snapshotA = (await streamA.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshotA.currentProjectId).toBe(workspaceAId);
			expect(snapshotA.workspaceState?.repoPath).toBe(expectedProjectAPath);
			expect(snapshotA.projects.map((project) => project.id).sort()).toEqual([workspaceAId, workspaceBId].sort());

			streamB = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceBId)}`,
			);
			const snapshotB = (await streamB.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshotB.currentProjectId).toBe(workspaceBId);
			expect(snapshotB.workspaceState?.repoPath).toBe(expectedProjectBPath);

			const currentWorkspaceBState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId: workspaceBId,
			});
			const previousRevision = currentWorkspaceBState.payload.revision;
			const saveWorkspaceBResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId: workspaceBId,
				payload: {
					board: createBoard("Realtime Task"),
					sessions: currentWorkspaceBState.payload.sessions,
					expectedRevision: previousRevision,
				},
			});
			expect(saveWorkspaceBResponse.status).toBe(200);
			expect(saveWorkspaceBResponse.payload.revision).toBe(previousRevision + 1);

			const workspaceUpdateB = (await streamB.waitForMessage(
				(message): message is RuntimeStateStreamWorkspaceStateMessage =>
					message.type === "workspace_state_updated" && message.workspaceId === workspaceBId,
			)) as RuntimeStateStreamWorkspaceStateMessage;
			expect(workspaceUpdateB.workspaceState.revision).toBe(previousRevision + 1);
			expect(workspaceUpdateB.workspaceState.board.columns[0]?.cards[0]?.prompt).toBe("Realtime Task");

			const streamAMessages = await streamA.collectFor(500);
			expect(
				streamAMessages.some(
					(message) => message.type === "workspace_state_updated" && message.workspaceId === workspaceBId,
				),
			).toBe(false);

			const projectsAfterUpdate = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
				workspaceId: workspaceAId,
			});
			expect(projectsAfterUpdate.status).toBe(200);
			const projectB = projectsAfterUpdate.payload.projects.find((project) => project.id === workspaceBId) ?? null;
			expect(projectB?.taskCounts.backlog).toBe(1);
		} finally {
			if (streamA) {
				await streamA.close();
			}
			if (streamB) {
				await streamB.close();
			}
			await server.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 30_000);

	it("emits task_ready_for_review when hook review event is ingested", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-hook-stream-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-hook-stream-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port,
		});

		let stream: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			const workspaceId = decodeURIComponent(runtimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			stream = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`,
			);
			await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			);

			const taskId = "hook-review-task";
			const startShellResponse = await requestJson<RuntimeShellSessionStartResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "runtime.startShellSession",
				type: "mutation",
				workspaceId,
				payload: {
					taskId,
					baseRef: "HEAD",
				},
			});
			expect(startShellResponse.status).toBe(200);
			expect(startShellResponse.payload.ok).toBe(true);

			const hookResponse = await requestJson<RuntimeHookIngestResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "hooks.ingest",
				type: "mutation",
				payload: {
					taskId,
					workspaceId,
					event: "to_review",
				},
			});
			expect(hookResponse.status).toBe(200);
			expect(hookResponse.payload.ok).toBe(true);

			const readyMessage = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamTaskReadyForReviewMessage =>
					message.type === "task_ready_for_review" &&
					message.workspaceId === workspaceId &&
					message.taskId === taskId,
			)) as RuntimeStateStreamTaskReadyForReviewMessage;
			expect(readyMessage.type).toBe("task_ready_for_review");
			expect(readyMessage.triggeredAt).toBeGreaterThan(0);

			await requestJson({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "runtime.stopTaskSession",
				type: "mutation",
				workspaceId,
				payload: { taskId },
			});
		} finally {
			if (stream) {
				await stream.close();
			}
			await server.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 30_000);

	it("streams centralized workspace metadata updates for task worktrees", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-metadata-stream-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-metadata-stream-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);
		runGit(projectPath, ["config", "user.name", "Test User"]);
		runGit(projectPath, ["config", "user.email", "test@example.com"]);
		writeFileSync(join(projectPath, "README.md"), "seed\n", "utf8");
		commitAll(projectPath, "seed project");

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port,
		});

		let stream: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			const workspaceId = decodeURIComponent(runtimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const stateResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(stateResponse.status).toBe(200);

			const taskId = "metadata-stream-task";
			const trashTaskId = "metadata-trash-task";
			const baseRef = runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
			const board = createReviewBoard(taskId, "Metadata stream task", trashTaskId);
			const reviewColumn = board.columns.find((column) => column.id === "review");
			const trashColumn = board.columns.find((column) => column.id === "trash");
			if (!reviewColumn || !reviewColumn.cards[0]) {
				throw new Error("Expected seeded review card.");
			}
			reviewColumn.cards[0].baseRef = baseRef;
			if (!trashColumn || !trashColumn.cards[0]) {
				throw new Error("Expected seeded trash card.");
			}
			trashColumn.cards[0].baseRef = baseRef;

			const saveResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board,
					sessions: stateResponse.payload.sessions,
					expectedRevision: stateResponse.payload.revision,
				},
			});
			expect(saveResponse.status).toBe(200);

			const ensureResponse = await requestJson<RuntimeWorktreeEnsureResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.ensureWorktree",
				type: "mutation",
				workspaceId,
				payload: {
					taskId,
					baseRef,
				},
			});
			expect(ensureResponse.status).toBe(200);
			expect(ensureResponse.payload.ok).toBe(true);
			if (!ensureResponse.payload.ok) {
				throw new Error(ensureResponse.payload.error ?? "ensureWorktree failed");
			}

			stream = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceId)}`,
			);
			const snapshot = (await stream.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(snapshot.workspaceMetadata).not.toBeNull();
			const initialTaskMetadata =
				snapshot.workspaceMetadata?.taskWorkspaces.find((task) => task.taskId === taskId) ?? null;
			expect(initialTaskMetadata).not.toBeNull();
			expect(initialTaskMetadata?.changedFiles ?? 0).toBe(0);
			expect(snapshot.workspaceMetadata?.taskWorkspaces.some((task) => task.taskId === trashTaskId)).toBe(false);
			const messagesAfterInitialSnapshot = await stream.collectFor(250);
			expect(messagesAfterInitialSnapshot.some((message) => message.type === "workspace_metadata_updated")).toBe(
				false,
			);

			writeFileSync(join(ensureResponse.payload.path, "task-change.txt"), "updated\n", "utf8");

			const metadataMessage = await stream.waitForMessage(
				(message) =>
					message.type === "workspace_metadata_updated" &&
					message.workspaceId === workspaceId &&
					message.workspaceMetadata.taskWorkspaces.some(
						(task) => task.taskId === taskId && (task.changedFiles ?? 0) > 0,
					),
				10_000,
			);
			expect(metadataMessage.type).toBe("workspace_metadata_updated");
			if (metadataMessage.type !== "workspace_metadata_updated") {
				throw new Error("Expected workspace metadata update message.");
			}
			const updatedTaskMetadata = metadataMessage.workspaceMetadata.taskWorkspaces.find(
				(task) => task.taskId === taskId,
			);
			expect(updatedTaskMetadata?.changedFiles).toBeGreaterThan(0);
			expect(updatedTaskMetadata?.stateVersion).toBeGreaterThan(initialTaskMetadata?.stateVersion ?? 0);
		} finally {
			if (stream) {
				await stream.close();
			}
			await server.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("preserves existing task worktree when base ref advances", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-preserve-worktree-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-preserve-worktree-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);
		runGit(projectPath, ["config", "user.name", "Test User"]);
		runGit(projectPath, ["config", "user.email", "test@example.com"]);
		writeFileSync(join(projectPath, "initial.txt"), "one\n", "utf8");
		const firstBaseCommit = commitAll(projectPath, "initial commit");
		const baseRef = runGit(projectPath, ["symbolic-ref", "--short", "HEAD"]);

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port,
		});

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			const workspaceId = decodeURIComponent(runtimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const stateResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(stateResponse.status).toBe(200);

			const taskId = "preserve-worktree-task";
			const board = createBoard("Preserve existing worktree");
			const backlogColumn = board.columns.find((column) => column.id === "backlog");
			if (!backlogColumn || !backlogColumn.cards[0]) {
				throw new Error("Expected a backlog card for seed board.");
			}
			backlogColumn.cards[0].id = taskId;
			backlogColumn.cards[0].baseRef = baseRef;

			const saveResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board,
					sessions: stateResponse.payload.sessions,
					expectedRevision: stateResponse.payload.revision,
				},
			});
			expect(saveResponse.status).toBe(200);

			const firstEnsure = await requestJson<RuntimeWorktreeEnsureResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.ensureWorktree",
				type: "mutation",
				workspaceId,
				payload: {
					taskId,
					baseRef,
				},
			});
			expect(firstEnsure.status).toBe(200);
			expect(firstEnsure.payload.ok).toBe(true);
			if (!firstEnsure.payload.ok) {
				throw new Error(firstEnsure.payload.error ?? "ensureWorktree failed");
			}
			expect(firstEnsure.payload.baseCommit).toBe(firstBaseCommit);

			runGit(firstEnsure.payload.path, ["config", "user.name", "Task User"]);
			runGit(firstEnsure.payload.path, ["config", "user.email", "task@example.com"]);
			writeFileSync(join(firstEnsure.payload.path, "task-local.txt"), "task commit\n", "utf8");
			const taskWorktreeCommit = commitAll(firstEnsure.payload.path, "task-local commit");

			writeFileSync(join(projectPath, "advance-base.txt"), "two\n", "utf8");
			const advancedBaseCommit = commitAll(projectPath, "advance base");
			expect(advancedBaseCommit).not.toBe(firstBaseCommit);

			const secondEnsure = await requestJson<RuntimeWorktreeEnsureResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.ensureWorktree",
				type: "mutation",
				workspaceId,
				payload: {
					taskId,
					baseRef,
				},
			});
			expect(secondEnsure.status).toBe(200);
			expect(secondEnsure.payload.ok).toBe(true);
			if (!secondEnsure.payload.ok) {
				throw new Error(secondEnsure.payload.error ?? "ensureWorktree failed");
			}
			expect(secondEnsure.payload.path).toBe(firstEnsure.payload.path);
			expect(secondEnsure.payload.baseCommit).toBe(taskWorktreeCommit);

			const taskContext = await requestJson<RuntimeTaskWorkspaceInfoResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "workspace.getTaskContext",
				type: "query",
				workspaceId,
				payload: {
					taskId,
					baseRef,
				},
			});
			expect(taskContext.status).toBe(200);
			expect(taskContext.payload.headCommit).toBe(taskWorktreeCommit);
		} finally {
			await server.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("moves stale hook-review cards to trash on shutdown", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-stale-review-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-stale-review-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "stale-review-task";
		const taskTitle = "Stale Review Task";
		const existingTrashTaskId = "existing-trash-task";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: firstPort,
		});

		try {
			const firstRuntimeUrl = new URL(firstServer.runtimeUrl);
			const workspaceId = decodeURIComponent(firstRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const currentState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(currentState.status).toBe(200);

			const seedResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board: createReviewBoard(taskId, taskTitle, existingTrashTaskId),
					sessions: {
						[taskId]: {
							taskId,
							state: "awaiting_review",
							agentId: "codex",
							workspacePath: projectPath,
							pid: null,
							startedAt: now - 2_000,
							updatedAt: now,
							lastOutputAt: now,
							reviewReason: "hook",
							exitCode: null,
							lastHookAt: null,
							latestHookActivity: null,
						},
					},
					expectedRevision: currentState.payload.revision,
				},
			});
			expect(seedResponse.status).toBe(200);
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const secondRuntimeUrl = new URL(secondServer.runtimeUrl);
			const workspaceId = decodeURIComponent(secondRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(finalState.status).toBe(200);

			const reviewCards = finalState.payload.board.columns.find((column) => column.id === "review")?.cards ?? [];
			const trashCards = finalState.payload.board.columns.find((column) => column.id === "trash")?.cards ?? [];
			expect(reviewCards.some((card) => card.id === taskId)).toBe(false);
			expect(trashCards.some((card) => card.id === taskId)).toBe(true);
			expect(trashCards[0]?.id).toBe(taskId);
			expect(trashCards.some((card) => card.id === existingTrashTaskId)).toBe(true);
			expect(finalState.payload.sessions[taskId]?.state).toBe("interrupted");
			expect(finalState.payload.sessions[taskId]?.reviewReason).toBe("interrupted");
		} finally {
			await secondServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("moves stale completed review cards to trash on shutdown", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-stale-exit-review-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-stale-exit-review-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "stale-exit-review-task";
		const taskTitle = "Stale Exit Review Task";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: firstPort,
		});

		try {
			const firstRuntimeUrl = new URL(firstServer.runtimeUrl);
			const workspaceId = decodeURIComponent(firstRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const currentState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(currentState.status).toBe(200);

			const seedResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board: createReviewBoard(taskId, taskTitle),
					sessions: {
						[taskId]: {
							taskId,
							state: "awaiting_review",
							agentId: "codex",
							workspacePath: projectPath,
							pid: null,
							startedAt: now - 2_000,
							updatedAt: now,
							lastOutputAt: now,
							reviewReason: "exit",
							exitCode: 0,
							lastHookAt: null,
							latestHookActivity: null,
						},
					},
					expectedRevision: currentState.payload.revision,
				},
			});
			expect(seedResponse.status).toBe(200);
			const taskWorkspaceInfo = await requestJson<RuntimeTaskWorkspaceInfoResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getTaskContext",
				type: "query",
				workspaceId,
				payload: {
					taskId,
					baseRef: "HEAD",
				},
			});
			expect(taskWorkspaceInfo.status).toBe(200);
			mkdirSync(taskWorkspaceInfo.payload.path, { recursive: true });
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const secondRuntimeUrl = new URL(secondServer.runtimeUrl);
			const workspaceId = decodeURIComponent(secondRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(finalState.status).toBe(200);

			const reviewCards = finalState.payload.board.columns.find((column) => column.id === "review")?.cards ?? [];
			const trashCards = finalState.payload.board.columns.find((column) => column.id === "trash")?.cards ?? [];
			expect(reviewCards.some((card) => card.id === taskId)).toBe(false);
			expect(trashCards.some((card) => card.id === taskId)).toBe(true);
			expect(finalState.payload.sessions[taskId]?.state).toBe("interrupted");
			expect(finalState.payload.sessions[taskId]?.reviewReason).toBe("interrupted");
			const workspaceInfo = await requestJson<RuntimeTaskWorkspaceInfoResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getTaskContext",
				type: "query",
				workspaceId,
				payload: {
					taskId,
					baseRef: "HEAD",
				},
			});
			expect(workspaceInfo.status).toBe(200);
			expect(workspaceInfo.payload.exists).toBe(false);
		} finally {
			await secondServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("skips stale session shutdown cleanup when --skip-shutdown-cleanup is enabled", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-skip-cleanup-flag-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanban-project-skip-cleanup-flag-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "skip-cleanup-flag-review-task";
		const taskTitle = "Keep review task when cleanup flag is enabled";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: firstPort,
			extraArgs: ["--skip-shutdown-cleanup"],
		});

		try {
			const firstRuntimeUrl = new URL(firstServer.runtimeUrl);
			const workspaceId = decodeURIComponent(firstRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const currentState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(currentState.status).toBe(200);

			const seedResponse = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.saveState",
				type: "mutation",
				workspaceId,
				payload: {
					board: createReviewBoard(taskId, taskTitle),
					sessions: {
						[taskId]: {
							taskId,
							state: "awaiting_review",
							agentId: "codex",
							workspacePath: projectPath,
							pid: null,
							startedAt: now - 2_000,
							updatedAt: now,
							lastOutputAt: now,
							reviewReason: "hook",
							exitCode: null,
							lastHookAt: null,
							latestHookActivity: null,
						},
					},
					expectedRevision: currentState.payload.revision,
				},
			});
			expect(seedResponse.status).toBe(200);

			const taskWorkspaceInfo = await requestJson<RuntimeTaskWorkspaceInfoResponse>({
				baseUrl: `http://127.0.0.1:${firstPort}`,
				procedure: "workspace.getTaskContext",
				type: "query",
				workspaceId,
				payload: {
					taskId,
					baseRef: "HEAD",
				},
			});
			expect(taskWorkspaceInfo.status).toBe(200);
			mkdirSync(taskWorkspaceInfo.payload.path, { recursive: true });
		} finally {
			await firstServer.stop();
		}

		const secondPort = await getAvailablePort();
		const secondServer = await startKanbanServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const secondRuntimeUrl = new URL(secondServer.runtimeUrl);
			const workspaceId = decodeURIComponent(secondRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(finalState.status).toBe(200);

			const reviewCards = finalState.payload.board.columns.find((column) => column.id === "review")?.cards ?? [];
			const trashCards = finalState.payload.board.columns.find((column) => column.id === "trash")?.cards ?? [];
			expect(reviewCards.some((card) => card.id === taskId)).toBe(true);
			expect(trashCards.some((card) => card.id === taskId)).toBe(false);
			expect(finalState.payload.sessions[taskId]?.state).toBe("awaiting_review");
			expect(finalState.payload.sessions[taskId]?.reviewReason).toBe("hook");

			const workspaceInfo = await requestJson<RuntimeTaskWorkspaceInfoResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getTaskContext",
				type: "query",
				workspaceId,
				payload: {
					taskId,
					baseRef: "HEAD",
				},
			});
			expect(workspaceInfo.status).toBe(200);
			expect(workspaceInfo.payload.exists).toBe(true);
		} finally {
			await secondServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("falls back to remaining project when removing the active project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanban-home-remove-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanban-projects-remove-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const port = await getAvailablePort();
		const server = await startKanbanServer({
			cwd: projectAPath,
			homeDir: tempHome,
			port,
		});

		let streamA: RuntimeStreamClient | null = null;
		let streamB: RuntimeStreamClient | null = null;

		try {
			const runtimeUrl = new URL(server.runtimeUrl);
			const workspaceAId = decodeURIComponent(runtimeUrl.pathname.slice(1));
			expect(workspaceAId).not.toBe("");
			const expectedProjectBPath = await realpath(projectBPath).catch(() => resolve(projectBPath));

			const addProjectResponse = await requestJson<RuntimeProjectAddResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.add",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					path: projectBPath,
				},
			});
			expect(addProjectResponse.status).toBe(200);
			expect(addProjectResponse.payload.ok).toBe(true);
			const workspaceBId = addProjectResponse.payload.project?.id ?? null;
			expect(workspaceBId).not.toBeNull();
			if (!workspaceBId) {
				throw new Error("Missing project id for added workspace.");
			}

			streamA = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceAId)}`,
			);
			const initialSnapshot = (await streamA.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(initialSnapshot.currentProjectId).toBe(workspaceAId);

			const removeResponse = await requestJson<RuntimeProjectRemoveResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.remove",
				type: "mutation",
				workspaceId: workspaceAId,
				payload: {
					projectId: workspaceAId,
				},
			});
			expect(removeResponse.status).toBe(200);
			expect(removeResponse.payload.ok).toBe(true);

			const projectsUpdated = (await streamA.waitForMessage(
				(message): message is RuntimeStateStreamProjectsMessage =>
					message.type === "projects_updated" && message.currentProjectId === workspaceBId,
			)) as RuntimeStateStreamProjectsMessage;
			expect(projectsUpdated.currentProjectId).toBe(workspaceBId);
			expect(projectsUpdated.projects.map((project) => project.id)).toEqual([workspaceBId]);

			streamB = await connectRuntimeStream(
				`ws://127.0.0.1:${port}/api/runtime/ws?workspaceId=${encodeURIComponent(workspaceBId)}`,
			);
			const fallbackSnapshot = (await streamB.waitForMessage(
				(message): message is RuntimeStateStreamSnapshotMessage => message.type === "snapshot",
			)) as RuntimeStateStreamSnapshotMessage;
			expect(fallbackSnapshot.currentProjectId).toBe(workspaceBId);
			expect(fallbackSnapshot.workspaceState?.repoPath).toBe(expectedProjectBPath);

			const projectsAfterRemoval = await requestJson<RuntimeProjectsResponse>({
				baseUrl: `http://127.0.0.1:${port}`,
				procedure: "projects.list",
				type: "query",
				workspaceId: workspaceBId,
			});
			expect(projectsAfterRemoval.status).toBe(200);
			expect(projectsAfterRemoval.payload.currentProjectId).toBe(workspaceBId);
			expect(projectsAfterRemoval.payload.projects.map((project) => project.id)).toEqual([workspaceBId]);
		} finally {
			if (streamA) {
				await streamA.close();
			}
			if (streamB) {
				await streamB.close();
			}
			await server.stop();
			cleanupRoot();
			cleanupHome();
		}
	}, 30_000);
});
