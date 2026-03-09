import { describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract.js";
import { buildShellCommandLine } from "../../../src/core/shell.js";
import { TerminalSessionManager } from "../../../src/terminal/session-manager.js";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "running",
		agentId: "claude",
		workspacePath: "/tmp/worktree",
		pid: 1234,
		startedAt: Date.now(),
		updatedAt: Date.now(),
		lastOutputAt: Date.now(),
		activityPreview: "existing preview",
		reviewReason: null,
		exitCode: null,
		...overrides,
	};
}

describe("TerminalSessionManager preview behavior", () => {
	it("does not reset activity preview tracker when transitioning to review", () => {
		const manager = new TerminalSessionManager();
		const reset = vi.fn();
		const entry = {
			summary: createSummary({ state: "running", reviewReason: null }),
			active: {
				claudeTrustBuffer: "trust this folder",
				awaitingCodexPromptAfterEnter: true,
				activityPreviewChunkBuffer: "",
				activityPreviewTracker: {
					append: vi.fn(),
					resize: vi.fn(),
					extract: vi.fn(() => "latest line"),
					reset,
				},
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
		expect(entry.active.claudeTrustBuffer).toBe("");
		expect(reset).not.toHaveBeenCalled();
	});

	it("publishes the latest parsed preview value, including clearing to empty", () => {
		const manager = new TerminalSessionManager();
		const extract = vi.fn<() => string | null>().mockReturnValue(null);
		const onState = vi.fn();
		const entry = {
			summary: createSummary({ activityPreview: "previous line" }),
			active: {
				activityPreviewChunkBuffer: "",
				activityPreviewTracker: {
					append: vi.fn(),
					resize: vi.fn(),
					extract,
					reset: vi.fn(),
				},
			},
			listenerIdCounter: 1,
			listeners: new Map([
				[
					1,
					{
						onState,
					},
				],
			]),
		};
		const active = entry.active;
		const publishLatestActivityPreview = (
			manager as unknown as {
				publishLatestActivityPreview: (sessionEntry: unknown, activeState: unknown) => void;
			}
		).publishLatestActivityPreview.bind(manager);
		publishLatestActivityPreview(entry, active);
		expect(entry.summary.activityPreview).toBeNull();
		expect(onState).toHaveBeenCalledTimes(1);
	});

	it("flushes queued activity chunks before extracting preview", () => {
		const manager = new TerminalSessionManager();
		const append = vi.fn();
		const extract = vi.fn<() => string | null>().mockReturnValue("parsed line");
		const onState = vi.fn();
		const entry = {
			summary: createSummary({ activityPreview: null }),
			active: {
				activityPreviewChunkBuffer: "chunk-achunk-b",
				activityPreviewTracker: {
					append,
					resize: vi.fn(),
					extract,
				},
			},
			listenerIdCounter: 1,
			listeners: new Map([
				[
					1,
					{
						onState,
					},
				],
			]),
		};
		const active = entry.active;
		const publishLatestActivityPreview = (
			manager as unknown as {
				publishLatestActivityPreview: (sessionEntry: unknown, activeState: unknown) => void;
			}
		).publishLatestActivityPreview.bind(manager);
		publishLatestActivityPreview(entry, active);
		expect(append).toHaveBeenCalledWith("chunk-achunk-b");
		expect(entry.active.activityPreviewChunkBuffer).toBe("");
		expect(entry.summary.activityPreview).toBe("parsed line");
		expect(onState).toHaveBeenCalledTimes(1);
	});

	it("builds shell kickoff command lines with quoted arguments", () => {
		const commandLine = buildShellCommandLine("cline", ["--auto-approve-all", "hello world"]);
		expect(commandLine).toContain("cline");
		expect(commandLine).toContain("--auto-approve-all");
		expect(commandLine).toContain("hello world");
	});
});
