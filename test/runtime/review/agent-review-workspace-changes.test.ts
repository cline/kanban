import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAgentReviewGitRangeMock = vi.hoisted(() => vi.fn());
const getWorkspaceChangesMock = vi.hoisted(() => vi.fn());
const getWorkspaceChangesFromRefMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/review/agent-review-runner.js", () => ({
	resolveAgentReviewGitRange: resolveAgentReviewGitRangeMock,
}));

vi.mock("../../../src/workspace/get-workspace-changes.js", () => ({
	getWorkspaceChanges: getWorkspaceChangesMock,
	getWorkspaceChangesFromRef: getWorkspaceChangesFromRefMock,
}));

import {
	getAgentReviewWorkspaceChanges,
	hasAgentReviewableChanges,
} from "../../../src/review/agent-review-workspace-changes.js";

describe("agent-review-workspace-changes", () => {
	beforeEach(() => {
		resolveAgentReviewGitRangeMock.mockReset();
		getWorkspaceChangesMock.mockReset();
		getWorkspaceChangesFromRefMock.mockReset();
	});

	it("uses the merge-base diff when one is available", async () => {
		const changes = {
			repoRoot: "/tmp/repo",
			generatedAt: 1,
			files: [
				{
					path: "src/review.ts",
					status: "modified",
					additions: 4,
					deletions: 0,
					oldText: "old",
					newText: "new",
				},
			],
		};
		resolveAgentReviewGitRangeMock.mockResolvedValue({
			baseSha: "abc123",
			headSha: "def456",
			reviewedRef: "feature/agent-reviewer",
		});
		getWorkspaceChangesFromRefMock.mockResolvedValue(changes);

		await expect(
			getAgentReviewWorkspaceChanges({
				workspacePath: "/tmp/repo",
				baseRef: "main",
			}),
		).resolves.toEqual(changes);

		expect(getWorkspaceChangesFromRefMock).toHaveBeenCalledWith({
			cwd: "/tmp/repo",
			fromRef: "abc123",
		});
		expect(getWorkspaceChangesMock).not.toHaveBeenCalled();
	});

	it("falls back to working-tree changes when the merge-base diff cannot be loaded", async () => {
		const changes = {
			repoRoot: "/tmp/repo",
			generatedAt: 1,
			files: [
				{
					path: "src/review.ts",
					status: "modified",
					additions: 4,
					deletions: 0,
					oldText: "old",
					newText: "new",
				},
			],
		};
		resolveAgentReviewGitRangeMock.mockResolvedValue({
			baseSha: "abc123",
			headSha: "def456",
			reviewedRef: "feature/agent-reviewer",
		});
		getWorkspaceChangesFromRefMock.mockRejectedValue(new Error("diff unavailable"));
		getWorkspaceChangesMock.mockResolvedValue(changes);

		await expect(
			getAgentReviewWorkspaceChanges({
				workspacePath: "/tmp/repo",
				baseRef: "main",
			}),
		).resolves.toEqual(changes);

		expect(getWorkspaceChangesMock).toHaveBeenCalledWith("/tmp/repo");
	});

	it("treats empty review inputs as non-reviewable", () => {
		expect(hasAgentReviewableChanges(null)).toBe(false);
		expect(
			hasAgentReviewableChanges({
				repoRoot: "/tmp/repo",
				generatedAt: 1,
				files: [],
			}),
		).toBe(false);
	});
});
