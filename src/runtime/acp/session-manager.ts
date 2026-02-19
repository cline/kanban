import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";

import {
	type AvailableCommand,
	type Client,
	ClientSideConnection,
	type ContentBlock,
	ndJsonStream,
	type PermissionOption,
	PROTOCOL_VERSION,
	RequestError,
	type RequestPermissionRequest,
	type RequestPermissionResponse,
	type SessionNotification,
	type ToolCallContent,
	type ToolCallLocation,
} from "@agentclientprotocol/sdk";

import type {
	RuntimeAcpTurnResponse,
	RuntimeAcpTurnStatus,
	RuntimeAvailableCommand,
	RuntimePermissionOption,
	RuntimeTimelineEntry,
	RuntimeToolCall,
	RuntimeToolCallContent,
	RuntimeToolCallLocation,
	RuntimeToolKind,
} from "./api-contract.js";

const TURN_TIMEOUT_MS = 5 * 60_000;
const SESSION_SHUTDOWN_TIMEOUT_MS = 5_000;
const SESSION_INIT_TIMEOUT_MS = 20_000;

interface RunTurnRequest {
	taskId: string;
	prompt: string;
}

interface TurnStreamListeners {
	onEntry?: (entry: RuntimeTimelineEntry) => void;
	onStatus?: (status: RuntimeAcpTurnStatus) => void;
	onAvailableCommands?: (commands: RuntimeAvailableCommand[]) => void;
}

interface AcpTaskSessionCreateOptions {
	taskId: string;
	commandLine: string;
	cwd: string;
	onClosed: () => void;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeoutHandle = setTimeout(() => {
					reject(new Error(`${label} timed out after ${ms}ms`));
				}, ms);
			}),
		]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

function toRuntimeToolKind(kind: string | null | undefined): RuntimeToolKind {
	if (
		kind === "read" ||
		kind === "edit" ||
		kind === "delete" ||
		kind === "move" ||
		kind === "search" ||
		kind === "execute" ||
		kind === "think" ||
		kind === "fetch" ||
		kind === "switch_mode"
	) {
		return kind;
	}
	return "other";
}

function toRuntimeLocations(locations: ToolCallLocation[] | null | undefined): RuntimeToolCallLocation[] | undefined {
	if (!locations || locations.length === 0) {
		return undefined;
	}
	return locations.map((location) => ({
		path: location.path,
		line: typeof location.line === "number" ? location.line : undefined,
	}));
}

function textFromContentBlock(block: ContentBlock): string {
	if (block.type === "text") {
		return block.text;
	}
	return "";
}

function toRuntimeToolContents(content: ToolCallContent[] | null | undefined): RuntimeToolCallContent[] | undefined {
	if (!content || content.length === 0) {
		return undefined;
	}

	const mapped: RuntimeToolCallContent[] = [];
	for (const item of content) {
		if (item.type === "diff") {
			mapped.push({
				type: "diff",
				path: item.path,
				oldText: item.oldText ?? null,
				newText: item.newText,
			});
			continue;
		}

		if (item.type === "content" && item.content.type === "text") {
			mapped.push({
				type: "content",
				content: {
					type: "text",
					text: item.content.text,
				},
			});
		}
	}

	return mapped.length > 0 ? mapped : undefined;
}

function toPermissionOptions(options: PermissionOption[]): RuntimePermissionOption[] {
	return options.map((option) => ({
		optionId: option.optionId,
		name: option.name,
		kind: option.kind,
	}));
}

function appendOrUpdateEntry(entries: RuntimeTimelineEntry[], nextEntry: RuntimeTimelineEntry): void {
	const existingIndex = entries.findIndex((entry) => entry.id === nextEntry.id);
	if (existingIndex === -1) {
		entries.push(nextEntry);
		return;
	}
	entries[existingIndex] = nextEntry;
}

function extractHint(command: AvailableCommand): string | undefined {
	if (!command.input || typeof command.input !== "object") {
		return undefined;
	}
	const maybeHint = (command.input as { hint?: unknown }).hint;
	return typeof maybeHint === "string" ? maybeHint : undefined;
}

function mapAvailableCommands(commands: AvailableCommand[]): RuntimeAvailableCommand[] {
	return commands.map((command) => ({
		name: command.name,
		description: command.description,
		input: command.input
			? {
					hint: extractHint(command),
				}
			: undefined,
	}));
}

