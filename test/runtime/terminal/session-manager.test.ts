import { describe, expect, it, vi } from "vitest";

import type { CodexHostNotification, CodexHostService } from "../../../src/codex-sdk/global-codex-host-service";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { buildShellCommandLine } from "../../../src/core/shell";
import { PtySession } from "../../../src/terminal/pty-session";
import { TerminalSessionManager } from "../../../src/terminal/session-manager";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		agentSessionId: null,
		workspacePath: "/tmp/worktree",
		lastKnownWorkspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		terminalRestoreSnapshot: null,
		...overrides,
	};
}

describe("TerminalSessionManager", () => {
	it("routes new Codex tasks through the shared host and supports follow-up input", async () => {
		const threadListeners = new Map<string, (notification: CodexHostNotification) => void>();
		const startThread = vi.fn(async () => ({
			threadId: "thread-1",
			cwd: "/tmp/codex-worktree",
		}));
		const startTurn = vi.fn().mockResolvedValueOnce({ turnId: "turn-1" }).mockResolvedValueOnce({ turnId: "turn-2" });
		const interruptTurn = vi.fn(async () => undefined);
		const releaseThread = vi.fn();
		const host: CodexHostService = {
			getPid: () => 777,
			start: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
			startThread,
			resumeThread: vi.fn(async () => ({
				threadId: "thread-resume-unused",
				cwd: "/tmp/codex-worktree",
			})),
			startTurn,
			interruptTurn,
			releaseThread,
			subscribe: (threadId, listener) => {
				threadListeners.set(threadId, listener);
				return () => {
					threadListeners.delete(threadId);
				};
			},
		};
		const manager = new TerminalSessionManager(host);
		const onOutput = vi.fn();
		manager.attach("task-codex", {
			onOutput,
			onState: vi.fn(),
			onExit: vi.fn(),
		});

		const started = await manager.startTaskSession({
			taskId: "task-codex",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/codex-worktree",
			prompt: "say hello",
			resumeFromTrash: false,
		});

		expect(startThread).toHaveBeenCalledTimes(1);
		expect(startTurn).toHaveBeenCalledWith({
			threadId: "thread-1",
			prompt: "say hello",
			cwd: "/tmp/codex-worktree",
		});
		expect(started.agentId).toBe("codex");
		expect(started.pid).toBe(777);
		expect(onOutput).toHaveBeenCalledWith(Buffer.from("› say hello\r\n\r\n", "utf8"));

		threadListeners.get("thread-1")?.({
			method: "item/agentMessage/delta",
			threadId: "thread-1",
			turnId: "turn-1",
			delta: "hello",
		});
		threadListeners.get("thread-1")?.({
			method: "turn/completed",
			threadId: "thread-1",
			turnId: "turn-1",
			status: "completed",
			errorMessage: null,
		});

		const afterFirstTurn = manager.getSummary("task-codex");
		expect(afterFirstTurn?.state).toBe("awaiting_review");
		expect(afterFirstTurn?.reviewReason).toBe("attention");

		manager.writeInput("task-codex", Buffer.from("next\n", "utf8"));
		await Promise.resolve();

		expect(startTurn).toHaveBeenLastCalledWith({
			threadId: "thread-1",
			prompt: "next",
			cwd: "/tmp/codex-worktree",
		});
		expect(manager.getSummary("task-codex")?.state).toBe("running");

		const stopped = manager.stopTaskSession("task-codex");
		expect(interruptTurn).toHaveBeenCalledWith("thread-1", "turn-2");
		expect(releaseThread).toHaveBeenCalledWith("thread-1");
		expect(stopped?.state).toBe("interrupted");
	});

	it("keeps Codex trash restore on the existing PTY path when no persisted thread id exists", async () => {
		const startThread = vi.fn(async () => ({
			threadId: "thread-restore",
			cwd: "/tmp/codex-worktree",
		}));
		const resumeThread = vi.fn(async () => ({
			threadId: "thread-restore",
			cwd: "/tmp/codex-worktree",
		}));
		const host: CodexHostService = {
			getPid: () => 777,
			start: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
			startThread,
			resumeThread,
			startTurn: vi.fn(async () => ({ turnId: "turn-1" })),
			interruptTurn: vi.fn(async () => undefined),
			releaseThread: vi.fn(),
			subscribe: () => () => {},
		};
		const manager = new TerminalSessionManager(host);

		const startCodexHostTaskSession = vi.spyOn(
			manager as unknown as { startCodexHostTaskSession: (request: unknown) => Promise<RuntimeTaskSessionSummary> },
			"startCodexHostTaskSession",
		);
		const spawnSpy = vi.spyOn(PtySession, "spawn").mockImplementation(() => {
			throw new Error("spawn blocked");
		});

		await expect(
			manager.startTaskSession({
				taskId: "task-codex-restore",
				agentId: "codex",
				binary: "codex",
				args: [],
				cwd: "/tmp/codex-worktree",
				prompt: "say hello",
				resumeFromTrash: true,
			}),
		).rejects.toThrow('Failed to launch "codex": spawn blocked');
		expect(startCodexHostTaskSession).not.toHaveBeenCalled();
		expect(startThread).not.toHaveBeenCalled();
		expect(resumeThread).not.toHaveBeenCalled();
		spawnSpy.mockRestore();
	});

	it("resumes Codex trash restore on the shared host when a persisted thread id exists", async () => {
		const threadListeners = new Map<string, (notification: CodexHostNotification) => void>();
		const startThread = vi.fn(async () => ({
			threadId: "thread-start",
			cwd: "/tmp/codex-worktree",
		}));
		const resumeThread = vi.fn(async () => ({
			threadId: "thread-persisted",
			cwd: "/tmp/codex-worktree",
		}));
		const startTurn = vi.fn(async () => ({ turnId: "turn-2" }));
		const host: CodexHostService = {
			getPid: () => 777,
			start: vi.fn(async () => undefined),
			dispose: vi.fn(async () => undefined),
			startThread,
			resumeThread,
			startTurn,
			interruptTurn: vi.fn(async () => undefined),
			releaseThread: vi.fn(),
			subscribe: (threadId, listener) => {
				threadListeners.set(threadId, listener);
				return () => {
					threadListeners.delete(threadId);
				};
			},
		};
		const manager = new TerminalSessionManager(host);
		manager.hydrateFromRecord({
			"task-codex-restore": createSummary({
				taskId: "task-codex-restore",
				agentId: "codex",
				agentSessionId: "thread-persisted",
				state: "interrupted",
				terminalRestoreSnapshot: {
					snapshot: "persisted terminal",
					cols: 120,
					rows: 40,
				},
			}),
		});

		const restored = await manager.startTaskSession({
			taskId: "task-codex-restore",
			agentId: "codex",
			binary: "codex",
			args: [],
			cwd: "/tmp/codex-worktree",
			prompt: "",
			resumeFromTrash: true,
		});

		expect(resumeThread).toHaveBeenCalledWith({
			threadId: "thread-persisted",
			cwd: "/tmp/codex-worktree",
			developerInstructions: undefined,
			approvalMode: "deny",
			autonomousModeEnabled: false,
		});
		expect(startThread).not.toHaveBeenCalled();
		expect(startTurn).not.toHaveBeenCalled();
		expect(restored.state).toBe("awaiting_review");
		expect(restored.reviewReason).toBe("attention");
		expect(restored.agentSessionId).toBe("thread-persisted");

		manager.writeInput("task-codex-restore", Buffer.from("next\n", "utf8"));
		await Promise.resolve();

		expect(startTurn).toHaveBeenCalledWith({
			threadId: "thread-persisted",
			prompt: "next",
			cwd: "/tmp/codex-worktree",
		});
	});

	it("clears trust prompt state when transitioning to review", () => {
		const manager = new TerminalSessionManager();
		const entry = {
			summary: createSummary({ state: "running", reviewReason: null }),
			active: {
				workspaceTrustBuffer: "trust this folder",
				awaitingCodexPromptAfterEnter: true,
			},
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		const applySessionEvent = (
			manager as unknown as {
				applySessionEvent: (sessionEntry: unknown, event: { type: "hook.to_review" }) => RuntimeTaskSessionSummary;
			}
		).applySessionEvent;
		const nextSummary = applySessionEvent(entry, { type: "hook.to_review" });
		expect(nextSummary.state).toBe("awaiting_review");
		expect(entry.active.workspaceTrustBuffer).toBe("");
	});

	it("builds shell kickoff command lines with quoted arguments", () => {
		const commandLine = buildShellCommandLine("cline", ["--auto-approve-all", "hello world"]);
		expect(commandLine).toContain("cline");
		expect(commandLine).toContain("--auto-approve-all");
		expect(commandLine).toContain("hello world");
	});

	it("stores hook activity metadata on sessions", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "running" }),
		});

		const updated = manager.applyHookActivity("task-1", {
			source: "claude",
			activityText: "Using Read",
			toolName: "Read",
		});

		expect(updated?.latestHookActivity?.source).toBe("claude");
		expect(updated?.latestHookActivity?.activityText).toBe("Using Read");
		expect(updated?.latestHookActivity?.toolName).toBe("Read");
		expect(typeof updated?.lastHookAt).toBe("number");
	});

	it("resets stale running sessions without active processes", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "running" }),
		});

		const recovered = manager.recoverStaleSession("task-1");

		expect(recovered?.state).toBe("idle");
		expect(recovered?.pid).toBeNull();
		expect(recovered?.agentId).toBe("claude");
		expect(recovered?.workspacePath).toBeNull();
		expect(recovered?.reviewReason).toBeNull();
	});

	it("tracks only the latest two turn checkpoints", () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-1": createSummary({ state: "running" }),
		});

		manager.applyTurnCheckpoint("task-1", {
			turn: 1,
			ref: "refs/kanban/checkpoints/task-1/turn/1",
			commit: "1111111",
			createdAt: 1,
		});
		manager.applyTurnCheckpoint("task-1", {
			turn: 2,
			ref: "refs/kanban/checkpoints/task-1/turn/2",
			commit: "2222222",
			createdAt: 2,
		});

		const summary = manager.getSummary("task-1");
		expect(summary?.latestTurnCheckpoint?.turn).toBe(2);
		expect(summary?.previousTurnCheckpoint?.turn).toBe(1);
	});

	it("does not replay raw PTY history when attaching an output listener", () => {
		const manager = new TerminalSessionManager();
		const onOutput = vi.fn();
		const entry = {
			summary: createSummary({ taskId: "task-probe", state: "running" }),
			active: {
				session: {},
				terminalProtocolFilter: {
					pendingChunk: null,
					interceptOscColorQueries: true,
					suppressDeviceAttributeQueries: false,
				},
			},
			terminalStateMirror: null,
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-probe", entry);

		manager.attach("task-probe", {
			onOutput,
		});

		expect(onOutput).not.toHaveBeenCalled();
		expect(entry.active.terminalProtocolFilter.interceptOscColorQueries).toBe(false);
	});

	it("keeps the startup probe filter enabled when only a non-output listener attaches", () => {
		const manager = new TerminalSessionManager();
		const entry = {
			summary: createSummary({ taskId: "task-control-first", state: "running" }),
			active: {
				session: {
					write: vi.fn(),
				},
				terminalProtocolFilter: {
					pendingChunk: null,
					interceptOscColorQueries: true,
					suppressDeviceAttributeQueries: false,
				},
			},
			terminalStateMirror: null,
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-control-first", entry);

		manager.attach("task-control-first", {
			onState: vi.fn(),
			onExit: vi.fn(),
		});

		expect(entry.active.terminalProtocolFilter.interceptOscColorQueries).toBe(true);
		expect(entry.active.terminalProtocolFilter.pendingChunk).toBeNull();
	});

	it("forwards pixel dimensions through resize when provided", () => {
		const manager = new TerminalSessionManager();
		const resizeSpy = vi.fn();
		const resizeMirrorSpy = vi.fn();
		const entry = {
			summary: createSummary({ taskId: "task-resize", state: "running" }),
			active: {
				session: {
					resize: resizeSpy,
				},
				cols: 80,
				rows: 24,
			},
			terminalStateMirror: {
				resize: resizeMirrorSpy,
			},
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-resize", entry);

		const resized = manager.resize("task-resize", 100, 30, 1200, 720);
		expect(resized).toBe(true);
		expect(resizeSpy).toHaveBeenCalledWith(100, 30, 1200, 720);
		expect(resizeMirrorSpy).toHaveBeenCalledWith(100, 30);
	});

	it("returns the latest terminal restore snapshot when available", async () => {
		const manager = new TerminalSessionManager();
		const getSnapshotSpy = vi.fn(async () => ({
			snapshot: "serialized terminal",
			cols: 120,
			rows: 40,
		}));
		const entry = {
			summary: createSummary({ taskId: "task-restore", state: "running" }),
			active: null,
			terminalStateMirror: {
				getSnapshot: getSnapshotSpy,
			},
			listenerIdCounter: 1,
			listeners: new Map(),
		};
		(
			manager as unknown as {
				entries: Map<string, typeof entry>;
			}
		).entries.set("task-restore", entry);

		const snapshot = await manager.getRestoreSnapshot("task-restore");

		expect(snapshot).toEqual({
			snapshot: "serialized terminal",
			cols: 120,
			rows: 40,
		});
		expect(getSnapshotSpy).toHaveBeenCalledTimes(1);
	});

	it("falls back to the persisted terminal restore snapshot when no live mirror exists", async () => {
		const manager = new TerminalSessionManager();
		manager.hydrateFromRecord({
			"task-restore": createSummary({
				taskId: "task-restore",
				state: "awaiting_review",
				terminalRestoreSnapshot: {
					snapshot: "persisted terminal",
					cols: 120,
					rows: 40,
				},
			}),
		});

		const snapshot = await manager.getRestoreSnapshot("task-restore");

		expect(snapshot).toEqual({
			snapshot: "persisted terminal",
			cols: 120,
			rows: 40,
		});
	});
});
