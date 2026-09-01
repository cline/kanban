// biome-ignore-all lint/style/noNonNullAssertion: ACP session maps are checked before !
import type { RuntimeTaskImage } from "../core/api-contract";
import { PrimeAcpConnectionManager } from "./acp-connection-manager";
import type { PrimeAcpMessageRepository } from "./acp-message-repository";
import {
	appendAssistantChunk,
	appendReasoningChunk,
	appendUserChunk,
	clearActiveTurnState,
	createSessionEntry,
	now,
	updateSummary,
	upsertToolCall,
} from "./acp-session-state";
export interface StartPrimeAcpSessionRequest {
	taskId: string;
	cwd: string;
	prompt: string;
	images?: RuntimeTaskImage[];
}
export interface PrimeAcpSessionRuntime {
	startTaskSession(request: StartPrimeAcpSessionRequest): Promise<{ sessionId: string }>;
	sendTaskSessionInput(taskId: string, text: string, images?: RuntimeTaskImage[]): Promise<void>;
	cancelTaskSession(taskId: string): Promise<void>;
	stopTaskSession(taskId: string): Promise<void>;
	getSessionId(taskId: string): string | null;
	dispose(): Promise<void>;
}
export interface CreatePrimeAcpSessionRuntimeOptions {
	connectionManager?: PrimeAcpConnectionManager;
	messageRepository?: PrimeAcpMessageRepository;
	onSummary?: (summary: any) => void;
	onMessage?: (taskId: string, message: any) => void;
}
export class InMemoryPrimeAcpSessionRuntime implements PrimeAcpSessionRuntime {
	private readonly connectionManager: PrimeAcpConnectionManager;
	private readonly repo: PrimeAcpMessageRepository | null;
	private readonly onSummary: ((summary: any) => void) | null;
	private readonly onMessage: ((taskId: string, message: any) => void) | null;
	private readonly sessionIdByTaskId = new Map<string, string>();
	private readonly taskIdBySessionId = new Map<string, string>();
	private readonly pendingPromptByTaskId = new Map<string, Promise<any>>();
	constructor(options: CreatePrimeAcpSessionRuntimeOptions = {}) {
		this.repo = options.messageRepository ?? null;
		this.onSummary = options.onSummary ?? null;
		this.onMessage = options.onMessage ?? null;
		const baseManager =
			options.connectionManager ??
			new PrimeAcpConnectionManager({ onSessionUpdate: (params) => this.handleSessionUpdate(params) });
		if (options.connectionManager && !options.onSummary && !options.onMessage) {
			(baseManager as any).onSessionUpdate = (params: any) => this.handleSessionUpdate(params);
		}
		this.connectionManager = baseManager;
		if ((this.connectionManager as any).onSessionUpdate) {
			const orig = (this.connectionManager as any).onSessionUpdate;
			if (orig.length === 0 || orig.toString().includes("() =>")) {
				(this.connectionManager as any).onSessionUpdate = (p: any) => this.handleSessionUpdate(p);
			}
		} else {
			(this.connectionManager as any).onSessionUpdate = (p: any) => this.handleSessionUpdate(p);
		}
	}
	private getRepoEntry(taskId: string) {
		if (!this.repo) return null;
		let entry = this.repo.getTaskEntry(taskId);
		if (!entry) {
			entry = createSessionEntry(taskId);
			this.repo.setTaskEntry(taskId, entry);
		}
		return entry;
	}
	private async handleSessionUpdate(params: { sessionId: string; update: any }): Promise<void> {
		const sessionId = params.sessionId;
		const update = params.update;
		const taskId = this.taskIdBySessionId.get(sessionId);
		if (!taskId) return;
		const entry = this.getRepoEntry(taskId);
		if (!entry && !this.repo) return;
		const sessionUpdateType = update.sessionUpdate ?? update.session_update ?? update.type;
		const type = sessionUpdateType ?? "unknown";
		let message: any = null;
		if (type === "agent_message_chunk") {
			const text = update.content?.text ?? update.content?.content ?? update.text ?? "";
			if (text && entry) message = appendAssistantChunk(entry, taskId, String(text));
		} else if (type === "agent_thought_chunk") {
			const text = update.content?.text ?? update.text ?? "";
			if (text && entry) message = appendReasoningChunk(entry, taskId, String(text));
		} else if (type === "user_message_chunk") {
			const text = update.content?.text ?? update.text ?? "";
			if (text && entry) message = appendUserChunk(entry, taskId, String(text));
		} else if (type === "tool_call") {
			const toolCallId = update.toolCallId ?? update.tool_call_id ?? `tool-${now()}`;
			const title = update.title ?? update.rawInput?.name ?? "tool";
			const status = update.status ?? null;
			const content = update.content ?? update.rawInput ?? null;
			const kind = update.kind ?? null;
			if (entry) message = upsertToolCall(entry, taskId, String(toolCallId), String(title), status, content, kind);
		} else if (type === "tool_call_update") {
			const toolCallId = update.toolCallId ?? update.tool_call_id ?? `tool-${now()}`;
			const title = update.title ?? null;
			const status = update.status ?? null;
			const content = update.content ?? update.rawOutput ?? update.rawInput ?? null;
			const kind = update.kind ?? null;
			if (entry) {
				const resolvedTitle = title ? String(title) : "tool";
				message = upsertToolCall(entry, taskId, String(toolCallId), resolvedTitle, status, content, kind);
			}
		} else if (type === "plan") {
			const entries = update.entries ?? [];
			const planText = entries
				.map((e: any) => `- [${e.status ?? "pending"}] ${e.content ?? e.title ?? JSON.stringify(e)}`)
				.join("\n");
			if (planText && entry) message = appendAssistantChunk(entry, taskId, `\n\n**Plan update:**\n${planText}\n`);
		} else if (
			type === "available_commands_update" ||
			type === "current_mode_update" ||
			type === "session_info_update" ||
			type === "config_option_update" ||
			type === "usage_update"
		) {
			return;
		} else {
			const fallbackText = typeof update === "string" ? update : JSON.stringify(update);
			if (entry) {
				const sys = {
					id: `${taskId}-${now()}-${Math.random().toString(36).slice(2, 6)}`,
					role: "status" as const,
					content: fallbackText,
					createdAt: now(),
					meta: { messageKind: type },
				};
				entry?.messages.push(sys as any);
				message = sys;
			}
		}
		if (message) {
			this.repo?.emitMessage(taskId, message);
			this.onMessage?.(taskId, message);
		}
		if (entry) {
			updateSummary(entry, { lastOutputAt: now(), state: "running" as any });
			const summary = entry.summary;
			this.repo?.emitSummary(summary);
			this.onSummary?.(summary);
		}
	}
	async startTaskSession(request: StartPrimeAcpSessionRequest): Promise<{ sessionId: string }> {
		const { taskId, cwd, prompt, images } = request;
		const info = await this.connectionManager.getConnection();
		const connection: any = (info as any).connection;
		const entry = this.getRepoEntry(taskId);
		if (entry) {
			updateSummary(entry, {
				state: "running",
				agentId: "prime",
				workspacePath: cwd,
				startedAt: entry.summary.startedAt ?? now(),
				updatedAt: now(),
			});
			if (prompt.trim().length > 0) {
				const userMsg = {
					id: `${taskId}-${now()}-${Math.random().toString(36).slice(2, 6)}`,
					role: "user" as const,
					content: prompt,
					createdAt: now(),
					images: images && images.length > 0 ? images.map((i) => ({ ...i })) : undefined,
				};
				entry.messages.push(userMsg as any);
				this.repo?.emitMessage(taskId, userMsg as any);
				this.onMessage?.(taskId, userMsg);
			}
			this.repo?.emitSummary(entry.summary);
			this.onSummary?.(entry.summary);
		}
		let sessionId = this.sessionIdByTaskId.get(taskId) ?? null;
		if (!sessionId) {
			const newSessionRes: any = await connection.newSession({ cwd, mcpServers: [] });
			sessionId = newSessionRes.sessionId ?? newSessionRes.session_id ?? `sess-${taskId}-${now()}`;
			this.sessionIdByTaskId.set(taskId, sessionId!);
			this.taskIdBySessionId.set(sessionId!, taskId);
		}
		if (prompt.trim().length > 0 || (images && images.length > 0)) {
			await this.promptInternal(taskId, sessionId!, prompt, images);
		}
		return { sessionId: sessionId! };
	}
	async sendTaskSessionInput(taskId: string, text: string, images?: RuntimeTaskImage[]): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) throw new Error(`No ACP session for task ${taskId}`);
		const entry = this.getRepoEntry(taskId);
		if (entry && text.trim().length > 0) {
			const userMsg = {
				id: `${taskId}-${now()}-${Math.random().toString(36).slice(2, 6)}`,
				role: "user" as const,
				content: text,
				createdAt: now(),
				images: images && images.length > 0 ? images.map((i) => ({ ...i })) : undefined,
			};
			entry.messages.push(userMsg as any);
			this.repo?.emitMessage(taskId, userMsg as any);
			this.onMessage?.(taskId, userMsg);
			updateSummary(entry, { state: "running", lastOutputAt: now() });
			this.repo?.emitSummary(entry.summary);
			this.onSummary?.(entry.summary);
			clearActiveTurnState(entry);
		}
		await this.promptInternal(taskId, sessionId, text, images);
	}
	private async promptInternal(
		taskId: string,
		sessionId: string,
		text: string,
		images?: RuntimeTaskImage[],
	): Promise<void> {
		const existing = this.pendingPromptByTaskId.get(taskId);
		if (existing) {
			try {
				await existing;
			} catch {}
		}
		const entry = this.getRepoEntry(taskId);
		if (entry) clearActiveTurnState(entry);
		const info = await this.connectionManager.getConnection();
		const connection: any = (info as any).connection;
		const contentBlocks: any[] = [];
		if (text.trim().length > 0) contentBlocks.push({ type: "text", text });
		if (images && images.length > 0)
			for (const img of images)
				if (img.data && img.mimeType) contentBlocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
		if (contentBlocks.length === 0) contentBlocks.push({ type: "text", text: "" });
		const promptPromise = (async () => {
			try {
				const res: any = await connection.prompt({ sessionId, prompt: contentBlocks });
				if (entry) {
					const stopReason = res?.stopReason ?? res?.stop_reason ?? "end_turn";
					const isError = stopReason === "cancelled" ? "interrupted" : "idle";
					updateSummary(entry, { state: isError as any, exitCode: null, lastOutputAt: now() });
					clearActiveTurnState(entry);
					this.repo?.emitSummary(entry.summary);
					this.onSummary?.(entry.summary);
				}
			} catch (e) {
				if (entry) {
					const msg = e instanceof Error ? e.message : String(e);
					updateSummary(entry, { state: "failed", warningMessage: msg } as any);
					this.repo?.emitSummary(entry.summary);
					this.onSummary?.(entry.summary);
				}
				throw e;
			} finally {
				this.pendingPromptByTaskId.delete(taskId);
			}
		})();
		this.pendingPromptByTaskId.set(taskId, promptPromise);
		await promptPromise;
	}
	async cancelTaskSession(taskId: string): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) return;
		const info = await this.connectionManager.getConnection().catch(() => null);
		if (!info) return;
		const connection: any = (info as any).connection;
		try {
			await connection.cancel({ sessionId });
		} catch {}
		const entry = this.getRepoEntry(taskId);
		if (entry) {
			updateSummary(entry, { state: "interrupted" as any });
			this.repo?.emitSummary(entry.summary);
			this.onSummary?.(entry.summary);
		}
	}
	async stopTaskSession(taskId: string): Promise<void> {
		await this.cancelTaskSession(taskId);
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (sessionId) {
			this.sessionIdByTaskId.delete(taskId);
			this.taskIdBySessionId.delete(sessionId);
		}
		const entry = this.getRepoEntry(taskId);
		if (entry) {
			updateSummary(entry, { state: "idle" });
			this.repo?.emitSummary(entry.summary);
			this.onSummary?.(entry.summary);
		}
	}
	getSessionId(taskId: string): string | null {
		return this.sessionIdByTaskId.get(taskId) ?? null;
	}
	async dispose(): Promise<void> {
		await this.connectionManager.dispose();
		this.sessionIdByTaskId.clear();
		this.taskIdBySessionId.clear();
		this.pendingPromptByTaskId.clear();
	}
}
export function createInMemoryPrimeAcpSessionRuntime(
	options: CreatePrimeAcpSessionRuntimeOptions = {},
): PrimeAcpSessionRuntime {
	return new InMemoryPrimeAcpSessionRuntime(options);
}
