import { describe, expect, it, vi } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/runtime/api-contract.js";
import { TerminalSessionManager } from "../../../src/runtime/terminal/session-manager.js";

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
		lastActivityLine: "existing preview",
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
				applySessionEvent: (sessionEntry: unknown, event: { type: "hook.review" }) => RuntimeTaskSessionSummary;
			}
		).applySessionEvent;
		const nextSummary = applySessionEvent(entry, { type: "hook.review" });
		expect(nextSummary.state).toBe("awaiting_review");
		expect(entry.active.claudeTrustBuffer).toBe("");
		expect(reset).not.toHaveBeenCalled();
	});

	it("publishes the latest parsed preview value, including clearing to empty", () => {
		const manager = new TerminalSessionManager();
		const extract = vi.fn<() => string | null>().mockReturnValue(null);
		const onState = vi.fn();
		const entry = {
			summary: createSummary({ lastActivityLine: "previous line" }),
			active: {
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
		const publishLatestActivityLine = (
			manager as unknown as {
				publishLatestActivityLine: (sessionEntry: unknown, activeState: unknown) => void;
			}
		).publishLatestActivityLine.bind(manager);
		publishLatestActivityLine(entry, active);
		expect(entry.summary.lastActivityLine).toBeNull();
		expect(onState).toHaveBeenCalledTimes(1);
	});
});
