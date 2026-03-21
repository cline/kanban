// Owns the live SDK session host plus taskId to sessionId bindings.
// This is the runtime-facing layer for starting, looking up, resuming, and
// stopping native Cline sessions without exposing SDK details upstream.
import type { RuntimeTaskSessionMode } from "../core/api-contract.js";
import {
	createClineMcpRuntimeService,
	type ClineMcpRuntimeService,
	type ClineMcpToolBundle,
} from "./cline-mcp-runtime-service.js";
import { extractClineSessionId } from "./cline-event-adapter.js";
import { createSessionId } from "./cline-session-state.js";
import {
	type ClineSdkPersistedMessage,
	type ClineSdkSessionHost,
	type ClineSdkSessionRecord,
	type ClineSdkUserInstructionWatcher,
	createClineSdkSessionHost,
} from "./sdk-runtime-boundary.js";

const DEFAULT_CLINE_MAX_CONSECUTIVE_MISTAKES = 3;

export interface StartClineSessionRuntimeRequest {
	taskId: string;
	cwd: string;
	prompt: string;
	providerId: string;
	modelId: string;
	mode?: RuntimeTaskSessionMode;
	apiKey?: string | null;
	baseUrl?: string | null;
	systemPrompt: string;
	userInstructionWatcher?: ClineSdkUserInstructionWatcher;
	requestToolApproval?: (request: unknown) => Promise<unknown>;
}

export interface StartClineSessionRuntimeResult {
	sessionId: string;
	result: unknown;
	warnings?: string[];
}

export interface ClinePersistedTaskSessionSnapshot {
	record: ClineSdkSessionRecord;
	messages: ClineSdkPersistedMessage[];
}

export interface ClineSessionRuntime {
	startTaskSession(request: StartClineSessionRuntimeRequest): Promise<StartClineSessionRuntimeResult>;
	sendTaskSessionInput(taskId: string, prompt: string, mode?: RuntimeTaskSessionMode): Promise<unknown>;
	resumeTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null>;
	stopTaskSession(taskId: string): Promise<void>;
	abortTaskSession(taskId: string): Promise<void>;
	getTaskSessionId(taskId: string): string | null;
	readPersistedTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null>;
	dispose(): Promise<void>;
}

export interface CreateInMemoryClineSessionRuntimeOptions {
	onTaskEvent?: (taskId: string, event: unknown) => void;
	createSessionHost?: () => Promise<ClineSdkSessionHost>;
	createMcpRuntimeService?: () => ClineMcpRuntimeService;
}

// Own the SDK session host plus the taskId <-> sessionId bindings so higher layers can stay task-oriented.
export class InMemoryClineSessionRuntime implements ClineSessionRuntime {
	private readonly onTaskEvent: ((taskId: string, event: unknown) => void) | null;
	private readonly createSessionHost: () => Promise<ClineSdkSessionHost>;
	private readonly clineMcpRuntimeService: ClineMcpRuntimeService;
	private readonly sessionIdByTaskId = new Map<string, string>();
	private readonly taskIdBySessionId = new Map<string, string>();
	private readonly mcpToolBundleByTaskId = new Map<string, ClineMcpToolBundle>();
	private sessionHostPromise: Promise<ClineSdkSessionHost> | null = null;

	constructor(options: CreateInMemoryClineSessionRuntimeOptions = {}) {
		this.onTaskEvent = options.onTaskEvent ?? null;
		this.createSessionHost = options.createSessionHost ?? createClineSdkSessionHost;
		const createMcpRuntimeService = options.createMcpRuntimeService ?? createClineMcpRuntimeService;
		this.clineMcpRuntimeService = createMcpRuntimeService();
	}