class TurnCollector {
	private readonly turnId = randomUUID();
	private readonly entries: RuntimeTimelineEntry[];
	private readonly listeners?: TurnStreamListeners;
	private readonly messageState = {
		agent: {
			activeId: null as string | null,
			text: "",
			sequence: 0,
		},
		thought: {
			activeId: null as string | null,
			text: "",
			sequence: 0,
		},
	};
	private availableCommands: RuntimeAvailableCommand[] | undefined;

	constructor(prompt: string, listeners?: TurnStreamListeners) {
		this.listeners = listeners;
		const now = Date.now();
		const userEntry: RuntimeTimelineEntry = {
			type: "user_message",
			id: `turn-${this.turnId}-user`,
			timestamp: now,
			text: prompt,
		};
		this.entries = [userEntry];
		this.listeners?.onEntry?.(userEntry);
		this.listeners?.onStatus?.("thinking");
	}

	private upsertEntry(entry: RuntimeTimelineEntry): void {
		appendOrUpdateEntry(this.entries, entry);
		this.listeners?.onEntry?.(entry);
	}

	private closeAgentMessage(): void {
		if (!this.messageState.agent.activeId) {
			return;
		}
		const activeId = this.messageState.agent.activeId;
		const activeEntry = this.entries.find(
			(entry): entry is Extract<RuntimeTimelineEntry, { type: "agent_message" }> =>
				entry.type === "agent_message" && entry.id === activeId,
		);
		if (activeEntry?.isStreaming) {
			this.upsertEntry({
				...activeEntry,
				isStreaming: false,
			});
		}
		this.messageState.agent.activeId = null;
		this.messageState.agent.text = "";
	}

	private closeThoughtMessage(): void {
		if (!this.messageState.thought.activeId) {
			return;
		}
		const activeId = this.messageState.thought.activeId;
		const activeEntry = this.entries.find(
			(entry): entry is Extract<RuntimeTimelineEntry, { type: "agent_thought" }> =>
				entry.type === "agent_thought" && entry.id === activeId,
		);
		if (activeEntry?.isStreaming) {
			this.upsertEntry({
				...activeEntry,
				isStreaming: false,
			});
		}
		this.messageState.thought.activeId = null;
		this.messageState.thought.text = "";
	}

	private closeStreamingMessages(options?: { keep?: "agent" | "thought" }): void {
		if (options?.keep !== "agent") {
			this.closeAgentMessage();
		}
		if (options?.keep !== "thought") {
			this.closeThoughtMessage();
		}
	}

	finalizeStreaming(): void {
		this.closeStreamingMessages();

		for (const entry of this.entries) {
			if ((entry.type === "agent_message" || entry.type === "agent_thought") && entry.isStreaming) {
				const finalized = {
					...entry,
					isStreaming: false,
				};
				appendOrUpdateEntry(this.entries, finalized);
				this.listeners?.onEntry?.(finalized);
			}
		}
	}

	async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		this.closeStreamingMessages();

		const selected = request.options[0];
		const permissionEntry: RuntimeTimelineEntry = {
			type: "permission_request",
			id: `turn-${this.turnId}-permission-${request.toolCall.toolCallId}`,
			timestamp: Date.now(),
			request: {
				toolCallId: request.toolCall.toolCallId,
				toolCallTitle: request.toolCall.title ?? "Permission request",
				options: toPermissionOptions(request.options),
			},
			resolved: true,
			selectedOptionId: selected?.optionId,
		};
		this.upsertEntry(permissionEntry);

		if (!selected) {
			return {
				outcome: {
					outcome: "cancelled",
				},
			};
		}

