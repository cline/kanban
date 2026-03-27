import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeAgentId } from "../core/api-contract.js";
import { PtySession } from "../terminal/pty-session.js";
import { prepareAgentLaunch } from "../terminal/agent-session-adapters.js";
import { stripAnsi } from "../terminal/output-utils.js";
import {
	appendCodeReviewRound,
	ensureCodeReviewDocument,
	type CodeReviewDecision,
	type CodeReviewDocument,
	type CodeReviewFinding,
	type CodeReviewFindingSeverity,
	type CodeReviewRound,
	readCodeReviewDocument,
} from "./code-review-report.js";
import { buildCodeReviewPrompt } from "./review-prompts.js";

const execFile = promisify(execFileCallback);
const DEFAULT_REVIEWER_COLS = 160;
const DEFAULT_REVIEWER_ROWS = 48;

function normalizeRecoveredDecision(value: string): CodeReviewDecision | null {
	const normalized = value.trim().toUpperCase();
	if (normalized === "PASS") {
		return "pass";
	}
	if (normalized === "CHANGES_REQUESTED") {
		return "changes_requested";
	}
	return null;
}

function normalizeRecoveredSeverity(value: string): CodeReviewFindingSeverity {
	const normalized = value.trim().toLowerCase().replace(/-severity$/u, "");
	if (normalized === "critical" || normalized === "high") {
		return "critical";
	}
	if (normalized === "important" || normalized === "medium") {
		return "important";
	}
	return "minor";
}

