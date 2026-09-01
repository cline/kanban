// biome-ignore-all lint: ACP implementation
import type { RuntimeTaskImage, RuntimeTaskSessionSummary, RuntimeTaskTurnCheckpoint } from "../core/api-contract";
import { isPrimeAcpEnabled } from "./acp-config";
import { createInMemoryPrimeAcpMessageRepository, type PrimeAcpMessageRepository } from "./acp-message-repository";
import { createInMemoryPrimeAcpSessionRuntime, type PrimeAcpSessionRuntime } from "./acp-session-runtime";
import type { PrimeAcpMessage } from "./acp-session-state";
export interface StartPrimeAcpTaskSessionRequest {
	taskId: string;
	cwd: string;
	prompt: string;
	taskTitle?: string;
	images?: RuntimeTaskImage[];
	resumeFromTrash?: boolean;
}
export interface PrimeAcpTaskSessionService {
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void;
	onMessage(listener: (taskId: string, message: PrimeAcpMessage) => void): () => void;
	startTaskSession(request: StartPrimeAcpTaskSessionRequest): Promise<RuntimeTaskSessionSummary>;
	stopTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	abortTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	sendTaskSessionInput(
		taskId: string,
		text: string,
		images?: RuntimeTaskImage[],
	): Promise<RuntimeTaskSessionSummary | null>;
	reloadTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	getSummary(taskId: string): RuntimeTaskSessionSummary | null;
	listSummaries(): RuntimeTaskSessionSummary[];
	listMessages(taskId: string): PrimeAcpMessage[];
	loadTaskSessionMessages(taskId: string): Promise<PrimeAcpMessage[]>;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	dispose(): Promise<void>;
}
export interface CreateInMemoryPrimeAcpTaskSessionServiceOptions {
	createSessionRuntime?: (opts: any) => PrimeAcpSessionRuntime;
	createMessageRepository?: () => PrimeAcpMessageRepository;
}
export class InMemoryPrimeAcpTaskSessionService implements PrimeAcpTaskSessionService {
	private readonly repo: PrimeAcpMessageRepository;
	private readonly runtime: PrimeAcpSessionRuntime;
	private readonly summaryListeners = new Set<(s: RuntimeTaskSessionSummary) => void>();
	private readonly messageListeners = new Set<(taskId: string, msg: PrimeAcpMessage) => void>();
	constructor(options: CreateInMemoryPrimeAcpTaskSessionServiceOptions = {}) {
		this.repo = (options.createMessageRepository ?? createInMemoryPrimeAcpMessageRepository)();
		this.runtime = (
			options.createSessionRuntime
				? options.createSessionRuntime({ messageRepository: this.repo })
				: createInMemoryPrimeAcpSessionRuntime({ messageRepository: this.repo })
		) as PrimeAcpSessionRuntime;
		this.repo.onSummary((summary) => {
			for (const l of this.summaryListeners) l(summary);
		});
		this.repo.onMessage((taskId, message) => {
			for (const l of this.messageListeners) l(taskId, message);
		});
	}
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		this.summaryListeners.add(listener);
		return () => this.summaryListeners.delete(listener);
	}
	onMessage(listener: (taskId: string, message: PrimeAcpMessage) => void): () => void {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}
	async startTaskSession(request: StartPrimeAcpTaskSessionRequest): Promise<RuntimeTaskSessionSummary> {
		if (!isPrimeAcpEnabled()) throw new Error("Prime ACP is disabled via feature flag");
		await this.runtime.startTaskSession({
			taskId: request.taskId,
			cwd: request.cwd,
			prompt: request.prompt,
			images: request.images,
		});
		const summary = this.repo.getSummary(request.taskId);
		if (!summary) throw new Error("Failed to create Prime ACP session");
		return summary;
	}
	async stopTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		await this.runtime.stopTaskSession(taskId);
		return this.repo.getSummary(taskId);
	}
	async abortTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		await this.runtime.cancelTaskSession(taskId);
		return this.repo.getSummary(taskId);
	}
	async cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		await this.runtime.cancelTaskSession(taskId);
		return this.repo.getSummary(taskId);
	}
	async sendTaskSessionInput(
		taskId: string,
		text: string,
		images?: RuntimeTaskImage[],
	): Promise<RuntimeTaskSessionSummary | null> {
		const summary = this.repo.getSummary(taskId);
		if (!summary) return null;
		await this.runtime.sendTaskSessionInput(taskId, text, images);
		return this.repo.getSummary(taskId);
	}
	async reloadTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		return this.repo.getSummary(taskId);
	}
	async clearTaskSession(taskId: string): Promise<RuntimeTaskSessionSummary | null> {
		const entry = this.repo.getTaskEntry(taskId);
		if (!entry) return null;
		entry.messages.length = 0;
		entry.activeAssistantMessageId = null;
		entry.activeReasoningMessageId = null;
		entry.toolMessageIdByToolCallId.clear();
		return this.repo.getSummary(taskId);
	}
	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		return this.repo.getSummary(taskId);
	}
	listSummaries(): RuntimeTaskSessionSummary[] {
		return this.repo.listSummaries();
	}
	listMessages(taskId: string): PrimeAcpMessage[] {
		return this.repo.listMessages(taskId);
	}
	async loadTaskSessionMessages(taskId: string): Promise<PrimeAcpMessage[]> {
		return this.repo.listMessages(taskId);
	}
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null {
		return this.repo.applyTurnCheckpoint(taskId, checkpoint);
	}
	async dispose(): Promise<void> {
		await this.runtime.dispose();
		this.repo.dispose();
		this.summaryListeners.clear();
		this.messageListeners.clear();
	}
}
export function createInMemoryPrimeAcpTaskSessionService(
	options: CreateInMemoryPrimeAcpTaskSessionServiceOptions = {},
): PrimeAcpTaskSessionService {
	return new InMemoryPrimeAcpTaskSessionService(options);
}