		return {
			outcome: {
				outcome: "selected",
				optionId: selected.optionId,
			},
		};
	}

	async onSessionUpdate(notification: SessionNotification): Promise<void> {
		const update = notification.update;
		const timestamp = Date.now();

		switch (update.sessionUpdate) {
			case "agent_message_chunk": {
				this.closeStreamingMessages({ keep: "agent" });
				if (!this.messageState.agent.activeId) {
					this.messageState.agent.sequence += 1;
					this.messageState.agent.activeId = `turn-${this.turnId}-agent-message-${this.messageState.agent.sequence}`;
					this.messageState.agent.text = "";
				}
				this.messageState.agent.text += textFromContentBlock(update.content);
				this.listeners?.onStatus?.("thinking");
				this.upsertEntry({
					type: "agent_message",
					id: this.messageState.agent.activeId,
					timestamp,
					text: this.messageState.agent.text,
					isStreaming: true,
				});
				break;
			}
			case "agent_thought_chunk": {
				this.closeStreamingMessages({ keep: "thought" });
				if (!this.messageState.thought.activeId) {
					this.messageState.thought.sequence += 1;
					this.messageState.thought.activeId = `turn-${this.turnId}-agent-thought-${this.messageState.thought.sequence}`;
					this.messageState.thought.text = "";
				}
				this.messageState.thought.text += textFromContentBlock(update.content);
				this.listeners?.onStatus?.("thinking");
				this.upsertEntry({
					type: "agent_thought",
					id: this.messageState.thought.activeId,
					timestamp,
					text: this.messageState.thought.text,
					isStreaming: true,
				});
				break;
			}
			case "tool_call":
			case "tool_call_update": {
				this.closeStreamingMessages();
				const existing = this.entries.find(
					(entry): entry is Extract<RuntimeTimelineEntry, { type: "tool_call" }> =>
						entry.type === "tool_call" && entry.toolCall.toolCallId === update.toolCallId,
				);
				const toolCall: RuntimeToolCall = {
					toolCallId: update.toolCallId,
					title: update.title ?? existing?.toolCall.title ?? "Tool call",
					kind: toRuntimeToolKind(update.kind ?? existing?.toolCall.kind),
					status: update.status ?? existing?.toolCall.status ?? "pending",
					locations: update.locations ? toRuntimeLocations(update.locations) : existing?.toolCall.locations,
					content: update.content ? toRuntimeToolContents(update.content) : existing?.toolCall.content,
				};
				this.listeners?.onStatus?.(toolCall.status === "in_progress" ? "tool_running" : "thinking");
				this.upsertEntry({
					type: "tool_call",
					id: `turn-${this.turnId}-tool-${update.toolCallId}`,
					timestamp,
					toolCall,
				});
				break;
			}
			case "plan": {
				this.closeStreamingMessages();
				this.listeners?.onStatus?.("thinking");
				this.upsertEntry({
					type: "plan",
					id: `turn-${this.turnId}-plan`,
					timestamp,
					entries: update.entries.map((entry) => ({
						content: entry.content,
						status: entry.status,
						priority: entry.priority,
					})),
				});
				break;
			}
			case "available_commands_update": {
				this.availableCommands = mapAvailableCommands(update.availableCommands);
				this.listeners?.onAvailableCommands?.(this.availableCommands);
				break;
			}
			default:
				break;
		}
	}

	toResponse(stopReason: string): RuntimeAcpTurnResponse {
		return {
			entries: this.entries,
			stopReason,
			availableCommands: this.availableCommands,
		};
	}
}

class RuntimeClientProxy implements Client {
	private requestPermissionHandler: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse> = async (
		request,
	) => {
		const selected = request.options[0];
		if (!selected) {
			return {
				outcome: {
					outcome: "cancelled",
				},
			};
		}
		return {
			outcome: {
				outcome: "selected",
				optionId: selected.optionId,
			},
		};
	};

	private sessionUpdateHandler: (notification: SessionNotification) => Promise<void> = async () => {};

	setHandlers(handlers: {
		requestPermission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
		sessionUpdate: (notification: SessionNotification) => Promise<void>;
	}): void {
		this.requestPermissionHandler = handlers.requestPermission;
		this.sessionUpdateHandler = handlers.sessionUpdate;
	}

	clearHandlers(): void {
		this.requestPermissionHandler = async (request) => {
			const selected = request.options[0];
			if (!selected) {
				return {
					outcome: {
						outcome: "cancelled",
					},
				};
			}
			return {
				outcome: {
					outcome: "selected",
					optionId: selected.optionId,
				},
			};
		};
		this.sessionUpdateHandler = async () => {};
	}

	async requestPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
		return this.requestPermissionHandler(request);
	}

	async sessionUpdate(notification: SessionNotification): Promise<void> {
		await this.sessionUpdateHandler(notification);
	}

	async readTextFile(params: { path: string }): Promise<{ content: string }> {
		const content = await readFile(params.path, "utf8");
		return { content };
	}

	async writeTextFile(params: { path: string; content: string }): Promise<Record<string, never>> {
		await writeFile(params.path, params.content, "utf8");
		return {};
	}
}

