import * as pty from "node-pty";

import type {
	RuntimeTaskSessionReviewReason,
	RuntimeTaskSessionState,
	RuntimeTaskSessionSummary,
} from "../core/api-contract.js";
import { buildShellCommandLine, resolveInteractiveShellCommand } from "../core/shell.js";
import { type ActivityPreviewTracker, createActivityPreviewTracker } from "./activity-preview.js";
import {
	type AgentAdapterLaunchInput,
	type AgentOutputTransitionDetector,
	prepareAgentLaunch,
} from "./agent-session-adapters.js";
import {
	CLAUDE_WORKSPACE_TRUST_CONFIRM_DELAY_MS,
	CLAUDE_WORKSPACE_TRUST_POLL_MS,
	hasClaudeWorkspaceTrustPrompt,
	shouldAutoConfirmClaudeWorkspaceTrust,
	stopClaudeWorkspaceTrustTimers,
} from "./claude-workspace-trust.js";
import { reduceSessionTransition, type SessionTransitionEvent } from "./session-state-machine.js";

const MAX_HISTORY_BYTES = 1024 * 1024;
const ACTIVITY_PREVIEW_THROTTLE_MS = 2500;
const MAX_CLAUDE_TRUST_BUFFER_CHARS = 16_384;
// Some interactive shells can start without emitting prompt output immediately.
// Fallback ensures the initial command is still sent if onData does not fire quickly.
const SHELL_KICKOFF_FALLBACK_DELAY_MS = 450;

interface ActiveProcessState {
	ptyProcess: pty.IPty;
	outputHistory: Buffer[];
	historyBytes: number;
	claudeTrustBuffer: string | null;
	cols: number;
	rows: number;
	shutdownInterrupted: boolean;
	onSessionCleanup: (() => Promise<void>) | null;
	detectOutputTransition: AgentOutputTransitionDetector | null;
	awaitingCodexPromptAfterEnter: boolean;
	activityPreviewTimer: NodeJS.Timeout | null;
	activityPreviewChunkBuffer: string;
	activityPreviewTracker: ActivityPreviewTracker;
	autoConfirmedClaudeWorkspaceTrust: boolean;
	claudeWorkspaceTrustPollTimer: NodeJS.Timeout | null;
	claudeWorkspaceTrustConfirmTimer: NodeJS.Timeout | null;
}

interface SessionEntry {
	summary: RuntimeTaskSessionSummary;
	active: ActiveProcessState | null;
	listenerIdCounter: number;
	listeners: Map<number, TerminalSessionListener>;
}

export interface TerminalSessionListener {
	onOutput?: (chunk: Buffer) => void;
	onState?: (summary: RuntimeTaskSessionSummary) => void;
	onExit?: (code: number | null) => void;
}

export interface StartTaskSessionRequest {
	taskId: string;
	agentId: AgentAdapterLaunchInput["agentId"];
	binary: string;
	args: string[];
	autonomousModeEnabled?: boolean;
	cwd: string;
	prompt: string;
	startInPlanMode?: boolean;
	resumeFromTrash?: boolean;
	cols?: number;
	rows?: number;
	env?: Record<string, string | undefined>;
	workspaceId?: string;
}

export interface StartShellSessionRequest {
	taskId: string;
	cwd: string;
	cols?: number;
	rows?: number;
	binary: string;
	args?: string[];
	env?: Record<string, string | undefined>;
}

function terminatePtyProcess(active: ActiveProcessState): void {
	const pid = active.ptyProcess.pid;
	active.ptyProcess.kill();
	if (process.platform !== "win32" && Number.isFinite(pid) && pid > 0) {
		try {
			process.kill(-pid, "SIGTERM");
		} catch {
			// Best effort: process group may already be gone or inaccessible.
		}
	}
}

function clearActivityPreviewTimer(active: ActiveProcessState): void {
	if (active.activityPreviewTimer) {
		clearTimeout(active.activityPreviewTimer);
		active.activityPreviewTimer = null;
	}
}

function now(): number {
	return Date.now();
}

function createDefaultSummary(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: now(),
		lastOutputAt: null,
		activityPreview: null,
		reviewReason: null,
		exitCode: null,
	};
}

