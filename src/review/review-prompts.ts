import type { RuntimeAgentId } from "../core/api-contract.js";
import type { CodeReviewRound } from "./code-review-report.js";

export const REQUESTING_CODE_REVIEW_SKILL_URL =
	"https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/code-reviewer.md";

export interface BuildCodeReviewPromptInput {
	taskId: string;
	round: number;
	reportPath: string;
	workspacePath: string;
	reviewerAgentId: RuntimeAgentId;
	baseSha: string | null;
	headSha: string | null;
	whatWasImplemented: string;
	requirementsReference: string;
}

function normalizeMultilineBlock(value: string, fallback: string): string {
	const normalized = value
		.replaceAll("\r\n", "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
	return normalized.length > 0 ? normalized : fallback;
}

export function buildCodeReviewPrompt(input: BuildCodeReviewPromptInput): string {
	const implementationSummary = normalizeMultilineBlock(
		input.whatWasImplemented,
		"Review the current task implementation in this worktree.",
	);
	const planReference = normalizeMultilineBlock(
		input.requirementsReference,
		"Use the task prompt and the current repository state as the source of truth.",
	);
	const baseRef = input.baseSha ?? "BASE_UNAVAILABLE";
	const headRef = input.headSha ?? "HEAD";
	const gitRangeInstructions =
		input.baseSha && input.headSha
			? [`Run: git diff --stat ${baseRef}..${headRef}`, `Run: git diff ${baseRef}..${headRef}`]
			: ["If a merge-base range is unavailable, review the current worktree with `git status --short` and `git diff`."];

	return [
		`You are acting as the autonomous code reviewer for task ${input.taskId}.`,
		`Use the rigor and structure of the reviewer skill at ${REQUESTING_CODE_REVIEW_SKILL_URL}, but adapt it to this repository and this round.`,
		"",
		`Review round: ${input.round}`,
		`Reviewer agent: ${input.reviewerAgentId}`,
		`Task worktree: ${input.workspacePath}`,
		`Report file: ${input.reportPath}`,
		"",
		"Scope:",
		`1. Review what was implemented for this task.`,
		"2. Compare the implementation against the stated requirements/plan.",
		"3. Inspect code quality, architecture, testing, and production readiness.",
		"4. Review the full current change set for the task worktree.",
		"5. Append exactly one new round section to CODE_REVIEW.md and do not overwrite earlier rounds.",
		"",
		"Implementation summary:",
		implementationSummary,
		"",
		"Requirements / plan reference:",
		planReference,
		"",
		"Git range to inspect:",
		`Base: ${baseRef}`,
		`Head: ${headRef}`,
		...gitRangeInstructions,
		"",
		"Required review focus:",
		"- Correctness and obvious bugs",
		"- Architecture and separation of concerns",
		"- Error handling and resilience",
		"- Type safety",
		"- Test coverage gaps",
		"- Security and backwards compatibility concerns",
		"",
		"Output requirements:",
		`- Update only ${input.reportPath} for the review artifact.`,
		`- Append a \`### Round ${input.round}\` section that follows the repository contract.`,
		"- Decision must be exactly PASS or CHANGES_REQUESTED.",
		"- Strengths can be reflected in the summary, but actionable findings belong under Findings.",
		"- Every finding should include a severity, a file reference when possible, and a concrete explanation.",
		"- If there are no actionable findings, write PASS and an explicit 'No findings' entry in Findings.",
		"- Next Step must be a concise instruction that the original implementation agent can act on directly.",
	].join("\n");
}

export function buildImplementationFollowUpPrompt(input: {
	reportPath: string;
	round: CodeReviewRound;
}): string {
	const findingsSummary =
		input.round.findings.length === 0
			? "The review report did not record actionable findings."
			: `Address all findings listed for review round ${input.round.round}.`;

	return [
		`Autonomous review round ${input.round.round} completed and requested changes.`,
		`Open ${input.reportPath} and implement the fixes from the latest round.`,
		findingsSummary,
		"Do not rewrite the review file. Make the code changes, verify them, and continue until the task is ready for review again.",
		`Use the 'Next Step' section in ${input.reportPath} as the highest-priority instruction for this follow-up.`,
	].join("\n");
}