function isAuthRequiredError(error: unknown): boolean {
	if (error instanceof RequestError && error.code === -32000) {
		return true;
	}
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as { code?: unknown }).code === -32000
	) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	return /auth.?required/i.test(message);
}

class AcpTaskSession {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly connection: ClientSideConnection;
	private readonly clientProxy: RuntimeClientProxy;
	private readonly acpSessionId: string;
	private readonly closePromise: Promise<void>;
	private readonly commandLine: string;
	private readonly taskId: string;
	private disposed = false;
	private inFlightTurn: Promise<RuntimeAcpTurnResponse> | null = null;
	private stderrBuffer = "";

	private constructor(options: {
		taskId: string;
		commandLine: string;
		child: ChildProcessWithoutNullStreams;
		connection: ClientSideConnection;
		clientProxy: RuntimeClientProxy;
		sessionId: string;
		onClosed: () => void;
	}) {
		this.taskId = options.taskId;
		this.commandLine = options.commandLine;
		this.child = options.child;
		this.connection = options.connection;
		this.clientProxy = options.clientProxy;
		this.acpSessionId = options.sessionId;
		this.closePromise = once(this.child, "close").then(() => {
			this.disposed = true;
			options.onClosed();
		});
	}

	static async create(options: AcpTaskSessionCreateOptions): Promise<AcpTaskSession> {
		const child = spawn(options.commandLine, {
			cwd: options.cwd,
			shell: true,
			stdio: ["pipe", "pipe", "pipe"],
			env: process.env,
		});

		if (!child.stdout || !child.stdin || !child.stderr) {
			child.kill("SIGTERM");
			throw new Error("ACP command did not expose stdio pipes.");
		}

		const clientProxy = new RuntimeClientProxy();
		let stderrBuffer = "";
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderrBuffer += String(chunk);
		});
		const stream = ndJsonStream(
			Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
			Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
		);
		const connection = new ClientSideConnection(() => clientProxy, stream);

		let session: string;
		try {
			session = await (async () => {
				const initializeResponse = await withTimeout(
					connection.initialize({
						protocolVersion: PROTOCOL_VERSION,
						clientInfo: {
							name: "kanbanana",
							version: "0.1.0",
							title: "Kanbanana",
						},
						clientCapabilities: {
							fs: {
								readTextFile: true,
								writeTextFile: true,
							},
						},
					}),
					SESSION_INIT_TIMEOUT_MS,
					"ACP initialize",
				);

				let sessionId: string;
				try {
					const newSession = await withTimeout(
						connection.newSession({
							cwd: options.cwd,
							mcpServers: [],
						}),
						SESSION_INIT_TIMEOUT_MS,
						"ACP session/new",
					);
					sessionId = newSession.sessionId;
				} catch (error) {
					if (!isAuthRequiredError(error)) {
						throw error;
					}

					const method = initializeResponse.authMethods?.[0];
					if (!method) {
						throw new Error("ACP provider requires authentication but did not expose an auth method.");
					}
					await withTimeout(
						connection.authenticate({ methodId: method.id }),
						SESSION_INIT_TIMEOUT_MS,
						"ACP authenticate",
					);
					const newSession = await withTimeout(
						connection.newSession({
							cwd: options.cwd,
							mcpServers: [],
						}),
						SESSION_INIT_TIMEOUT_MS,
						"ACP session/new",
					);
					sessionId = newSession.sessionId;
				}

				return sessionId;
			})();
		} catch (error) {
			child.kill("SIGTERM");
			const message = error instanceof Error ? error.message : String(error);
			const stderr = stderrBuffer.trim();
			const context =
				`Failed to initialize ACP session for task ${options.taskId}. ` +
				"Verify the configured command starts the agent in ACP mode (for example: npx @zed-industries/codex-acp@latest).";
			throw new Error(stderr ? `${context}\n${message}\n${stderr}` : `${context}\n${message}`);
		}

		const created = new AcpTaskSession({
			taskId: options.taskId,
			commandLine: options.commandLine,
			child,
			connection,
			clientProxy,
			sessionId: session,
			onClosed: options.onClosed,
		});
		created.clientProxy.setHandlers({
			requestPermission: async (request) => {
				const selected = request.options[0];
				if (!selected) {
					return {
						outcome: {
							outcome: "cancelled",
						},
					};
				}
				return {
					outcome: {
						outcome: "selected",
						optionId: selected.optionId,
					},
				};
			},
			sessionUpdate: async () => {},
		});
		created.stderrBuffer = stderrBuffer;
		child.stderr.on("data", (chunk: Buffer | string) => {
			created.stderrBuffer += String(chunk);
		});

		return created;
	}

	getCommandLine(): string {
		return this.commandLine;
	}

	isDisposed(): boolean {
		return this.disposed;
	}

	async runTurn(request: RunTurnRequest, listeners?: TurnStreamListeners): Promise<RuntimeAcpTurnResponse> {
		if (this.disposed) {
			throw new Error(`ACP session for task ${request.taskId} is no longer available.`);
		}
		if (this.inFlightTurn) {
			throw new Error(`Task ${this.taskId} already has an active ACP turn.`);
		}

		const collector = new TurnCollector(request.prompt, listeners);
		this.clientProxy.setHandlers({
			requestPermission: async (permissionRequest) => collector.requestPermission(permissionRequest),
			sessionUpdate: async (notification) => collector.onSessionUpdate(notification),
		});

		this.inFlightTurn = (async () => {
			const timeout = setTimeout(() => {
				void this.connection.cancel({ sessionId: this.acpSessionId });
			}, TURN_TIMEOUT_MS);

			try {
				const promptResponse = await this.connection.prompt({
					sessionId: this.acpSessionId,
					prompt: [
						{
							type: "text",
							text: request.prompt,
						},
					],
				});
				collector.finalizeStreaming();
				listeners?.onStatus?.("idle");
				return collector.toResponse(promptResponse.stopReason);
			} catch (error) {
				collector.finalizeStreaming();
				listeners?.onStatus?.("idle");
				const message = error instanceof Error ? error.message : String(error);
				const stderr = this.stderrBuffer.trim();
				throw new Error(stderr ? `${message}\n${stderr}` : message);
			} finally {
				clearTimeout(timeout);
				this.clientProxy.clearHandlers();
			}
		})();

		try {
			return await this.inFlightTurn;
		} finally {
			this.inFlightTurn = null;
		}
	}

	async cancelTurn(): Promise<void> {
		if (this.disposed || !this.inFlightTurn) {
			return;
		}
		await this.connection.cancel({ sessionId: this.acpSessionId });
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;

		try {
			await this.cancelTurn();
		} catch {
			// ignore cancellation errors during shutdown
		}

		this.child.kill("SIGTERM");
		const exited = await Promise.race([
			this.closePromise.then(() => true),
			new Promise<boolean>((resolve) => {
				setTimeout(() => resolve(false), SESSION_SHUTDOWN_TIMEOUT_MS);
			}),
		]);
		if (!exited) {
			this.child.kill("SIGKILL");
			await this.closePromise.catch(() => undefined);
		}
	}
}

