import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { RuntimeAgentId } from "../core/api-contract.js";
import { PtySession } from "../terminal/pty-session.js";
import { prepareAgentLaunch } from "../terminal/agent-session-adapters.js";
import { stripAnsi } from "../terminal/output-utils.js";
import {
	appendCodeReviewRound,
	ensureCodeReviewDocument,
	type CodeReviewDocument,
	type CodeReviewRound,
	readCodeReviewDocument,
} from "./code-review-report.js";
import { buildCodeReviewPrompt } from "./review-prompts.js";

const execFile = promisify(execFileCallback);
const DEFAULT_REVIEWER_COLS = 160;
const DEFAULT_REVIEWER_ROWS = 48;

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
		round: {
			round: input.round,
			reviewerAgentId: input.reviewerAgentId,
			reviewedRef: input.reviewedRef,
			decision: "changes_requested",
			summary: "The autonomous reviewer did not produce a valid report, so the runner recorded a fallback review entry.",
			findings: [
				{
					severity: "important",
					title: "Reviewer output could not be parsed into CODE_REVIEW.md",
					file: null,
					detail: input.output.trim() || "The reviewer process exited without producing a valid round entry.",
				},
			],
			nextStep:
				"Inspect the latest CODE_REVIEW.md entry, recover the review findings if possible, and address the reported issues before returning the task to review.",
		},
	});
}
