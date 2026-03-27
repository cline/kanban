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
		const persistState = vi.fn(async () => {});
		const sendFollowUpToOriginalAgent = vi.fn(async () => ({ ok: true }));
		const resumeTaskAfterChangesRequested = vi.fn(async () => {});

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
});