export class AcpRuntimeSessionManager {
	private readonly sessions = new Map<string, AcpTaskSession>();

	async runTurn(options: {
		commandLine: string;
		cwd: string;
		request: RunTurnRequest;
		listeners?: TurnStreamListeners;
	}): Promise<RuntimeAcpTurnResponse> {
		const session = await this.getOrCreateSession(options.commandLine, options.cwd, options.request.taskId);
		try {
			return await session.runTurn(options.request, options.listeners);
		} catch (error) {
			if (session.isDisposed()) {
				this.sessions.delete(options.request.taskId);
			}
			throw error;
		}
	}

	async cancelTask(taskId: string): Promise<boolean> {
		const session = this.sessions.get(taskId);
		if (!session) {
			return false;
		}
		await session.cancelTurn();
		return true;
	}

	async disposeAll(): Promise<void> {
		const sessionEntries = Array.from(this.sessions.entries());
		this.sessions.clear();
		for (const [, session] of sessionEntries) {
			await session.dispose();
		}
	}

	private async getOrCreateSession(commandLine: string, cwd: string, taskId: string): Promise<AcpTaskSession> {
		const existing = this.sessions.get(taskId);
		if (existing && !existing.isDisposed() && existing.getCommandLine() === commandLine) {
			return existing;
		}

		if (existing) {
			await existing.dispose();
			this.sessions.delete(taskId);
		}

		const created = await AcpTaskSession.create({
			taskId,
			commandLine,
			cwd,
			onClosed: () => {
				const active = this.sessions.get(taskId);
				if (active === created) {
					this.sessions.delete(taskId);
				}
			},
		});
		this.sessions.set(taskId, created);
		return created;
	}
}
