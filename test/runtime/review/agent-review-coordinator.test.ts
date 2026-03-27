import { describe, expect, it, vi } from "vitest";

import { createAgentReviewCoordinator, type AgentReviewTaskSnapshot } from "../../../src/review/agent-review-coordinator.js";

function createSnapshot(): AgentReviewTaskSnapshot {
	return {
		workspaceId: "workspace-1",
		workspacePath: "/tmp/workspace",
		taskId: "task-1",
		taskPrompt: "Fix the broken flow",
		baseRef: "main",
		currentColumnId: "review",
		originalAgentId: "claude",
		existingState: null,
		policy: {
			enabled: true,
			maxRounds: 2,
		},
		requirementsReference: "Task prompt:\nFix the broken flow",
	};
}

describe("createAgentReviewCoordinator", () => {
	it("sends the follow-up prompt and moves the task back to in progress when review requests changes", async () => {
		const operations: string[] = [];
		const persistState = vi.fn(async (input: { state: { status: string } }) => {
			operations.push(`persist:${input.state.status}`);
		});
		const sendFollowUpToOriginalAgent = vi.fn(async () => {
			operations.push("send");
			return { ok: true };
		});
		const resumeTaskAfterChangesRequested = vi.fn(async () => {
			operations.push("resume");
		});

		const coordinator = createAgentReviewCoordinator({
			resolveLaunchCommand: async () => ({
				agentId: "claude",
				binary: "claude",
				args: ["--dangerously-skip-permissions"],
				autonomousModeEnabled: true,
			}),
			persistState,
			sendFollowUpToOriginalAgent,
			resumeTaskAfterChangesRequested,
			runReviewRound: async () => ({
				reportPath: "/tmp/workspace/CODE_REVIEW.md",
				baseSha: "abc",
				headSha: "def",
				reviewedRef: "HEAD",
				output: "review output",
				exitCode: 0,
				document: {
					taskId: "task-1",
					runId: "run-1",
					rounds: [],
				},
				latestRound: {
					round: 1,
					reviewerAgentId: "claude",
					reviewedRef: "HEAD",
					decision: "changes_requested",
					summary: "Needs fixes",
					findings: [
						{
							severity: "important",
							title: "Fix needed",
							file: "src/file.ts",
							detail: "Something is wrong",
						},
					],
					nextStep: "Read CODE_REVIEW.md and fix the reported issues.",
				},
			}),
		});

		const result = await coordinator.executeRound(createSnapshot(), "automatic");

		expect(result.ok).toBe(true);
		expect(result.state.status).toBe("changes_requested");
		expect(result.followUpPrompt).toContain("Open /tmp/workspace/CODE_REVIEW.md");
		expect(result.followUpPrompt).toContain("hand the task back for review");
		expect(sendFollowUpToOriginalAgent).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: "task-1",
			text: expect.stringContaining("Open /tmp/workspace/CODE_REVIEW.md"),
		});
		expect(resumeTaskAfterChangesRequested).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: "task-1",
		});
		expect(persistState.mock.calls.at(-1)?.[0]?.state.status).toBe("changes_requested");
		expect(operations).toEqual(["persist:pending", "persist:reviewing", "persist:changes_requested", "send", "resume"]);
	});

	it("does not move the task when sending the follow-up prompt fails", async () => {
		const resumeTaskAfterChangesRequested = vi.fn(async () => {});

		const coordinator = createAgentReviewCoordinator({
			resolveLaunchCommand: async () => ({
				agentId: "claude",
				binary: "claude",
				args: ["--dangerously-skip-permissions"],
				autonomousModeEnabled: true,
			}),
			persistState: async () => {},
			sendFollowUpToOriginalAgent: async () => ({ ok: false, message: "not running" }),
			resumeTaskAfterChangesRequested,
			runReviewRound: async () => ({
				reportPath: "/tmp/workspace/CODE_REVIEW.md",
				baseSha: "abc",
				headSha: "def",
				reviewedRef: "HEAD",
				output: "review output",
				exitCode: 0,
				document: {
					taskId: "task-1",
					runId: "run-1",
					rounds: [],
				},
				latestRound: {
					round: 1,
					reviewerAgentId: "claude",
					reviewedRef: "HEAD",
					decision: "changes_requested",
					summary: "Needs fixes",
					findings: [],
					nextStep: "Read CODE_REVIEW.md and fix the reported issues.",
				},
			}),
		});

		const result = await coordinator.executeRound(createSnapshot(), "automatic");

		expect(result.ok).toBe(true);
		expect(result.followUpSent).toBe(false);
		expect(resumeTaskAfterChangesRequested).not.toHaveBeenCalled();
	});

	it("records a fallback changes-requested round when the reviewer exits without writing CODE_REVIEW.md", async () => {
		const persistState = vi.fn(async () => {});
		const sendFollowUpToOriginalAgent = vi.fn(async () => ({ ok: true }));
		const resumeTaskAfterChangesRequested = vi.fn(async () => {});
		const recordFallbackRound = vi.fn(async () => ({
			taskId: "task-1",
			runId: "run-1",
			rounds: [
				{
					round: 1,
					reviewerAgentId: "claude",
					reviewedRef: "HEAD",
					decision: "changes_requested" as const,
					summary: "Fallback review recorded",
					findings: [
						{
							severity: "important" as const,
							title: "Reviewer output could not be parsed into CODE_REVIEW.md",
							file: null,
							detail: "Inspect the final reviewer output and apply the requested fixes.",
						},
					],
					nextStep: "Read CODE_REVIEW.md and apply the reviewer-requested fixes.",
				},
			],
		}));

		const coordinator = createAgentReviewCoordinator({
			resolveLaunchCommand: async () => ({
				agentId: "claude",
				binary: "claude",
				args: ["--dangerously-skip-permissions"],
				autonomousModeEnabled: true,
			}),
			persistState,
			sendFollowUpToOriginalAgent,
			resumeTaskAfterChangesRequested,
			recordFallbackRound,
			runReviewRound: async () => {
				throw new Error("Reviewer did not produce a parseable CODE_REVIEW.md entry for round 1.");
			},
		});

		const result = await coordinator.executeRound(createSnapshot(), "automatic");

		expect(result.ok).toBe(true);
		expect(result.state.status).toBe("changes_requested");
		expect(recordFallbackRound).toHaveBeenCalled();
		expect(sendFollowUpToOriginalAgent).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: "task-1",
			text: expect.stringContaining("Open /tmp/workspace/CODE_REVIEW.md"),
		});
		expect(resumeTaskAfterChangesRequested).toHaveBeenCalledWith({
			workspaceId: "workspace-1",
			taskId: "task-1",
		});
	});

	it("reuses the same run id and increments the round after changes requested", async () => {
		const runReviewRound = vi.fn(async (input) => ({
			reportPath: "/tmp/workspace/CODE_REVIEW.md",
			baseSha: "abc",
			headSha: "def",
			reviewedRef: "HEAD",
			output: "review output",
			exitCode: 0,
			document: {
				taskId: "task-1",
				runId: input.runId,
				rounds: [],
			},
			latestRound: {
				round: input.round,
				reviewerAgentId: "claude",
				reviewedRef: "HEAD",
				decision: "pass" as const,
				summary: "Looks good",
				findings: [],
				nextStep: "No changes required.",
			},
		}));

		const coordinator = createAgentReviewCoordinator({
			resolveLaunchCommand: async () => ({
				agentId: "claude",
				binary: "claude",
				args: ["--dangerously-skip-permissions"],
				autonomousModeEnabled: true,
			}),
			persistState: async () => {},
			sendFollowUpToOriginalAgent: async () => ({ ok: true }),
			runReviewRound,
		});

		const result = await coordinator.executeRound(
			{
				...createSnapshot(),
				existingState: {
					status: "changes_requested",
					currentRound: 1,
					maxRoundsSnapshot: 2,
					runId: "run-1",
					originalAgentId: "claude",
					reviewerAgentId: "claude",
					reportPath: "/tmp/workspace/CODE_REVIEW.md",
					lastOutcome: "changes_requested",
					stopAfterCurrentRound: false,
					passedBannerVisible: false,
				},
			},
			"automatic",
		);

		expect(result.ok).toBe(true);
		expect(runReviewRound).toHaveBeenCalledWith(
			expect.objectContaining({
				runId: "run-1",
				round: 2,
			}),
		);
		expect(result.state.currentRound).toBe(2);
	});

	it("does not start a fresh automatic run while another review round is already pending", async () => {
		const runReviewRound = vi.fn();

		const coordinator = createAgentReviewCoordinator({
			resolveLaunchCommand: async () => ({
				agentId: "claude",
				binary: "claude",
				args: ["--dangerously-skip-permissions"],
				autonomousModeEnabled: true,
			}),
			persistState: async () => {},
			sendFollowUpToOriginalAgent: async () => ({ ok: true }),
			runReviewRound,
		});

		const existingState = {
			status: "reviewing" as const,
			currentRound: 2,
			maxRoundsSnapshot: 3,
			runId: "run-2",
			originalAgentId: "claude" as const,
			reviewerAgentId: "claude" as const,
			reportPath: "/tmp/workspace/CODE_REVIEW.md",
			lastOutcome: "changes_requested" as const,
			stopAfterCurrentRound: false,
			passedBannerVisible: false,
		};

		const result = await coordinator.executeRound(
			{
				...createSnapshot(),
				existingState,
			},
			"automatic",
		);

		expect(result.ok).toBe(true);
		expect(result.skipped).toBe(true);
		expect(result.state).toEqual(existingState);
		expect(runReviewRound).not.toHaveBeenCalled();
	});
});
