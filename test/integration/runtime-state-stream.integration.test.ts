import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

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
} from "../../src/runtime/api-contract.js";
import { createGitTestEnv } from "../utilities/git-env.js";
import { createTempDir } from "../utilities/temp-dir.js";

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

function createReviewBoard(taskId: string, title: string): RuntimeBoardData {
	const now = Date.now();
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
			{ id: "trash", title: "Trash", cards: [] },
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

function resolveTsxCliEntrypoint(): string {
	const packageJsonPath = requireFromHere.resolve("tsx/package.json");
	const packageJson = requireFromHere(packageJsonPath) as {
		bin?: string | Record<string, string>;
	};
	const binValue =
		typeof packageJson.bin === "string"
			? packageJson.bin
			: packageJson.bin && typeof packageJson.bin === "object"
				? (packageJson.bin.tsx ?? Object.values(packageJson.bin)[0])
				: null;
	if (!binValue) {
		throw new Error("Could not resolve tsx CLI entrypoint from package metadata.");
	}
	return resolve(dirname(packageJsonPath), binValue);
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
			const match = stdout.match(/Kanbanana running at (http:\/\/127\.0\.0\.1:\d+(?:\/[^\s]*)?)/);
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

async function startKanbananaServer(input: { cwd: string; homeDir: string; port: number }): Promise<{
	runtimeUrl: string;
	stop: () => Promise<void>;
}> {
	const tsxEntrypoint = resolveTsxCliEntrypoint();
	const cliEntrypoint = resolve(process.cwd(), "src/cli.ts");
	const child = spawn(process.execPath, [tsxEntrypoint, cliEntrypoint, "--no-open"], {
		cwd: input.cwd,
		env: createGitTestEnv({
			HOME: input.homeDir,
			USERPROFILE: input.homeDir,
			KANBANANA_RUNTIME_PORT: String(input.port),
		}),
		stdio: ["ignore", "pipe", "pipe"],
	});
	const { runtimeUrl } = await waitForProcessStart(child);
	return {
		runtimeUrl,
		stop: async () => {
			if (child.exitCode !== null) {
				return;
			}
			const exitPromise = new Promise<void>((resolveExit) => {
				child.once("exit", () => {
					resolveExit();
				});
			});
			child.kill("SIGINT");
			await Promise.race([
				exitPromise,
				new Promise<void>((resolveTimeout) => {
					setTimeout(() => {
						if (child.exitCode === null) {
							child.kill("SIGKILL");
						}
						resolveTimeout();
					}, 5_000);
				}),
			]);
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
		headers.set("x-kanbanana-workspace-id", input.workspaceId);
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
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-no-git-");
		const { path: nonGitPath, cleanup: cleanupNonGitPath } = createTempDir("kanbanana-no-git-");

		const port = await getAvailablePort();
		const server = await startKanbananaServer({
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

	it("launches outside git using the first indexed project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-first-project-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanbanana-first-project-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		const nonGitPath = join(tempRoot, "non-git");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		mkdirSync(nonGitPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbananaServer({
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
		const secondServer = await startKanbananaServer({
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

	it("streams per-project snapshots and isolates workspace updates", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-stream-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanbanana-projects-stream-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const port = await getAvailablePort();
		const server = await startKanbananaServer({
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
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-hook-stream-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanbanana-project-hook-stream-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const port = await getAvailablePort();
		const server = await startKanbananaServer({
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

	it("moves stale hook-review cards to trash on shutdown after hydration", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-stale-review-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanbanana-project-stale-review-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "stale-review-task";
		const taskTitle = "Stale Review Task";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbananaServer({
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
							activityPreview: "Ready for review",
							reviewReason: "hook",
							exitCode: null,
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
		const secondServer = await startKanbananaServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const secondRuntimeUrl = new URL(secondServer.runtimeUrl);
			const workspaceId = decodeURIComponent(secondRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const hydratedState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(hydratedState.status).toBe(200);
			expect(hydratedState.payload.sessions[taskId]?.state).toBe("awaiting_review");
			expect(hydratedState.payload.sessions[taskId]?.reviewReason).toBe("hook");
		} finally {
			await secondServer.stop();
		}

		const thirdPort = await getAvailablePort();
		const thirdServer = await startKanbananaServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: thirdPort,
		});

		try {
			const thirdRuntimeUrl = new URL(thirdServer.runtimeUrl);
			const workspaceId = decodeURIComponent(thirdRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${thirdPort}`,
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
		} finally {
			await thirdServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("moves stale completed review cards to trash on shutdown after hydration", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-stale-exit-review-");
		const { path: projectPath, cleanup: cleanupProject } = createTempDir("kanbanana-project-stale-exit-review-");

		mkdirSync(projectPath, { recursive: true });
		initGitRepository(projectPath);

		const taskId = "stale-exit-review-task";
		const taskTitle = "Stale Exit Review Task";
		const now = Date.now();

		const firstPort = await getAvailablePort();
		const firstServer = await startKanbananaServer({
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
							activityPreview: "Completed successfully",
							reviewReason: "exit",
							exitCode: 0,
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
		const secondServer = await startKanbananaServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: secondPort,
		});

		try {
			const secondRuntimeUrl = new URL(secondServer.runtimeUrl);
			const workspaceId = decodeURIComponent(secondRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const hydratedState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${secondPort}`,
				procedure: "workspace.getState",
				type: "query",
				workspaceId,
			});
			expect(hydratedState.status).toBe(200);
			expect(hydratedState.payload.sessions[taskId]?.state).toBe("awaiting_review");
			expect(hydratedState.payload.sessions[taskId]?.reviewReason).toBe("exit");
		} finally {
			await secondServer.stop();
		}

		const thirdPort = await getAvailablePort();
		const thirdServer = await startKanbananaServer({
			cwd: projectPath,
			homeDir: tempHome,
			port: thirdPort,
		});

		try {
			const thirdRuntimeUrl = new URL(thirdServer.runtimeUrl);
			const workspaceId = decodeURIComponent(thirdRuntimeUrl.pathname.slice(1));
			expect(workspaceId).not.toBe("");

			const finalState = await requestJson<RuntimeWorkspaceStateResponse>({
				baseUrl: `http://127.0.0.1:${thirdPort}`,
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
				baseUrl: `http://127.0.0.1:${thirdPort}`,
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
			await thirdServer.stop();
			cleanupProject();
			cleanupHome();
		}
	}, 45_000);

	it("falls back to remaining project when removing the active project", async () => {
		const { path: tempHome, cleanup: cleanupHome } = createTempDir("kanbanana-home-remove-");
		const { path: tempRoot, cleanup: cleanupRoot } = createTempDir("kanbanana-projects-remove-");

		const projectAPath = join(tempRoot, "project-a");
		const projectBPath = join(tempRoot, "project-b");
		mkdirSync(projectAPath, { recursive: true });
		mkdirSync(projectBPath, { recursive: true });
		initGitRepository(projectAPath);
		initGitRepository(projectBPath);

		const port = await getAvailablePort();
		const server = await startKanbananaServer({
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
