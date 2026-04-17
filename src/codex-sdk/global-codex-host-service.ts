import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export type CodexApprovalMode = "approve" | "deny";

export type CodexHostNotification =
	| {
			method: "item/agentMessage/delta";
			threadId: string;
			turnId: string;
			delta: string;
	  }
	| {
			method: "turn/started";
			threadId: string;
			turnId: string;
	  }
	| {
			method: "turn/completed";
			threadId: string;
			turnId: string;
			status: "completed" | "interrupted" | "failed" | "inProgress";
			errorMessage: string | null;
	  }
	| {
			method: "host/exited";
			threadId: string;
			message: string;
	  };

type CodexTurnStatus = "completed" | "interrupted" | "failed" | "inProgress";

export interface StartCodexThreadRequest {
	cwd: string;
	developerInstructions?: string;
	approvalMode: CodexApprovalMode;
	autonomousModeEnabled: boolean;
}

export interface StartCodexTurnRequest {
	threadId: string;
	prompt: string;
	cwd?: string;
}

export interface ResumeCodexThreadRequest {
	threadId: string;
	cwd: string;
	developerInstructions?: string;
	approvalMode: CodexApprovalMode;
	autonomousModeEnabled: boolean;
}

export interface CodexHostService {
	getPid(): number | null;
	start(): Promise<void>;
	dispose(): Promise<void>;
	subscribe(threadId: string, listener: (notification: CodexHostNotification) => void): () => void;
	releaseThread(threadId: string): void;
	startThread(request: StartCodexThreadRequest): Promise<{ threadId: string; cwd: string }>;
	resumeThread(request: ResumeCodexThreadRequest): Promise<{ threadId: string; cwd: string }>;
	startTurn(request: StartCodexTurnRequest): Promise<{ turnId: string }>;
	interruptTurn(threadId: string, turnId: string): Promise<void>;
}

interface JsonRpcErrorShape {
	code?: number;
	message?: string;
	data?: unknown;
}

interface PendingRequest {
	resolve: (result: unknown) => void;
	reject: (error: Error) => void;
}

interface ThreadContext {
	approvalMode: CodexApprovalMode;
}

interface JsonRpcMessage {
	id?: string | number | null;
	method?: string;
	params?: Record<string, unknown>;
	result?: unknown;
	error?: JsonRpcErrorShape;
}

