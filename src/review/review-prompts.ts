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
		"Follow this prompt as the consolidated source of truth for this repository and this round.",
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
		"- Requirements adherence with no silent scope creep",
		"- Production readiness, including migrations, compatibility, and documentation gaps",
		"",
		"Review checklist:",
		"- Code quality: clean separation of concerns, DRY structure, edge cases handled, proper error handling",
		"- Architecture: sound design choices, scalability, performance, and security implications",
		"- Testing: tests should validate real logic, cover edge cases, and include integration coverage where needed",
		"- Requirements: implementation should match the stated plan and call out any breaking changes",
		"- Production readiness: consider migration strategy, backward compatibility, and obvious operational risks",
		"",
		"Output requirements:",
		`- Update only ${input.reportPath} for the review artifact.`,
		`- Append a \`### Round ${input.round}\` section that follows the repository contract.`,
		"- Decision must be exactly PASS or CHANGES_REQUESTED.",
		"- Categorize findings by actual severity and do not label everything as critical.",
		"- Strengths can be reflected in the summary, but actionable findings belong under Findings.",
		"- Every finding should include severity, file:line when possible, what is wrong, why it matters, and how to fix it when the fix is not obvious.",
		"- If there are no actionable findings, write PASS and an explicit 'No findings' entry in Findings.",
		"- Next Step must be a concise instruction that the original implementation agent can act on directly.",
		"- Be specific and decisive. Do not be vague, do not review code you did not inspect, and do not avoid giving a clear verdict.",
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
		`Open ${input.reportPath}, read the latest review round in full, and treat it as the source of truth for the requested fixes.`,
		findingsSummary,
		"Apply the requested fixes in code, run the relevant verification, and do not rewrite the review file.",
		"When the fixes are complete, hand the task back for review so the same reviewer agent can run the next round.",
		"Do not commit or open a PR from this follow-up step unless the normal task automation triggers after the reviewer passes.",
		`Use the 'Next Step' section in ${input.reportPath} as the highest-priority instruction for this follow-up.`,
	].join("\n");
}