	async startTaskSession(request: StartClineSessionRuntimeRequest): Promise<StartClineSessionRuntimeResult> {
		const requestedSessionId = createSessionId(request.taskId);
		this.bindTaskSession(request.taskId, requestedSessionId);

		let mcpToolBundle: ClineMcpToolBundle | null = null;
		let startWarnings: string[] = [];
		try {
			mcpToolBundle = await this.clineMcpRuntimeService.createToolBundle();
			startWarnings = mcpToolBundle.warnings;
		} catch (error) {
			mcpToolBundle = null;
			const message = error instanceof Error ? error.message.trim() : String(error);
			if (message.length > 0) {
				startWarnings = [`Failed to load MCP tools: ${message}`];
			}
		}
		this.replaceTaskMcpToolBundle(request.taskId, mcpToolBundle);

		const sessionHost = await this.ensureSessionHost();
		let startResult: StartClineSessionRuntimeResult;
		try {
			startResult = await sessionHost.start({
				config: {
					sessionId: requestedSessionId,
					providerId: request.providerId,
					modelId: request.modelId,
					apiKey: request.apiKey?.trim() || undefined,
					baseUrl: request.baseUrl?.trim() || undefined,
					cwd: request.cwd,
					mode: request.mode ?? "act",
					enableTools: true,
					enableSpawnAgent: false,
					enableAgentTeams: false,
					maxConsecutiveMistakes: DEFAULT_CLINE_MAX_CONSECUTIVE_MISTAKES,
					systemPrompt: request.systemPrompt,
					...(mcpToolBundle && mcpToolBundle.tools.length > 0 ? { extraTools: mcpToolBundle.tools } : {}),
				},
				prompt: request.prompt,
				interactive: true,
				userInstructionWatcher: request.userInstructionWatcher,
				requestToolApproval: request.requestToolApproval,
			});
		} catch (error) {
			await this.releaseTaskMcpToolBundle(request.taskId);
			throw error;
		}

		this.bindTaskSession(request.taskId, startResult.sessionId);
		if (startResult.sessionId !== requestedSessionId) {
			this.taskIdBySessionId.delete(requestedSessionId);
		}

		return {
			...startResult,
			...(startWarnings.length > 0 ? { warnings: startWarnings } : {}),
		};
	}

