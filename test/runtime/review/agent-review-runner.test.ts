import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readCodeReviewDocument } from "../../../src/review/code-review-report.js";
import { recordFallbackReviewRound } from "../../../src/review/agent-review-runner.js";

const tempDirs: string[] = [];

async function createWorkspacePath(): Promise<string> {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-agent-review-"));
	tempDirs.push(workspacePath);
	return workspacePath;
}

afterEach(async () => {
	await Promise.all(
		tempDirs.splice(0).map(async (workspacePath) => {
			await rm(workspacePath, { recursive: true, force: true });
		}),
	);
});

describe("recordFallbackReviewRound", () => {
	it("recovers a concrete changes-requested finding from reviewer terminal output", async () => {
		const workspacePath = await createWorkspacePath();
		const document = await recordFallbackReviewRound({
			workspacePath,
			taskId: "dbd10",
			runId: "run-1",
			round: 2,
			reviewerAgentId: "claude",
			reviewedRef: "HEAD",
			output: [
				"Reviewer did not produce a parseable CODE_REVIEW.md entry for round 2.",
				"",
				"Review written to `CODE_REVIEW.md` — **CHANGES_REQUESTED**. One low-severity finding: `performSave` trims `saveName` twice instead of using a local variable (a readability regression from the original). Everything else is clean — the extraction into sub-views is well done, dead code removal is complete, build passes, and behavior is preserved.",
				"",
				"❯ You are acting as the autonomous code reviewer for task 25b55.",
				"· Wandering…",
			].join("\n"),
		});

		const latestRound = document.rounds.at(-1);
		expect(latestRound).not.toBeNull();
		expect(latestRound?.decision).toBe("changes_requested");
		expect(latestRound?.summary).toContain("Everything else is clean");
		expect(latestRound?.findings).toEqual([
			expect.objectContaining({
				severity: "minor",
				title: "performSave issue",
				detail: expect.stringContaining("trims `saveName` twice"),
			}),
		]);
		expect(latestRound?.findings[0]?.detail).not.toContain("You are acting as the autonomous code reviewer");
		expect(latestRound?.nextStep).toContain("Address the findings above in code");

		const persisted = await readCodeReviewDocument(workspacePath);
		expect(persisted?.rounds.at(-1)?.findings[0]?.detail).toContain("trims `saveName` twice");
	});

	it("recovers a pass verdict when the reviewer output says the review passed", async () => {
		const workspacePath = await createWorkspacePath();
		const document = await recordFallbackReviewRound({
			workspacePath,
			taskId: "task-1",
			runId: "run-1",
			round: 1,
			reviewerAgentId: "claude",
			reviewedRef: "HEAD",
			output:
				"Reviewer did not produce a parseable CODE_REVIEW.md entry for round 1.\n\n" +
				"Review complete. Decision: **PASS**. No actionable findings. Build passes and the implementation matches the requested simplification.",
		});

		const latestRound = document.rounds.at(-1);
		expect(latestRound).not.toBeNull();
		expect(latestRound?.decision).toBe("pass");
		expect(latestRound?.summary).toContain("passed this round");
		expect(latestRound?.findings).toEqual([]);
		expect(latestRound?.nextStep).toContain("Continue with the normal post-review automation");
	});
});
