import { describe, expect, it } from "vitest";

import {
	normalizeAutomaticCardSummary,
	shouldAutoDraftCardSummary,
} from "../../../src/cline-sdk/cline-task-session-service";
import { RUNTIME_CARD_SUMMARY_MAX_CHARS, type RuntimeTaskSessionSummary } from "../../../src/core/api-contract";

function createSummary(overrides: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary {
	return {
		taskId: "task-1",
		state: "idle",
		mode: "act",
		agentId: "cline",
		workspacePath: "/test/workspace",
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
		warningMessage: null,
		latestTurnCheckpoint: null,
		previousTurnCheckpoint: null,
		...overrides,
	};
}

function createCompletedSummary(overrides: Partial<RuntimeTaskSessionSummary> = {}): RuntimeTaskSessionSummary {
	return createSummary({
		state: "awaiting_review",
		reviewReason: "attention",
		latestHookActivity: {
			activityText: "Task complete",
			toolName: null,
			toolInputSummary: null,
			finalMessage: "Completed successfully",
			hookEventName: "turn_complete",
			notificationType: null,
			source: "cline-sdk",
		},
		...overrides,
	});
}

describe("automatic card summary policy", () => {
	it("drafts on a successful transition to awaiting review", () => {
		expect(shouldAutoDraftCardSummary(createSummary({ state: "running" }), createCompletedSummary(), false)).toBe(
			true,
		);
	});

	it("drafts when the final message arrives after the transition to awaiting review", () => {
		const awaitingFinalMessage = createCompletedSummary({ latestHookActivity: null });
		expect(shouldAutoDraftCardSummary(awaitingFinalMessage, createCompletedSummary(), false)).toBe(true);
	});

	it.each([
		["not awaiting review", createSummary({ state: "running" })],
		["interrupted completion", createCompletedSummary({ reviewReason: "interrupted" })],
	] as const)("does not draft for %s", (_name, latestSummary) => {
		expect(shouldAutoDraftCardSummary(createSummary({ state: "running" }), latestSummary, false)).toBe(false);
	});

	it("drafts a failed attempt when its final message records what was tried", () => {
		expect(
			shouldAutoDraftCardSummary(
				createSummary({ state: "running" }),
				createCompletedSummary({ reviewReason: "error" }),
				false,
			),
		).toBe(true);
	});

	it("does not draft an empty final message", () => {
		const completed = createCompletedSummary();
		const latestHookActivity = completed.latestHookActivity;
		expect(latestHookActivity).not.toBeNull();
		if (!latestHookActivity) {
			return;
		}
		const emptyCompletion = createCompletedSummary({
			latestHookActivity: { ...latestHookActivity, finalMessage: "  " },
		});
		expect(shouldAutoDraftCardSummary(createSummary({ state: "running" }), emptyCompletion, false)).toBe(false);
	});

	it("does not draft duplicate events or repeated awaiting-review state", () => {
		const completed = createCompletedSummary();
		expect(shouldAutoDraftCardSummary(createSummary({ state: "running" }), completed, true)).toBe(false);
		expect(shouldAutoDraftCardSummary(completed, completed, false)).toBe(false);
	});

	it("normalizes line endings and repeated blank lines", () => {
		expect(normalizeAutomaticCardSummary("  Line 1\r\n\r\n\r\nLine 2\n\n\nLine 3  ")).toBe(
			"Line 1\n\nLine 2\n\nLine 3",
		);
	});

	it("bounds automatic summaries", () => {
		expect(normalizeAutomaticCardSummary("x".repeat(RUNTIME_CARD_SUMMARY_MAX_CHARS + 100))).toHaveLength(
			RUNTIME_CARD_SUMMARY_MAX_CHARS,
		);
	});
});
