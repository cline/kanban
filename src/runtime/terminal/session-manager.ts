import { constants as fsConstants } from "node:fs";
import { access, chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import * as pty from "node-pty";

import type {
	RuntimeAgentId,
	RuntimeTaskSessionReviewReason,
	RuntimeTaskSessionState,
	RuntimeTaskSessionSummary,
} from "../api-contract.js";
import { detectNeedsAttention, extractLastActivityLine } from "./output-monitor.js";

const MAX_HISTORY_BYTES = 1024 * 1024;
const require = createRequire(import.meta.url);
let ensurePtyHelperExecutablePromise: Promise<void> | null = null;

interface ActiveProcessState {
	ptyProcess: pty.IPty;
	outputHistory: Buffer[];
	historyBytes: number;
	listenerIdCounter: number;
	listeners: Map<number, TerminalSessionListener>;
	attentionBuffer: string;
	shutdownInterrupted: boolean;
}

interface SessionEntry {
	summary: RuntimeTaskSessionSummary;
	active: ActiveProcessState | null;
}

export interface TerminalSessionListener {
	onOutput?: (chunk: Buffer) => void;
	onState?: (summary: RuntimeTaskSessionSummary) => void;
	onExit?: (code: number | null) => void;
}

export interface StartTaskSessionRequest {
	taskId: string;
	agentId: RuntimeAgentId;
	binary: string;
	args: string[];
	cwd: string;
	prompt: string;
	startInPlanMode?: boolean;
	cols?: number;
	rows?: number;
	env?: Record<string, string | undefined>;
}

interface LaunchCommand {
	args: string[];
	env: Record<string, string | undefined>;
	writesPromptInternally: boolean;
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
		lastActivityLine: null,
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

function makeReviewState(reason: RuntimeTaskSessionReviewReason): RuntimeTaskSessionState {
	if (reason === "interrupted") {
		return "interrupted";
	}
	return "awaiting_review";
}

function formatSpawnFailure(binary: string, error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const normalized = message.toLowerCase();
	if (normalized.includes("posix_spawnp failed") || normalized.includes("enoent")) {
		return `Failed to launch "${binary}". Command not found. Install the agent CLI, or set a custom absolute command path in Settings.`;
	}
	return `Failed to launch "${binary}": ${message}`;
}

function buildLaunchCommand(request: StartTaskSessionRequest): LaunchCommand {
	const args = [...request.args];
	const env: Record<string, string | undefined> = {};
	const prompt = request.prompt.trim();

	if (request.agentId === "claude") {
		if (request.startInPlanMode) {
			const withoutImmediateBypass = args.filter((arg) => arg !== "--dangerously-skip-permissions");
			args.length = 0;
			args.push(...withoutImmediateBypass);
			if (!args.includes("--allow-dangerously-skip-permissions")) {
				args.push("--allow-dangerously-skip-permissions");
			}
			args.push("--permission-mode", "plan");
		}
		if (prompt) {
			args.push(prompt);
			return {
				args,
				env,
				writesPromptInternally: true,
			};
		}
		return {
			args,
			env,
			writesPromptInternally: false,
		};
	}

	if (request.agentId === "codex") {
		if (prompt) {
			const initialPrompt = request.startInPlanMode ? `/plan\n${prompt}` : prompt;
			args.push(initialPrompt);
			return {
				args,
				env,
				writesPromptInternally: true,
			};
		}
		return {
			args,
			env,
			writesPromptInternally: false,
		};
	}

	if (request.agentId === "opencode") {
		if (request.startInPlanMode) {
			env.OPENCODE_EXPERIMENTAL_PLAN_MODE = "true";
		}
		if (prompt) {
			args.push("--prompt", prompt);
			return {
				args,
				env,
				writesPromptInternally: true,
			};
		}
		return {
			args,
			env,
			writesPromptInternally: false,
		};
	}

	if (request.agentId === "gemini") {
		if (request.startInPlanMode) {
			args.push("--approval-mode=plan");
		}
		if (prompt) {
			args.push("-i", prompt);
			return {
				args,
				env,
				writesPromptInternally: true,
			};
		}
		return {
			args,
			env,
			writesPromptInternally: false,
		};
	}

	return {
		args,
		env,
		writesPromptInternally: false,
	};
}

async function ensureNodePtySpawnHelperExecutable(): Promise<void> {
	if (ensurePtyHelperExecutablePromise) {
		return ensurePtyHelperExecutablePromise;
	}

	ensurePtyHelperExecutablePromise = (async () => {
		try {
			const packageJsonPath = require.resolve("node-pty/package.json");
			const packageRoot = dirname(packageJsonPath);
			const helperCandidates = [
				join(packageRoot, "build/Release/spawn-helper"),
				join(packageRoot, "build/Debug/spawn-helper"),
				join(packageRoot, `prebuilds/${process.platform}-${process.arch}/spawn-helper`),
			];

			for (const helperPath of helperCandidates) {
				try {
					await access(helperPath, fsConstants.F_OK);
				} catch {
					continue;
				}

				try {
					await access(helperPath, fsConstants.X_OK);
					return;
				} catch {
					// Continue to chmod attempt.
				}

				try {
					await chmod(helperPath, 0o755);
				} catch {
					// Best effort; spawn will still surface a useful error if this fails.
				}
				return;
			}
		} catch {
			// Best effort; if resolution fails, spawn path will report a runtime error.
		}
	})();

	return ensurePtyHelperExecutablePromise;
}

export class TerminalSessionManager {
	private readonly entries = new Map<string, SessionEntry>();
	private readonly summaryListeners = new Set<(summary: RuntimeTaskSessionSummary) => void>();

	hydrateFromRecord(record: Record<string, RuntimeTaskSessionSummary>): void {
		for (const [taskId, summary] of Object.entries(record)) {
			this.entries.set(taskId, {
				summary: cloneSummary(summary),
				active: null,
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
		const entry = this.entries.get(taskId);
		if (!entry) {
			return null;
		}

		listener.onState?.(cloneSummary(entry.summary));
		for (const chunk of entry.active?.outputHistory ?? []) {
			listener.onOutput?.(chunk);
		}
		if (!entry.active && entry.summary.exitCode !== null) {
			listener.onExit?.(entry.summary.exitCode);
		}

		if (!entry.active) {
			return () => {
				// No-op for inactive sessions.
			};
		}

		const listenerId = entry.active.listenerIdCounter;
		entry.active.listenerIdCounter += 1;
		entry.active.listeners.set(listenerId, listener);

		return () => {
			entry.active?.listeners.delete(listenerId);
		};
	}

	async startTaskSession(request: StartTaskSessionRequest): Promise<RuntimeTaskSessionSummary> {
		const entry = this.ensureEntry(request.taskId);
		if (entry.active && isActiveState(entry.summary.state)) {
			return cloneSummary(entry.summary);
		}

		if (entry.active) {
			terminatePtyProcess(entry.active);
			entry.active = null;
		}

		const cols = Number.isFinite(request.cols) && (request.cols ?? 0) > 0 ? Math.floor(request.cols ?? 0) : 120;
		const rows = Number.isFinite(request.rows) && (request.rows ?? 0) > 0 ? Math.floor(request.rows ?? 0) : 40;
		const launch = buildLaunchCommand(request);
		const env = {
			...process.env,
			...request.env,
			...launch.env,
			TERM: "xterm-256color",
			COLORTERM: "truecolor",
		};

		await ensureNodePtySpawnHelperExecutable();

		let ptyProcess: pty.IPty;
		try {
			ptyProcess = pty.spawn(request.binary, launch.args, {
				name: "xterm-256color",
				cwd: request.cwd,
				env,
				cols,
				rows,
			});
		} catch (error) {
			const summary = updateSummary(entry, {
				state: "failed",
				agentId: request.agentId,
				workspacePath: request.cwd,
				pid: null,
				startedAt: null,
				lastOutputAt: null,
				lastActivityLine: null,
				reviewReason: "error",
				exitCode: null,
			});
			this.emitSummary(summary);
			throw new Error(formatSpawnFailure(request.binary, error));
		}

		const active: ActiveProcessState = {
			ptyProcess,
			outputHistory: [],
			historyBytes: 0,
			listenerIdCounter: 1,
			listeners: new Map(),
			attentionBuffer: "",
			shutdownInterrupted: false,
		};
		entry.active = active;

		const startedAt = now();
		updateSummary(entry, {
			state: "running",
			agentId: request.agentId,
			workspacePath: request.cwd,
			pid: ptyProcess.pid,
			startedAt,
			lastOutputAt: null,
			lastActivityLine: null,
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

			entry.active.attentionBuffer += data;
			if (entry.active.attentionBuffer.length > 8192) {
				entry.active.attentionBuffer = entry.active.attentionBuffer.slice(-8192);
			}

			const lastActivityLine = extractLastActivityLine(entry.active.attentionBuffer);
			const needsAttention = detectNeedsAttention(entry.active.attentionBuffer);
			const nextPatch: Partial<RuntimeTaskSessionSummary> = {
				lastOutputAt: now(),
				lastActivityLine,
			};

			if (entry.summary.state === "running" && needsAttention) {
				nextPatch.state = "awaiting_review";
				nextPatch.reviewReason = "attention";
			}

			const summary = updateSummary(entry, nextPatch);
			for (const taskListener of entry.active.listeners.values()) {
				taskListener.onOutput?.(chunk);
				taskListener.onState?.(cloneSummary(summary));
			}
			this.emitSummary(summary);
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

			let reason: RuntimeTaskSessionReviewReason = event.exitCode === 0 ? "exit" : "error";
			if (currentActive.shutdownInterrupted) {
				reason = "interrupted";
			}
			const state = makeReviewState(reason);
			const summary = updateSummary(currentEntry, {
				state,
				reviewReason: reason,
				exitCode: event.exitCode,
				pid: null,
			});

			for (const taskListener of currentActive.listeners.values()) {
				taskListener.onState?.(cloneSummary(summary));
				taskListener.onExit?.(event.exitCode);
			}
			currentEntry.active = null;
			this.emitSummary(summary);
		});

		const trimmedPrompt = request.prompt.trim();
		if (trimmedPrompt && !launch.writesPromptInternally) {
			setTimeout(() => {
				const runningEntry = this.entries.get(request.taskId);
				if (!runningEntry?.active) {
					return;
				}
				runningEntry.active.ptyProcess.write(trimmedPrompt);
				runningEntry.active.ptyProcess.write("\r");
			}, 650);
		}

		return cloneSummary(entry.summary);
	}

	writeInput(taskId: string, data: Buffer): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return null;
		}
		entry.active.ptyProcess.write(data.toString("utf8"));
		const patch: Partial<RuntimeTaskSessionSummary> = {};
		if (entry.summary.state === "awaiting_review" && entry.summary.reviewReason === "attention") {
			patch.state = "running";
			patch.reviewReason = null;
		}
		const summary = updateSummary(entry, patch);
		this.emitSummary(summary);
		for (const listener of entry.active.listeners.values()) {
			listener.onState?.(cloneSummary(summary));
		}
		return cloneSummary(summary);
	}

	resize(taskId: string, cols: number, rows: number): boolean {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return false;
		}
		const safeCols = Math.max(1, Math.floor(cols));
		const safeRows = Math.max(1, Math.floor(rows));
		entry.active.ptyProcess.resize(safeCols, safeRows);
		return true;
	}

	stopTaskSession(taskId: string): RuntimeTaskSessionSummary | null {
		const entry = this.entries.get(taskId);
		if (!entry?.active) {
			return entry ? cloneSummary(entry.summary) : null;
		}
		terminatePtyProcess(entry.active);
		return cloneSummary(entry.summary);
	}

	markInterruptedAndStopAll(): RuntimeTaskSessionSummary[] {
		const activeEntries = Array.from(this.entries.values()).filter((entry) => entry.active != null);
		for (const entry of activeEntries) {
			if (!entry.active) {
				continue;
			}
			entry.active.shutdownInterrupted = true;
			terminatePtyProcess(entry.active);
		}
		return activeEntries.map((entry) => cloneSummary(entry.summary));
	}

	private ensureEntry(taskId: string): SessionEntry {
		const existing = this.entries.get(taskId);
		if (existing) {
			return existing;
		}
		const created: SessionEntry = {
			summary: createDefaultSummary(taskId),
			active: null,
		};
		this.entries.set(taskId, created);
		return created;
	}

	private emitSummary(summary: RuntimeTaskSessionSummary): void {
		const snapshot = cloneSummary(summary);
		for (const listener of this.summaryListeners) {
			listener(snapshot);
		}
	}
}