function cloneSummary(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary {
	return {
		...summary,
	};
}

function updateSummary(entry: SessionEntry, patch: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary {
	entry.summary = {
		...entry.summary,
		...patch,
		updatedAt: now(),
	};
	return entry.summary;
}

function isActiveState(state: RuntimeTaskSessionState): boolean {
	return state === "running" || state === "awaiting_review";
}

function formatSpawnFailure(binary: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	if (normalized.includes("posix_spawnp failed") || normalized.includes("enoent")) {
		return `Failed to launch "${binary}". Command not found. Install a supported agent CLI and select it in Settings.`;
	}
	return `Failed to launch "${binary}": ${message}`;
}

function formatShellSpawnFailure(binary: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	if (normalized.includes("posix_spawnp failed") || normalized.includes("enoent")) {
		return `Failed to launch "${binary}". Command not found on this system.`;
	}
	return `Failed to launch "${binary}": ${message}`;
}

export class TerminalSessionManager {
	private readonly entries = new Map<string, SessionEntry>();
	private readonly summaryListeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();

	onSummary(listener: (summary: RuntimeTaskSessionSummary) => void): () => void {
		this.summaryListeners.add(listener);
		return () => {
			this.summaryListeners.delete(listener);
		};
	}

	hydrateFromRecord(record: Record<string, RuntimeTaskSessionSummary>): void {
		for (const [taskId, summary] of Object.entries(record)) {
			this.entries.set(taskId, {
				summary: cloneSummary(summary),
				active: null,
				listenerIdCounter: 1,
				listeners: new Map(),
			});
		}
	}

	getSummary(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		return entry ? cloneSummary(entry.summary) : null;
	}

	listSummaries(): RuntimeTaskSessionSummary[] {
		return Array.from(this.entries.values()).map((entry) => cloneSummary(entry.summary));
	}

	attach(taskId: string, listener: TerminalSessionListener): (() => void) | null {
		const entry = this.ensureEntry(taskId);

		listener.onState?.(cloneSummary(entry.summary));
		for (const chunk of entry.active?.outputHistory ?? []) {
			listener.onOutput?.(chunk);
		}

		const listenerId = entry.listenerIdCounter;
		entry.listenerIdCounter += 1;
		entry.listeners.set(listenerId, listener);

		return () => {
			entry.listeners.delete(listenerId);
		};
	}

	async startTaskSession(request: StartTaskSessionRequest): Promise<RuntimeTaskSessionSummary> {
		const entry = this.ensureEntry(request.taskId);
		if (entry.active && isActiveState(entry.summary.state)) {
			return cloneSummary(entry.summary);
		}

		if (entry.active) {
			stopClaudeWorkspaceTrustTimers(entry.active);
			clearActivityPreviewTimer(entry.active);
			terminatePtyProcess(entry.active);
			entry.active = null;
		}

		const cols = Number.isFinite(request.cols) && (request.cols ?? 0) > 0 ? Math.floor(request.cols ?? 0) : 120;
		const rows = Number.isFinite(request.rows) && (request.rows ?? 0) > 0 ? Math.floor(request.rows ?? 0) : 40;

		const launch = await prepareAgentLaunch({
			taskId: request.taskId,
			agentId: request.agentId,
			binary: request.binary,
			args: request.args,
			autonomousModeEnabled: request.autonomousModeEnabled,
			cwd: request.cwd,
			prompt: request.prompt,
			startInPlanMode: request.startInPlanMode,
			resumeFromTrash: request.resumeFromTrash,
			env: request.env,
			workspaceId: request.workspaceId,
		});

		const env = {
			...process.env,
			...request.env,
			...launch.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
		};

		let ptyProcess: pty.IPty;
		// Adapters can wrap the configured agent binary when they need extra runtime wiring
		// (for example, Codex uses a wrapper script to watch session logs for hook transitions).
		const commandBinary = launch.binary ?? request.binary;
		const commandArgs = [...launch.args];
		const kickoffShellCommand = buildShellCommandLine(commandBinary, commandArgs);
		const shell = resolveInteractiveShellCommand();
		const spawnBinary = shell.binary;
		const spawnArgs = shell.args;
		try {
			ptyProcess = pty.spawn(spawnBinary, spawnArgs, {
				name: "xterm-256color",
				cwd: request.cwd,
				env,
				cols,
				rows,
			});
		} catch (error) {
			if (launch.cleanup) {
				void launch.cleanup().catch(() => {
					// Best effort: cleanup failure is non-critical.
				});
			}
			const summary = updateSummary(entry, {
				state: "failed",
				agentId: request.agentId,
				workspacePath: request.cwd,
				pid: null,
				startedAt: null,
				lastOutputAt: null,
				activityPreview: null,
				reviewReason: "error",
				exitCode: null,
			});
			this.emitSummary(summary);
			throw new Error(formatSpawnFailure(commandBinary, error));
		}

		const active: ActiveProcessState = {
			ptyProcess,
			outputHistory: [],
			historyBytes: 0,
			claudeTrustBuffer: shouldAutoConfirmClaudeWorkspaceTrust(request.agentId, request.cwd) ? "" : null,
			cols,
			rows,
			shutdownInterrupted: false,
			onSessionCleanup: launch.cleanup ?? null,
			detectOutputTransition: launch.detectOutputTransition ?? null,
			awaitingCodexPromptAfterEnter: false,
			activityPreviewTimer: null,
			activityPreviewChunkBuffer: "",
			activityPreviewTracker: createActivityPreviewTracker(cols, rows),
			autoConfirmedClaudeWorkspaceTrust: false,
			claudeWorkspaceTrustPollTimer: null,
			claudeWorkspaceTrustConfirmTimer: null,
		};
		entry.active = active;
		if (shouldAutoConfirmClaudeWorkspaceTrust(request.agentId, request.cwd)) {
			active.claudeWorkspaceTrustPollTimer = setInterval(() => {
				const currentEntry = this.entries.get(request.taskId);
				const currentActive = currentEntry?.active;
				if (!currentActive) {
					return;
				}
				if (currentActive.autoConfirmedClaudeWorkspaceTrust) {
					stopClaudeWorkspaceTrustTimers(currentActive);
					return;
				}
				if (!currentActive.claudeTrustBuffer || !hasClaudeWorkspaceTrustPrompt(currentActive.claudeTrustBuffer)) {
					return;
				}
				currentActive.autoConfirmedClaudeWorkspaceTrust = true;
				stopClaudeWorkspaceTrustTimers(currentActive);
				currentActive.claudeWorkspaceTrustConfirmTimer = setTimeout(() => {
					const activeEntry = this.entries.get(request.taskId)?.active;
					if (!activeEntry || !activeEntry.autoConfirmedClaudeWorkspaceTrust) {
						return;
					}
					activeEntry.ptyProcess.write("\r");
					activeEntry.claudeWorkspaceTrustConfirmTimer = null;
				}, CLAUDE_WORKSPACE_TRUST_CONFIRM_DELAY_MS);
			}, CLAUDE_WORKSPACE_TRUST_POLL_MS);
		}

		const startedAt = now();
		updateSummary(entry, {
			state: request.resumeFromTrash ? "awaiting_review" : "running",
			agentId: request.agentId,
			workspacePath: request.cwd,
			pid: ptyProcess.pid,
			startedAt,
			lastOutputAt: null,
			activityPreview: request.resumeFromTrash ? entry.summary.activityPreview : null,
			reviewReason: request.resumeFromTrash ? "attention" : null,
			exitCode: null,
		});
		this.emitSummary(entry.summary);

		let kickoffShellCommandSent = false;
		let kickoffShellTimer: NodeJS.Timeout | null = null;
		const clearKickoffShellTimer = () => {
			if (!kickoffShellTimer) {
				return;
			}
			clearTimeout(kickoffShellTimer);
			kickoffShellTimer = null;
		};
		const sendKickoffShellCommand = () => {
			if (!kickoffShellCommand || kickoffShellCommandSent) {
				return;
			}
			const runningEntry = this.entries.get(request.taskId);
			if (!runningEntry?.active) {
				return;
			}
			kickoffShellCommandSent = true;
			clearKickoffShellTimer();
			runningEntry.active.ptyProcess.write(kickoffShellCommand);
			runningEntry.active.ptyProcess.write("\r");
		};
		if (kickoffShellCommand) {
			kickoffShellTimer = setTimeout(() => {
				sendKickoffShellCommand();
				kickoffShellTimer = null;
			}, SHELL_KICKOFF_FALLBACK_DELAY_MS);
		}

		ptyProcess.onData((data) => {
			if (!entry.active) {
				return;
			}
			if (kickoffShellCommand && !kickoffShellCommandSent) {
				sendKickoffShellCommand();
			}
			const chunk = Buffer.from(data, "utf8");
			entry.active.outputHistory.push(chunk);
			entry.active.historyBytes += chunk.byteLength;
			while (entry.active.historyBytes > MAX_HISTORY_BYTES && entry.active.outputHistory.length > 0) {
				const shifted = entry.active.outputHistory.shift();
				if (!shifted) {
					break;
				}
				entry.active.historyBytes -= shifted.byteLength;
			}

			if (entry.active.claudeTrustBuffer !== null) {
				entry.active.claudeTrustBuffer += data;
				if (entry.active.claudeTrustBuffer.length > MAX_CLAUDE_TRUST_BUFFER_CHARS) {
					entry.active.claudeTrustBuffer = entry.active.claudeTrustBuffer.slice(-MAX_CLAUDE_TRUST_BUFFER_CHARS);
				}
			}
			entry.active.activityPreviewChunkBuffer += data;
			this.queueActivityPreviewPublish(entry);

			updateSummary(entry, { lastOutputAt: now() });

			const adapterEvent = entry.active.detectOutputTransition?.(data, entry.summary) ?? null;
			if (adapterEvent) {
				const requiresEnterForCodex =
					adapterEvent.type === "agent.prompt-ready" &&
					entry.summary.agentId === "codex" &&
					!entry.active.awaitingCodexPromptAfterEnter;
				if (!requiresEnterForCodex) {
					const summary = this.applySessionEvent(entry, adapterEvent);
					if (adapterEvent.type === "agent.prompt-ready" && entry.summary.agentId === "codex") {
						entry.active.awaitingCodexPromptAfterEnter = false;
					}
					for (const taskListener of entry.listeners.values()) {
						taskListener.onState?.(cloneSummary(summary));
					}
					this.emitSummary(summary);
				}
			}

			for (const taskListener of entry.listeners.values()) {
				taskListener.onOutput?.(chunk);
			}
		});

		ptyProcess.onExit((event) => {
			const currentEntry = this.entries.get(request.taskId);
			if (!currentEntry) {
				return;
			}
			const currentActive = currentEntry.active;
			if (!currentActive) {
				return;
			}
			this.publishLatestActivityPreview(currentEntry, currentActive);
			stopClaudeWorkspaceTrustTimers(currentActive);
			clearActivityPreviewTimer(currentActive);
			clearKickoffShellTimer();

			const summary = this.applySessionEvent(currentEntry, {
				type: "process.exit",
				exitCode: event.exitCode,
				interrupted: currentActive.shutdownInterrupted,
			});

			for (const taskListener of currentEntry.listeners.values()) {
				taskListener.onState?.(cloneSummary(summary));
				taskListener.onExit?.(event.exitCode);
			}
			currentEntry.active = null;
			this.emitSummary(summary);

			const cleanupFn = currentActive.onSessionCleanup;
			currentActive.onSessionCleanup = null;
			if (cleanupFn) {
				cleanupFn().catch(() => {
					// Best effort: cleanup failure is non-critical.
				});
			}
		});

		return cloneSummary(entry.summary);
	}

	async startShellSession(request: StartShellSessionRequest): Promise<RuntimeTaskSessionSummary> {
		const entry = this.ensureEntry(request.taskId);
		if (entry.active && entry.summary.state === "running") {
			return cloneSummary(entry.summary);
		}

		if (entry.active) {
			stopClaudeWorkspaceTrustTimers(entry.active);
			clearActivityPreviewTimer(entry.active);
			terminatePtyProcess(entry.active);
			entry.active = null;
		}

		const cols = Number.isFinite(request.cols) && (request.cols ?? 0) > 0 ? Math.floor(request.cols ?? 0) : 120;
		const rows = Number.isFinite(request.rows) && (request.rows ?? 0) > 0 ? Math.floor(request.rows ?? 0) : 40;
		const env = {
			...process.env,
			...request.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
		};

		let ptyProcess: pty.IPty;
		try {
			ptyProcess = pty.spawn(request.binary, request.args ?? [], {
				name: "xterm-256color",
				cwd: request.cwd,
				env,
				cols,
				rows,
			});
		} catch (error) {
			const summary = updateSummary(entry, {
				state: "failed",
				agentId: null,
				workspacePath: request.cwd,
				pid: null,
				startedAt: null,
				lastOutputAt: null,
				activityPreview: null,
				reviewReason: "error",
				exitCode: null,
			});
			this.emitSummary(summary);
			throw new Error(formatShellSpawnFailure(request.binary, error));
		}

		const active: ActiveProcessState = {
			ptyProcess,
			outputHistory: [],
			historyBytes: 0,
			claudeTrustBuffer: null,
			cols,
			rows,
			shutdownInterrupted: false,
			onSessionCleanup: null,
			detectOutputTransition: null,
			awaitingCodexPromptAfterEnter: false,
			activityPreviewTimer: null,
			activityPreviewChunkBuffer: "",
			activityPreviewTracker: createActivityPreviewTracker(cols, rows),
			autoConfirmedClaudeWorkspaceTrust: false,
			claudeWorkspaceTrustPollTimer: null,
			claudeWorkspaceTrustConfirmTimer: null,
		};
		entry.active = active;

		updateSummary(entry, {
			state: "running",
			agentId: null,
			workspacePath: request.cwd,
			pid: ptyProcess.pid,
			startedAt: now(),
			lastOutputAt: null,
			activityPreview: null,
			reviewReason: null,
			exitCode: null,
		});
		this.emitSummary(entry.summary);

		ptyProcess.onData((data) => {
			if (!entry.active) {
				return;
			}
			const chunk = Buffer.from(data, "utf8");
			entry.active.outputHistory.push(chunk);
			entry.active.historyBytes += chunk.byteLength;
			while (entry.active.historyBytes > MAX_HISTORY_BYTES && entry.active.outputHistory.length > 0) {
				const shifted = entry.active.outputHistory.shift();
				if (!shifted) {
					break;
				}
				entry.active.historyBytes -= shifted.byteLength;
			}

			if (entry.active.claudeTrustBuffer !== null) {
				entry.active.claudeTrustBuffer += data;
				if (entry.active.claudeTrustBuffer.length > MAX_CLAUDE_TRUST_BUFFER_CHARS) {
					entry.active.claudeTrustBuffer = entry.active.claudeTrustBuffer.slice(-MAX_CLAUDE_TRUST_BUFFER_CHARS);
				}
			}
			entry.active.activityPreviewChunkBuffer += data;
			this.queueActivityPreviewPublish(entry);

			updateSummary(entry, { lastOutputAt: now() });

			for (const taskListener of entry.listeners.values()) {
				taskListener.onOutput?.(chunk);
			}
		});

		ptyProcess.onExit((event) => {
			const currentEntry = this.entries.get(request.taskId);
			if (!currentEntry) {
				return;
			}
			const currentActive = currentEntry.active;
			if (!currentActive) {
				return;
			}
			this.publishLatestActivityPreview(currentEntry, currentActive);
			stopClaudeWorkspaceTrustTimers(currentActive);
			clearActivityPreviewTimer(currentActive);

			const summary = updateSummary(currentEntry, {
				state: currentActive.shutdownInterrupted ? "interrupted" : "idle",
				reviewReason: currentActive.shutdownInterrupted ? "interrupted" : null,
				exitCode: event.exitCode,
				pid: null,
			});

			for (const taskListener of currentEntry.listeners.values()) {
				taskListener.onState?.(cloneSummary(summary));
				taskListener.onExit?.(event.exitCode);
			}
			currentEntry.active = null;
			this.emitSummary(summary);
		});

		return cloneSummary(entry.summary);
	}

	writeInput(taskId: string, data: Buffer): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return null;
		}
		const text = data.toString("utf8");
		if (
			entry.summary.agentId === "codex" &&
			entry.summary.state === "awaiting_review" &&
			(entry.summary.reviewReason === "hook" || entry.summary.reviewReason === "attention") &&
			(text.includes("\r") || text.includes("\n"))
		) {
			entry.active.awaitingCodexPromptAfterEnter = true;
		}
		entry.active.ptyProcess.write(text);
		return cloneSummary(entry.summary);
	}

	resize(taskId: string, cols: number, rows: number): boolean {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return false;
		}
		const safeCols = Math.max(1, Math.floor(cols));
		const safeRows = Math.max(1, Math.floor(rows));
		entry.active.ptyProcess.resize(safeCols, safeRows);
		entry.active.cols = safeCols;
		entry.active.rows = safeRows;
		entry.active.activityPreviewTracker.resize(safeCols, safeRows);
		return true;
	}

	transitionToReview(taskId: string, reason: RuntimeTaskSessionReviewReason): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry) {
			return null;
		}
		if (reason !== "hook") {
			return cloneSummary(entry.summary);
		}
		const before = entry.summary;
		const summary = this.applySessionEvent(entry, { type: "hook.to_review" });
		if (summary !== before && entry.active) {
			for (const listener of entry.listeners.values()) {
				listener.onState?.(cloneSummary(summary));
			}
			this.emitSummary(summary);
		}
		return cloneSummary(summary);
	}

	transitionToRunning(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry) {
			return null;
		}
		const before = entry.summary;
		const summary = this.applySessionEvent(entry, { type: "hook.to_in_progress" });
		if (summary !== before && entry.active) {
			for (const listener of entry.listeners.values()) {
				listener.onState?.(cloneSummary(summary));
			}
			this.emitSummary(summary);
		}
		return cloneSummary(summary);
	}

	stopTaskSession(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return entry ? cloneSummary(entry.summary) : null;
		}
		this.publishLatestActivityPreview(entry, entry.active);
		const cleanupFn = entry.active.onSessionCleanup;
		entry.active.onSessionCleanup = null;
		stopClaudeWorkspaceTrustTimers(entry.active);
		clearActivityPreviewTimer(entry.active);
		terminatePtyProcess(entry.active);
		if (cleanupFn) {
			cleanupFn().catch(() => {
				// Best effort: cleanup failure is non-critical.
			});
		}
		return cloneSummary(entry.summary);
	}

	markInterruptedAndStopAll(): RuntimeTaskSessionSummary[] {
		const activeEntries = Array.from(this.entries.values()).filter((entry) => entry.active != null);
		for (const entry of activeEntries) {
			if (!entry.active) {
				continue;
			}
			this.publishLatestActivityPreview(entry, entry.active);
			entry.active.shutdownInterrupted = true;
			stopClaudeWorkspaceTrustTimers(entry.active);
			clearActivityPreviewTimer(entry.active);
			terminatePtyProcess(entry.active);
		}
		return activeEntries.map((entry) => cloneSummary(entry.summary));
	}

	private applySessionEvent(entry: SessionEntry, event: SessionTransitionEvent): RuntimeTaskSessionSummary {
		const transition = reduceSessionTransition(entry.summary, event);
		if (!transition.changed) {
			return entry.summary;
		}
		if (transition.clearAttentionBuffer && entry.active) {
			if (entry.active.claudeTrustBuffer !== null) {
				entry.active.claudeTrustBuffer = "";
			}
		}
		if (entry.active && transition.changed && transition.patch.state === "awaiting_review") {
			entry.active.awaitingCodexPromptAfterEnter = false;
		}
		return updateSummary(entry, transition.patch);
	}

	private ensureEntry(taskId: string): SessionEntry {
		const existing = this.entries.get(taskId);
		if (existing) {
			return existing;
		}
		const created: SessionEntry = {
			summary: createDefaultSummary(taskId),
			active: null,
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		this.entries.set(taskId, created);
		return created;
	}

	private queueActivityPreviewPublish(entry: SessionEntry): void {
		if (!entry.active || entry.active.activityPreviewTimer) {
			return;
		}
		const activeAtSchedule = entry.active;
		activeAtSchedule.activityPreviewTimer = setTimeout(() => {
			activeAtSchedule.activityPreviewTimer = null;
			this.publishLatestActivityPreview(entry, activeAtSchedule);
		}, ACTIVITY_PREVIEW_THROTTLE_MS);
	}

	private publishLatestActivityPreview(entry: SessionEntry, active: ActiveProcessState): void {
		if (entry.active !== active) {
			return;
		}
		if (active.activityPreviewChunkBuffer.length > 0) {
			active.activityPreviewTracker.append(active.activityPreviewChunkBuffer);
			active.activityPreviewChunkBuffer = "";
		}
		const parsedActivityPreview = active.activityPreviewTracker.extract(entry.summary.agentId);
		if (parsedActivityPreview === entry.summary.activityPreview) {
			return;
		}
		const summary = updateSummary(entry, { activityPreview: parsedActivityPreview });
		for (const taskListener of entry.listeners.values()) {
			taskListener.onState?.(cloneSummary(summary));
		}
		this.emitSummary(summary);
	}

	private emitSummary(summary: RuntimeTaskSessionSummary): void {
		const snapshot = cloneSummary(summary);
		for (const listener of this.summaryListeners) {
			listener(snapshot);
		}
	}
}