function createThreadInput(prompt: string): Array<{ type: "text"; text: string; text_elements: [] }> {
	return [
		{
			type: "text",
			text: prompt,
			text_elements: [],
		},
	];
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function extractThreadId(params: Record<string, unknown> | null): string | null {
	const directThreadId = readString(params?.threadId);
	if (directThreadId) {
		return directThreadId;
	}
	const thread = asRecord(params?.thread);
	return readString(thread?.id);
}

function extractTurnId(params: Record<string, unknown> | null): string | null {
	const directTurnId = readString(params?.turnId);
	if (directTurnId) {
		return directTurnId;
	}
	const turn = asRecord(params?.turn);
	return readString(turn?.id);
}

function buildJsonRpcError(message: string, code = -32603): Error {
	return new Error(message, { cause: { code } });
}

function buildThreadLifecycleParams(input: {
	cwd: string;
	developerInstructions?: string;
	autonomousModeEnabled: boolean;
}): Record<string, unknown> {
	return {
		cwd: input.cwd,
		approvalPolicy: input.autonomousModeEnabled ? "never" : undefined,
		sandbox: input.autonomousModeEnabled ? "danger-full-access" : undefined,
		developerInstructions: input.developerInstructions ?? undefined,
	};
}

export class GlobalCodexHostService implements CodexHostService {
	private process: ChildProcessWithoutNullStreams | null = null;
	private stdoutReader: Interface | null = null;
	private stderrReader: Interface | null = null;
	private startPromise: Promise<void> | null = null;
	private nextRequestId = 1;
	private readonly pendingRequests = new Map<string, PendingRequest>();
	private readonly listenersByThreadId = new Map<string, Set<(notification: CodexHostNotification) => void>>();
	private readonly threadContexts = new Map<string, ThreadContext>();
	private readonly stderrTail: string[] = [];

	constructor(
		private readonly options: {
			binary?: string;
			args?: string[];
		} = {},
	) {}

	getPid(): number | null {
		return this.process?.pid ?? null;
	}

	async start(): Promise<void> {
		if (this.process && this.process.exitCode === null && !this.process.killed) {
			return;
		}
		if (this.startPromise) {
			return await this.startPromise;
		}
		this.startPromise = this.startInternal().finally(() => {
			this.startPromise = null;
		});
		return await this.startPromise;
	}

	async dispose(): Promise<void> {
		const process = this.process;
		this.process = null;
		this.stdoutReader?.close();
		this.stdoutReader = null;
		this.stderrReader?.close();
		this.stderrReader = null;
		for (const [requestId, pending] of this.pendingRequests.entries()) {
			this.pendingRequests.delete(requestId);
			pending.reject(new Error("Codex app-server stopped before replying."));
		}
		if (!process) {
			return;
		}
		process.stdin.end();
		await new Promise<void>((resolve) => {
			process.once("exit", () => {
				resolve();
			});
			process.kill("SIGTERM");
			setTimeout(() => {
				if (process.exitCode === null && !process.killed) {
					process.kill("SIGKILL");
				}
			}, 1_000).unref();
		});
	}

	subscribe(threadId: string, listener: (notification: CodexHostNotification) => void): () => void {
		const listeners =
			this.listenersByThreadId.get(threadId) ?? new Set<(notification: CodexHostNotification) => void>();
		listeners.add(listener);
		this.listenersByThreadId.set(threadId, listeners);
		return () => {
			const existing = this.listenersByThreadId.get(threadId);
			if (!existing) {
				return;
			}
			existing.delete(listener);
			if (existing.size === 0) {
				this.listenersByThreadId.delete(threadId);
			}
		};
	}

	releaseThread(threadId: string): void {
		this.threadContexts.delete(threadId);
		this.listenersByThreadId.delete(threadId);
	}

	async startThread(request: StartCodexThreadRequest): Promise<{ threadId: string; cwd: string }> {
		await this.start();
		const result = await this.parseThreadLifecycleResponse(
			await this.request("thread/start", {
				...buildThreadLifecycleParams(request),
				persistExtendedHistory: true,
			}),
			request.cwd,
			"thread/start",
		);
		const threadId = result.threadId;
		this.threadContexts.set(threadId, {
			approvalMode: request.approvalMode,
		});
		return result;
	}

	async resumeThread(request: ResumeCodexThreadRequest): Promise<{ threadId: string; cwd: string }> {
		await this.start();
		const result = await this.parseThreadLifecycleResponse(
			await this.request("thread/resume", {
				threadId: request.threadId,
				...buildThreadLifecycleParams(request),
			}),
			request.cwd,
			"thread/resume",
		);
		this.threadContexts.set(result.threadId, {
			approvalMode: request.approvalMode,
		});
		return result;
	}

	async startTurn(request: StartCodexTurnRequest): Promise<{ turnId: string }> {
		await this.start();
		const result = asRecord(
			await this.request("turn/start", {
				threadId: request.threadId,
				cwd: request.cwd ?? undefined,
				input: createThreadInput(request.prompt),
			}),
		);
		const turn = asRecord(result?.turn);
		const turnId = readString(turn?.id);
		if (!turnId) {
			throw new Error("Codex app-server returned a turn/start response without a turn id.");
		}
		return { turnId };
	}

	async interruptTurn(threadId: string, turnId: string): Promise<void> {
		await this.start();
		await this.request("turn/interrupt", {
			threadId,
			turnId,
		});
	}

	private async startInternal(): Promise<void> {
		const binary = this.options.binary ?? "codex";
		const args = this.options.args ?? [
			"app-server",
			"--listen",
			"stdio://",
			"-c",
			"check_for_update_on_startup=false",
		];
		const child = spawn(binary, args, {
			cwd: globalThis.process.cwd(),
			env: globalThis.process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = child;
		this.stderrTail.length = 0;
		this.stdoutReader = createInterface({ input: child.stdout });
		this.stderrReader = createInterface({ input: child.stderr });
		this.stdoutReader.on("line", (line) => {
			this.handleStdoutLine(line);
		});
		this.stderrReader.on("line", (line) => {
			this.stderrTail.push(line);
			if (this.stderrTail.length > 50) {
				this.stderrTail.shift();
			}
		});
		child.once("exit", (code, signal) => {
			const message = `Codex app-server exited${code !== null ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`;
			const threadIds = Array.from(this.listenersByThreadId.keys());
			for (const [requestId, pending] of this.pendingRequests.entries()) {
				this.pendingRequests.delete(requestId);
				pending.reject(new Error(`${message} stderr_tail=${this.stderrTail.slice(-10).join("\n")}`));
			}
			this.process = null;
			this.stdoutReader?.close();
			this.stdoutReader = null;
			this.stderrReader?.close();
			this.stderrReader = null;
			for (const threadId of threadIds) {
				this.dispatchNotification({
					method: "host/exited",
					threadId,
					message,
				});
			}
		});
		await this.requestReady("initialize", {
			clientInfo: {
				name: "kanban",
				title: "Kanban",
				version: "0.0.0",
			},
			capabilities: {
				experimentalApi: true,
			},
		});
		this.notify("initialized", {});
	}

	private async parseThreadLifecycleResponse(
		payload: unknown,
		fallbackCwd: string,
		method: "thread/start" | "thread/resume",
	): Promise<{ threadId: string; cwd: string }> {
		const result = asRecord(payload);
		const thread = asRecord(result?.thread);
		const threadId = readString(thread?.id);
		const cwd = readString(result?.cwd) ?? fallbackCwd;
		if (!threadId) {
			throw new Error(`Codex app-server returned a ${method} response without a thread id.`);
		}
		return {
			threadId,
			cwd,
		};
	}

	private handleStdoutLine(line: string): void {
		if (!line.trim()) {
			return;
		}
		let parsed: JsonRpcMessage;
		try {
			parsed = JSON.parse(line) as JsonRpcMessage;
		} catch {
			return;
		}
		if (parsed.method && parsed.id !== undefined) {
			void this.handleServerRequest(parsed);
			return;
		}
		if (parsed.method) {
			this.handleNotification(parsed.method, asRecord(parsed.params));
			return;
		}
		if (parsed.id === undefined) {
			return;
		}
		const requestId = String(parsed.id);
		const pending = this.pendingRequests.get(requestId);
		if (!pending) {
			return;
		}
		this.pendingRequests.delete(requestId);
		if (parsed.error) {
			const code = typeof parsed.error.code === "number" ? parsed.error.code : -32603;
			const message = readString(parsed.error.message) ?? "Codex app-server request failed.";
			pending.reject(buildJsonRpcError(message, code));
			return;
		}
		pending.resolve(parsed.result);
	}

	private async handleServerRequest(message: JsonRpcMessage): Promise<void> {
		const process = this.process;
		if (!process?.stdin.writable || !message.method || message.id === undefined) {
			return;
		}
		if (message.method === "execCommandApproval" || message.method === "applyPatchApproval") {
			const conversationId = readString(asRecord(message.params)?.conversationId);
			const approvalMode = conversationId ? this.threadContexts.get(conversationId)?.approvalMode : null;
			const decision = approvalMode === "approve" ? "approved" : "denied";
			this.writeMessage({
				id: message.id,
				result: {
					decision,
				},
			});
			return;
		}
		this.writeMessage({
			id: message.id,
			error: {
				code: -32601,
				message: `Unsupported Codex app-server request: ${message.method}`,
			},
		});
	}

	private handleNotification(method: string, params: Record<string, unknown> | null): void {
		const threadId = extractThreadId(params);
		if (!threadId) {
			return;
		}
		if (method === "item/agentMessage/delta") {
			const turnId = extractTurnId(params);
			const delta = readString(params?.delta);
			if (!turnId || delta === null) {
				return;
			}
			this.dispatchNotification({
				method,
				threadId,
				turnId,
				delta,
			});
			return;
		}
		if (method === "turn/started") {
			const turnId = extractTurnId(params);
			if (!turnId) {
				return;
			}
			this.dispatchNotification({
				method,
				threadId,
				turnId,
			});
			return;
		}
		if (method === "turn/completed") {
			const turn = asRecord(params?.turn);
			const turnId = readString(turn?.id);
			const rawStatus = readString(turn?.status);
			const error = asRecord(turn?.error);
			const status =
				rawStatus === "completed" ||
				rawStatus === "interrupted" ||
				rawStatus === "failed" ||
				rawStatus === "inProgress"
					? (rawStatus as CodexTurnStatus)
					: null;
			if (!turnId || status === null) {
				return;
			}
			this.dispatchNotification({
				method,
				threadId,
				turnId,
				status,
				errorMessage: readString(error?.message),
			});
		}
	}

	private dispatchNotification(notification: CodexHostNotification): void {
		const listeners = this.listenersByThreadId.get(notification.threadId);
		if (!listeners || listeners.size === 0) {
			return;
		}
		for (const listener of listeners) {
			listener(notification);
		}
	}

	private async request(method: string, params: Record<string, unknown>): Promise<unknown> {
		await this.start();
		return await this.requestReady(method, params);
	}

	private async requestReady(method: string, params: Record<string, unknown>): Promise<unknown> {
		const process = this.process;
		if (!process?.stdin.writable) {
			throw new Error("Codex app-server is not running.");
		}
		const requestId = String(this.nextRequestId++);
		const promise = new Promise<unknown>((resolve, reject) => {
			this.pendingRequests.set(requestId, { resolve, reject });
		});
		this.writeMessage({
			id: requestId,
			method,
			params,
		});
		return await promise;
	}

	private notify(method: string, params: Record<string, unknown>): void {
		this.writeMessage({
			method,
			params,
		});
	}

	private writeMessage(message: Record<string, unknown>): void {
		const process = this.process;
		if (!process?.stdin.writable) {
			throw new Error("Codex app-server is not running.");
		}
		process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
	}
}
