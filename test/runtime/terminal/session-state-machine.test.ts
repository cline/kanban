import { describe, expect, it } from "vitest";

import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { reduceSessionTransition, type SessionTransitionEvent } from "../../../src/terminal/session-state-machine";

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
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		...overrides,
	};
}

describe("reduceSessionTransition", () => {
	it("hook.to_review moves a running session to awaiting_review with reason hook", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "hook.to_review" });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "awaiting_review", reviewReason: "hook" });
		expect(result.clearAttentionBuffer).toBe(true);
	});

	it("hook.to_review is a no-op when the session is not running", () => {
		const summary = createSummary({ state: "awaiting_review", reviewReason: "attention" });
		const result = reduceSessionTransition(summary, { type: "hook.to_review" });

		expect(result).toEqual({ changed: false, patch: {}, clearAttentionBuffer: false });
	});

	it("hook.to_in_progress returns an awaiting_review session with a resumable reason to running", () => {
		const summary = createSummary({ state: "awaiting_review", reviewReason: "attention" });
		const result = reduceSessionTransition(summary, { type: "hook.to_in_progress" });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "running", reviewReason: null });
		expect(result.clearAttentionBuffer).toBe(true);
	});

	it("hook.to_in_progress treats reviewReason error as resumable and returns the session to running", () => {
		const summary = createSummary({ state: "awaiting_review", reviewReason: "error" });
		const result = reduceSessionTransition(summary, { type: "hook.to_in_progress" });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "running", reviewReason: null });
		expect(result.clearAttentionBuffer).toBe(true);
	});

	it("hook.to_in_progress is a no-op when the review reason cannot return to running", () => {
		const summary = createSummary({ state: "awaiting_review", reviewReason: "exit" });
		const result = reduceSessionTransition(summary, { type: "hook.to_in_progress" });

		expect(result).toEqual({ changed: false, patch: {}, clearAttentionBuffer: false });
	});

	it("hook.to_in_progress is a no-op when the session is not awaiting review", () => {
		const summary = createSummary({ state: "running", reviewReason: null });
		const result = reduceSessionTransition(summary, { type: "hook.to_in_progress" });

		expect(result).toEqual({ changed: false, patch: {}, clearAttentionBuffer: false });
	});

	it("agent.prompt-ready returns an awaiting_review session with a resumable reason to running", () => {
		const summary = createSummary({ state: "awaiting_review", reviewReason: "hook" });
		const result = reduceSessionTransition(summary, { type: "agent.prompt-ready" });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "running", reviewReason: null });
		expect(result.clearAttentionBuffer).toBe(true);
	});

	it("agent.prompt-ready is a no-op when the review reason cannot return to running", () => {
		const summary = createSummary({ state: "awaiting_review", reviewReason: "interrupted" });
		const result = reduceSessionTransition(summary, { type: "agent.prompt-ready" });

		expect(result).toEqual({ changed: false, patch: {}, clearAttentionBuffer: false });
	});

	it("process.exit with exit code 0 and no interruption sets reviewReason exit", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "process.exit", exitCode: 0, interrupted: false });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "awaiting_review", reviewReason: "exit", exitCode: 0, pid: null });
		expect(result.clearAttentionBuffer).toBe(false);
	});

	it("process.exit with exit code 1 and no interruption sets reviewReason error", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "process.exit", exitCode: 1, interrupted: false });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "awaiting_review", reviewReason: "error", exitCode: 1, pid: null });
		expect(result.clearAttentionBuffer).toBe(false);
	});

	it("process.exit with exit code 137 and no interruption sets reviewReason error", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "process.exit", exitCode: 137, interrupted: false });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "awaiting_review", reviewReason: "error", exitCode: 137, pid: null });
		expect(result.clearAttentionBuffer).toBe(false);
	});

	it("process.exit with a null exit code and no interruption sets reviewReason error", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "process.exit", exitCode: null, interrupted: false });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "awaiting_review", reviewReason: "error", exitCode: null, pid: null });
		expect(result.clearAttentionBuffer).toBe(false);
	});

	it("process.exit with interrupted true overrides a zero exit code to reviewReason interrupted", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "process.exit", exitCode: 0, interrupted: true });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "interrupted", reviewReason: "interrupted", exitCode: 0, pid: null });
		expect(result.clearAttentionBuffer).toBe(false);
	});

	it("process.exit with interrupted true overrides a nonzero exit code to reviewReason interrupted", () => {
		const summary = createSummary({ state: "running" });
		const result = reduceSessionTransition(summary, { type: "process.exit", exitCode: 1, interrupted: true });

		expect(result.changed).toBe(true);
		expect(result.patch).toEqual({ state: "interrupted", reviewReason: "interrupted", exitCode: 1, pid: null });
		expect(result.clearAttentionBuffer).toBe(false);
	});

	it("is a no-op for an event type outside the known union", () => {
		const summary = createSummary({ state: "running" });
		const unknownEvent = { type: "unknown.event" } as unknown as SessionTransitionEvent;
		const result = reduceSessionTransition(summary, unknownEvent);

		expect(result).toEqual({ changed: false, patch: {}, clearAttentionBuffer: false });
	});
});