function trimRecoveredText(value: string): string {
	return value
		.replaceAll("\r\n", "\n")
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function extractReviewerFinalMessage(output: string): string {
	const normalized = trimRecoveredText(output);
	const blocks = normalized
		.split(/\n{2,}/u)
		.map((block) => trimRecoveredText(block))
		.filter((block) => block.length > 0);
	const matchingBlock = blocks.find((block) =>
		/^(Review written to `CODE_REVIEW\.md`|Review round \d+ appended to `CODE_REVIEW\.md`|Review complete\.|Decision:)/iu.test(
			block,
		),
	);
	if (matchingBlock) {
		return matchingBlock;
	}
	const match =
		normalized.match(/Review written to `CODE_REVIEW\.md`[\s\S]*$/iu) ??
		normalized.match(/Review round \d+ appended to `CODE_REVIEW\.md`[\s\S]*$/iu) ??
		normalized.match(/Review complete\.[\s\S]*$/iu) ??
		normalized.match(/Decision:\s*\*\*(?:PASS|CHANGES_REQUESTED)\*\*[\s\S]*$/iu) ??
		normalized.match(/Decision:\s*(?:PASS|CHANGES_REQUESTED)[\s\S]*$/iu);
	return trimRecoveredText(match?.[0] ?? normalized);
}

function buildRecoveredFindingTitle(detail: string): string {
	const normalized = detail.replace(/\s+/gu, " ").trim();
	const symbolMatch = normalized.match(/`([^`]+)`/u);
	if (symbolMatch?.[1]) {
		return `${symbolMatch[1]} issue`;
	}
	const firstSentence = normalized.split(/(?<=[.!?])\s+/u)[0] ?? normalized;
	if (firstSentence.length <= 96) {
		return firstSentence;
	}
	return `${firstSentence.slice(0, 93).trimEnd()}...`;
}

function recoverFindingsFromNumberedList(message: string): CodeReviewFinding[] {
	const matches = [
		...message.matchAll(/(?:^|\s)(\d+)\.\s+\*\*\[([^\]]+)\]\*\*\s+([\s\S]*?)(?=(?:\s+\d+\.\s+\*\*\[)|$)/gu),
	];
	if (matches.length === 0) {
		return [];
	}
	return matches.map((match) => {
		const detail = trimRecoveredText(match[3] ?? "");
		return {
			severity: normalizeRecoveredSeverity(match[2] ?? "minor"),
			title: buildRecoveredFindingTitle(detail),
			file: null,
			detail,
		};
	});
}

function recoverSingleFinding(message: string): CodeReviewFinding[] {
	const match = message.match(
		/One\s+([a-z-]+)(?:-severity)?\s+finding:\s*([\s\S]*?)(?=(?:Everything else is clean|Everything else looks good|Everything else seems fine|Build passes|$))/iu,
	);
	if (!match) {
		return [];
	}
	const detail = trimRecoveredText(match[2] ?? "");
	if (!detail) {
		return [];
	}
	return [
		{
			severity: normalizeRecoveredSeverity(match[1] ?? "minor"),
			title: buildRecoveredFindingTitle(detail),
			file: null,
			detail,
		},
	];
}

function recoverFindingsFromReviewerOutput(message: string): CodeReviewFinding[] {
	const numberedFindings = recoverFindingsFromNumberedList(message);
	if (numberedFindings.length > 0) {
		return numberedFindings;
	}

	const singleFinding = recoverSingleFinding(message);
	if (singleFinding.length > 0) {
		return singleFinding;
	}

	return [];
}

function recoverSummaryFromReviewerOutput(message: string, decision: CodeReviewDecision, findings: readonly CodeReviewFinding[]): string {
	const normalized = trimRecoveredText(message);
	if (decision === "pass") {
		return "The reviewer passed this round with no actionable findings.";
	}

	const everythingElseMatch = normalized.match(
		/(Everything else is clean[\s\S]*|Everything else looks good[\s\S]*|Everything else seems fine[\s\S]*|Build passes[\s\S]*)$/iu,
	);
	if (everythingElseMatch?.[1]) {
		return trimRecoveredText(everythingElseMatch[1]);
	}

	if (findings.length > 0) {
		return "The reviewer requested changes based on the findings below.";
	}

	return "The reviewer requested changes.";
}

function recoverDecisionFromReviewerOutput(message: string): CodeReviewDecision {
	const explicitDecision =
		message.match(/Decision:\s*\*\*(PASS|CHANGES_REQUESTED)\*\*/iu)?.[1] ??
		message.match(/Decision:\s*(PASS|CHANGES_REQUESTED)\b/iu)?.[1] ??
		message.match(/\*\*(PASS|CHANGES_REQUESTED)\*\*/u)?.[1];
	return normalizeRecoveredDecision(explicitDecision ?? "") ?? "changes_requested";
}

function buildRecoveredFallbackRound(input: {
	round: number;
	reviewerAgentId: RuntimeAgentId;
	reviewedRef: string | null;
	output: string;
}): CodeReviewRound {
	const reviewerMessage = extractReviewerFinalMessage(input.output);
	const decision = recoverDecisionFromReviewerOutput(reviewerMessage);
	const findings = recoverFindingsFromReviewerOutput(reviewerMessage);
	const noFindings = findings.length === 0;

	return {
		round: input.round,
		reviewerAgentId: input.reviewerAgentId,
		reviewedRef: input.reviewedRef,
		decision,
		summary: recoverSummaryFromReviewerOutput(reviewerMessage, decision, findings),
		findings:
			decision === "pass" && noFindings
				? []
				: noFindings
					? [
							{
								severity: "important",
								title: "Reviewer output could not be parsed into CODE_REVIEW.md",
								file: null,
								detail:
									reviewerMessage || "The reviewer process exited without producing a valid round entry.",
							},
						]
					: findings,
		nextStep:
			decision === "pass"
				? "No fixes are required. Continue with the normal post-review automation for this task."
				: "Address the findings above in code, run the relevant verification, and return the task to the same reviewer for the next round.",
	};
}

export interface AgentReviewLaunchCommand {
	agentId: RuntimeAgentId;
	binary: string;
	args: string[];
	autonomousModeEnabled?: boolean;
	env?: Record<string, string | undefined>;
}

export interface AgentReviewGitRange {
	baseSha: string | null;
	headSha: string | null;
	reviewedRef: string | null;
}

export interface RunAgentReviewRoundInput {
	workspaceId: string;
	taskId: string;
	runId: string;
	round: number;
	workspacePath: string;
	baseRef: string;
	reviewer: AgentReviewLaunchCommand;
	whatWasImplemented: string;
	requirementsReference: string;
}

export interface AgentReviewRunnerResult {
	reportPath: string;
	baseSha: string | null;
	headSha: string | null;
	reviewedRef: string | null;
	output: string;
	exitCode: number;
	document: CodeReviewDocument;
	latestRound: CodeReviewRound;
}

function buildProcessEnvironment(
	launchEnv: Record<string, string | undefined>,
	overrides: Record<string, string | undefined> | undefined,
): Record<string, string | undefined> {
	const merged: Record<string, string | undefined> = {
		...process.env,
		...overrides,
		...launchEnv,
	};

	for (const [key, value] of Object.entries(merged)) {
		if (value === undefined) {
			delete merged[key];
		}
	}

	return merged;
}

async function gitRevParse(cwd: string, ...args: string[]): Promise<string | null> {
	try {
		const result = await execFile("git", args, { cwd, encoding: "utf8" });
		const stdout = result.stdout.trim();
		return stdout.length > 0 ? stdout : null;
	} catch {
		return null;
	}
}

export async function resolveAgentReviewGitRange(workspacePath: string, baseRef: string | null | undefined): Promise<AgentReviewGitRange> {
	const headSha = await gitRevParse(workspacePath, "rev-parse", "HEAD");
	const reviewedRef = (await gitRevParse(workspacePath, "rev-parse", "--abbrev-ref", "HEAD")) ?? headSha;
	if (!baseRef?.trim()) {
		return {
			baseSha: null,
			headSha,
			reviewedRef,
		};
	}

	const trimmedBaseRef = baseRef.trim();
	const baseSha =
		(await gitRevParse(workspacePath, "merge-base", trimmedBaseRef, "HEAD")) ??
		(await gitRevParse(workspacePath, "rev-parse", trimmedBaseRef));

	return {
		baseSha,
		headSha,
		reviewedRef,
	};
}

async function runPreparedReviewerProcess(input: {
	binary: string;
	args: string[];
	cwd: string;
	env: Record<string, string | undefined>;
}): Promise<{ output: string; exitCode: number }> {
	const outputChunks: string[] = [];

	return await new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
		let settled = false;
		let session: PtySession | null = null;
		try {
			session = PtySession.spawn({
				binary: input.binary,
				args: input.args,
				cwd: input.cwd,
				env: input.env,
				cols: DEFAULT_REVIEWER_COLS,
				rows: DEFAULT_REVIEWER_ROWS,
				onData: (chunk) => {
					outputChunks.push(chunk.toString("utf8"));
				},
				onExit: (event) => {
					if (settled) {
						return;
					}
					settled = true;
					resolve({
						output: stripAnsi(outputChunks.join("")),
						exitCode: event.exitCode,
					});
				},
			});
		} catch (error) {
			if (settled) {
				return;
			}
			settled = true;
			reject(error);
			return;
		}

		if (!session) {
			reject(new Error("Reviewer process could not be started."));
		}
	});
}

export async function runAgentReviewRound(input: RunAgentReviewRoundInput): Promise<AgentReviewRunnerResult> {
	const gitRange = await resolveAgentReviewGitRange(input.workspacePath, input.baseRef);
	const reportPath = await ensureCodeReviewDocument(input.workspacePath, input.taskId, input.runId);
	const prompt = buildCodeReviewPrompt({
		taskId: input.taskId,
		round: input.round,
		reportPath,
		workspacePath: input.workspacePath,
		reviewerAgentId: input.reviewer.agentId,
		baseSha: gitRange.baseSha,
		headSha: gitRange.headSha,
		whatWasImplemented: input.whatWasImplemented,
		requirementsReference: input.requirementsReference,
	});

	const launch = await prepareAgentLaunch({
		taskId: `${input.taskId}-reviewer`,
		agentId: input.reviewer.agentId,
		binary: input.reviewer.binary,
		args: input.reviewer.args,
		autonomousModeEnabled: input.reviewer.autonomousModeEnabled,
		cwd: input.workspacePath,
		prompt,
		env: input.reviewer.env,
	});

	const binary = launch.binary ?? input.reviewer.binary;
	const env = buildProcessEnvironment(launch.env, input.reviewer.env);
	let execution: { output: string; exitCode: number };
	try {
		execution = await runPreparedReviewerProcess({
			binary,
			args: launch.args,
			cwd: input.workspacePath,
			env,
		});
	} finally {
		await launch.cleanup?.().catch(() => {
			// Best effort cleanup only.
		});
	}

	const document = await readCodeReviewDocument(input.workspacePath);
	const latestRound = document?.rounds.find((round) => round.round === input.round) ?? document?.rounds.at(-1) ?? null;
	if (!document || !latestRound) {
		throw new Error(`Reviewer did not produce a parseable CODE_REVIEW.md entry for round ${input.round}.`);
	}

	return {
		reportPath,
		baseSha: gitRange.baseSha,
		headSha: gitRange.headSha,
		reviewedRef: latestRound.reviewedRef,
		output: execution.output,
		exitCode: execution.exitCode,
		document,
		latestRound,
	};
}

export async function recordFallbackReviewRound(input: {
	workspacePath: string;
	taskId: string;
	runId: string;
	round: number;
	reviewerAgentId: RuntimeAgentId;
	reviewedRef: string | null;
	output: string;
}): Promise<CodeReviewDocument> {
	return await appendCodeReviewRound({
		workspacePath: input.workspacePath,
		taskId: input.taskId,
		runId: input.runId,
		round: buildRecoveredFallbackRound({
			round: input.round,
			reviewerAgentId: input.reviewerAgentId,
			reviewedRef: input.reviewedRef,
			output: input.output,
		}),
	});
}