	async sendTaskSessionInput(taskId: string, prompt: string, mode?: RuntimeTaskSessionMode): Promise<unknown> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			throw new Error(`No active Cline session for task ${taskId}.`);
		}
		const sessionHost = await this.ensureSessionHost();
		if (mode) {
			this.updateActiveSessionMode(sessionHost, sessionId, mode);
		}
		return await sessionHost.send({
			sessionId,
			prompt,
		});
	}

	async resumeTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
		const sessionHost = await this.ensureSessionHost();
		const record = await this.findPersistedTaskSessionRecord(taskId, sessionHost);
		if (!record) {
			return null;
		}
		this.bindTaskSession(taskId, record.sessionId);
		const messages = await sessionHost.readMessages(record.sessionId);
		return {
			record,
			messages,
		};
	}

	async stopTaskSession(taskId: string): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			await this.releaseTaskMcpToolBundle(taskId);
			return;
		}
		const sessionHost = await this.ensureSessionHost();
		await sessionHost.stop(sessionId);
		await this.releaseTaskMcpToolBundle(taskId);
	}

	async abortTaskSession(taskId: string): Promise<void> {
		const sessionId = this.sessionIdByTaskId.get(taskId);
		if (!sessionId) {
			await this.releaseTaskMcpToolBundle(taskId);
			return;
		}
		const sessionHost = await this.ensureSessionHost();
		await sessionHost.abort(sessionId);
		await this.releaseTaskMcpToolBundle(taskId);
	}

	getTaskSessionId(taskId: string): string | null {
		return this.sessionIdByTaskId.get(taskId) ?? null;
	}

	async readPersistedTaskSession(taskId: string): Promise<ClinePersistedTaskSessionSnapshot | null> {
		const sessionHost = await this.ensureSessionHost();
		const record = await this.findPersistedTaskSessionRecord(taskId, sessionHost);
		if (!record) {
			return null;
		}
		const messages = await sessionHost.readMessages(record.sessionId);
		return {
			record,
			messages,
		};
	}

	async dispose(): Promise<void> {
		const hostPromise = this.sessionHostPromise;
		this.sessionHostPromise = null;
		if (hostPromise) {
			try {
				const host = await hostPromise;
				await host.dispose("kanban-runtime-dispose");
			} catch {
				// Ignore host disposal errors.
			}
		}
		this.sessionIdByTaskId.clear();
		this.taskIdBySessionId.clear();

		const mcpBundles = [...this.mcpToolBundleByTaskId.values()];
		this.mcpToolBundleByTaskId.clear();
		await Promise.all(
			mcpBundles.map(async (bundle) => {
				await bundle.dispose().catch(() => undefined);
			}),
		);
	}

	private replaceTaskMcpToolBundle(taskId: string, bundle: ClineMcpToolBundle | null): void {
		const current = this.mcpToolBundleByTaskId.get(taskId);
		if (current) {
			void current.dispose().catch(() => undefined);
			this.mcpToolBundleByTaskId.delete(taskId);
		}
		if (bundle) {
			this.mcpToolBundleByTaskId.set(taskId, bundle);
		}
	}

	private async releaseTaskMcpToolBundle(taskId: string): Promise<void> {
		const current = this.mcpToolBundleByTaskId.get(taskId);
		if (!current) {
			return;
		}
		this.mcpToolBundleByTaskId.delete(taskId);
		await current.dispose().catch(() => undefined);
	}

	private bindTaskSession(taskId: string, sessionId: string): void {
		const previousSessionId = this.sessionIdByTaskId.get(taskId);
		if (previousSessionId) {
			this.taskIdBySessionId.delete(previousSessionId);
		}
		this.sessionIdByTaskId.set(taskId, sessionId);
		this.taskIdBySessionId.set(sessionId, taskId);
	}

	private async findPersistedTaskSessionRecord(
		taskId: string,
		sessionHost: ClineSdkSessionHost,
	): Promise<ClineSdkSessionRecord | null> {
		const activeSessionId = this.sessionIdByTaskId.get(taskId);
		if (activeSessionId) {
			const activeRecord = (await sessionHost.get(activeSessionId)) ?? null;
			if (activeRecord) {
				return activeRecord;
			}
		}

		const sessionIdPrefix = `${taskId}-`;
		const records: ClineSdkSessionRecord[] = await sessionHost.list();
		const matchingRecord = records
			.filter((record: ClineSdkSessionRecord) => record.sessionId.startsWith(sessionIdPrefix))
			.sort((left: ClineSdkSessionRecord, right: ClineSdkSessionRecord) => {
				const leftTimestamp = Date.parse(left.updatedAt || left.startedAt);
				const rightTimestamp = Date.parse(right.updatedAt || right.startedAt);
				return rightTimestamp - leftTimestamp;
			})[0];
		return matchingRecord ?? null;
	}

	private async ensureSessionHost(): Promise<ClineSdkSessionHost> {
		if (!this.sessionHostPromise) {
			this.sessionHostPromise = this.createSessionHost().then((sessionHost: ClineSdkSessionHost) => {
				sessionHost.subscribe((event: unknown) => {
					this.handleSessionEvent(event);
				});
				return sessionHost;
			});
		}
		return await this.sessionHostPromise;
	}

	private updateActiveSessionMode(
		sessionHost: ClineSdkSessionHost,
		sessionId: string,
		mode: RuntimeTaskSessionMode,
	): void {
		const hostWithSessions = sessionHost as unknown as {
			sessions?: Map<string, { config?: { mode?: RuntimeTaskSessionMode } }>;
		};
		const activeSession = hostWithSessions.sessions?.get(sessionId);
		if (activeSession?.config) {
			activeSession.config.mode = mode;
		}
	}

	private handleSessionEvent(event: unknown): void {
		if (!this.onTaskEvent) {
			return;
		}
		const sessionId = extractClineSessionId(event);
		if (!sessionId) {
			return;
		}
		const taskId = this.taskIdBySessionId.get(sessionId);
		if (!taskId) {
			return;
		}
		this.onTaskEvent(taskId, event);
	}
}

export function createInMemoryClineSessionRuntime(
	options: CreateInMemoryClineSessionRuntimeOptions = {},
): ClineSessionRuntime {
	return new InMemoryClineSessionRuntime(options);
}
