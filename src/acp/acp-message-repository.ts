// biome-ignore-all lint: ACP implementation
import type { RuntimeTaskSessionSummary, RuntimeTaskTurnCheckpoint } from "../core/api-contract";
import {
	cloneMessage,
	cloneSummary,
	type PrimeAcpMessage,
	type PrimeAcpTaskSessionEntry,
	updateSummary,
} from "./acp-session-state";
export interface PrimeAcpMessageRepository {
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void;
	onMessage(listener: (taskId: string, message: PrimeAcpMessage) => void): () => void;
	setTaskEntry(taskId: string, entry: PrimeAcpTaskSessionEntry): void;
	getTaskEntry(taskId: string): PrimeAcpTaskSessionEntry | null;
	getSummary(taskId: string): RuntimeTaskSessionSummary | null;
	listSummaries(): RuntimeTaskSessionSummary[];
	listMessages(taskId: string): PrimeAcpMessage[];
	emitSummary(summary: RuntimeTaskSessionSummary): void;
	emitMessage(taskId: string, message: PrimeAcpMessage): void;
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null;
	dispose(): void;
}
export class InMemoryPrimeAcpMessageRepository implements PrimeAcpMessageRepository {
	private readonly entries = new Map<string, PrimeAcpTaskSessionEntry>();
	private readonly summaryListeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();
	private readonly messageListeners = new Set<(taskId: string, message: PrimeAcpMessage) => void>();
	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		this.summaryListeners.add(listener);
		return () => this.summaryListeners.delete(listener);
	}
	onMessage(listener: (taskId: string, message: PrimeAcpMessage) => void): () => void {
		this.messageListeners.add(listener);
		return () => this.messageListeners.delete(listener);
	}
	setTaskEntry(taskId: string, entry: PrimeAcpTaskSessionEntry): void {
		this.entries.set(taskId, entry);
	}
	getTaskEntry(taskId: string): PrimeAcpTaskSessionEntry | null {
		return this.entries.get(taskId) ?? null;
	}
	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		const e = this.entries.get(taskId);
		return e ? cloneSummary(e.summary) : null;
	}
	listSummaries(): RuntimeTaskSessionSummary[] {
		return Array.from(this.entries.values()).map((e) => cloneSummary(e.summary));
	}
	listMessages(taskId: string): PrimeAcpMessage[] {
		const e = this.entries.get(taskId);
		return e ? e.messages.map(cloneMessage) : [];
	}
	emitSummary(summary: RuntimeTaskSessionSummary): void {
		const snap = cloneSummary(summary);
		for (const l of this.summaryListeners) l(snap);
	}
	emitMessage(taskId: string, message: PrimeAcpMessage): void {
		const snap = cloneMessage(message);
		for (const l of this.messageListeners) l(taskId, snap);
	}
	applyTurnCheckpoint(taskId: string, checkpoint: RuntimeTaskTurnCheckpoint): RuntimeTaskSessionSummary | null {
		const e = this.entries.get(taskId);
		if (!e) return null;
		return updateSummary(e, {
			latestTurnCheckpoint: checkpoint,
			previousTurnCheckpoint: e.summary.latestTurnCheckpoint ?? null,
		});
	}
	dispose(): void {
		this.entries.clear();
		this.summaryListeners.clear();
		this.messageListeners.clear();
	}
}
export function createInMemoryPrimeAcpMessageRepository(): PrimeAcpMessageRepository {
	return new InMemoryPrimeAcpMessageRepository();
}
