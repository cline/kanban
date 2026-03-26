import { randomUUID } from "node:crypto";
import type { RuntimeAgentId, RuntimeBoardColumnId } from "../core/api-contract.js";
import type { CodeReviewRound } from "./code-review-report.js";
import { getCodeReviewReportPath } from "./code-review-report.js";
import type { AgentReviewLaunchCommand, AgentReviewRunnerResult, RunAgentReviewRoundInput } from "./agent-review-runner.js";
import { recordFallbackReviewRound, runAgentReviewRound } from "./agent-review-runner.js";
import { buildImplementationFollowUpPrompt } from "./review-prompts.js";

export type AgentReviewStatus = "idle" | "pending" | "reviewing" | "changes_requested" | "passed" | "exhausted" | "skipped";
export type AgentReviewTriggerSource = "automatic" | "manual";
export type AgentReviewOutcome = "pass" | "changes_requested" | "exhausted" | "skipped";

export interface AgentReviewPolicy {
	enabled: boolean;
	maxRounds: number;
}

export interface AgentReviewState {
	status: AgentReviewStatus;
	triggerSource?: AgentReviewTriggerSource;
	requestedAt?: number;
	startedAt?: number;
	completedAt?: number;
	currentRound: number;
	maxRoundsSnapshot?: number;
	runId?: string;
	originalAgentId?: RuntimeAgentId;
	reviewerAgentId?: RuntimeAgentId;
	reportPath?: string;
	lastOutcome?: AgentReviewOutcome;
	stopAfterCurrentRound: boolean;
	passedBannerVisible: boolean;
}

export interface AgentReviewTaskSnapshot {
	workspaceId: string;
	workspacePath: string;
	taskId: string;
	taskPrompt: string;
	baseRef: string;
	currentColumnId: RuntimeBoardColumnId;
	originalAgentId: RuntimeAgentId | null;
	existingState: AgentReviewState | null;
	policy: AgentReviewPolicy;
	requirementsReference: string;
}

export interface AgentReviewRefreshSnapshot {
	currentColumnId: RuntimeBoardColumnId;
	policy: AgentReviewPolicy;
}

export interface PersistAgentReviewStateInput {
	workspaceId: string;
	taskId: string;
	state: AgentReviewState;
}

export interface SendAgentReviewFollowUpInput {
	workspaceId: string;
	taskId: string;
	text: string;
}

export interface AgentReviewFollowUpResult {
	ok: boolean;
	message?: string;
}

export interface CreateAgentReviewCoordinatorDependencies {
	resolveLaunchCommand: (input: {
		workspaceId: string;
		preferredAgentId: RuntimeAgentId | null;
	}) => Promise<AgentReviewLaunchCommand | null>;
	persistState: (input: PersistAgentReviewStateInput) => Promise<void>;
	sendFollowUpToOriginalAgent: (input: SendAgentReviewFollowUpInput) => Promise<AgentReviewFollowUpResult>;
	refreshSnapshotAfterRound?: (input: {
		workspaceId: string;
		taskId: string;
	}) => Promise<AgentReviewRefreshSnapshot | null>;
	runReviewRound?: (input: RunAgentReviewRoundInput) => Promise<AgentReviewRunnerResult>;
	recordFallbackRound?: (input: {
		workspacePath: string;
		taskId: string;
		runId: string;
		round: number;
		reviewerAgentId: RuntimeAgentId;
		reviewedRef: string | null;
		output: string;
	}) => Promise<unknown>;
}

export interface AgentReviewExecutionResult {
	ok: boolean;
	state: AgentReviewState;
	runnerResult: AgentReviewRunnerResult | null;
	followUpPrompt: string | null;
	followUpSent: boolean;
	duplicate: boolean;
	skipped: boolean;
	error?: string;
}

function clampMaxRounds(value: number): number {
	if (!Number.isFinite(value)) {
		return 1;
	}
	return Math.max(1, Math.floor(value));
}

function createIdleAgentReviewState(): AgentReviewState {
	return {
		status: "idle",
		currentRound: 0,
		stopAfterCurrentRound: false,
		passedBannerVisible: false,
	};
}

function createSkippedAgentReviewState(snapshot: AgentReviewTaskSnapshot, triggerSource: AgentReviewTriggerSource): AgentReviewState {
	return {
		...createIdleAgentReviewState(),
		status: "skipped",
		triggerSource,
		requestedAt: Date.now(),
		completedAt: Date.now(),
		maxRoundsSnapshot: clampMaxRounds(snapshot.policy.maxRounds),
		lastOutcome: "skipped",
	};
}

function shouldStartNewRun(existingState: AgentReviewState | null, triggerSource: AgentReviewTriggerSource): boolean {
	if (!existingState?.runId) {
		return true;
	}
	if (triggerSource === "manual") {
		return (
			existingState.status === "passed" ||
			existingState.status === "exhausted" ||
			existingState.status === "skipped" ||
			existingState.status === "idle"
		);
	}
	return existingState.status !== "changes_requested";
}

function shouldSkipAutomaticTrigger(snapshot: AgentReviewTaskSnapshot): boolean {
	return snapshot.existingState?.status === "passed";
}

function buildReviewingState(input: {
	snapshot: AgentReviewTaskSnapshot;
	triggerSource: AgentReviewTriggerSource;
	round: number;
	runId: string;
	reviewerAgentId: RuntimeAgentId;
	reportPath: string | undefined;
}): AgentReviewState {
	return {
		status: "reviewing",
		triggerSource: input.triggerSource,
		requestedAt: Date.now(),
		startedAt: Date.now(),
		currentRound: input.round,
		maxRoundsSnapshot: clampMaxRounds(input.snapshot.policy.maxRounds),
		runId: input.runId,
		originalAgentId: input.snapshot.originalAgentId ?? undefined,
		reviewerAgentId: input.reviewerAgentId,
		reportPath: input.reportPath,
		lastOutcome: undefined,
		stopAfterCurrentRound: false,
		passedBannerVisible: input.snapshot.existingState?.passedBannerVisible === true && input.triggerSource === "automatic",
	};
}

function determineCompletionState(input: {
	previousState: AgentReviewState;
	runnerResult: AgentReviewRunnerResult;
	refreshedSnapshot: AgentReviewRefreshSnapshot | null;
}): AgentReviewState {
	const livePolicy = input.refreshedSnapshot?.policy ?? {
		enabled: true,
		maxRounds: input.previousState.maxRoundsSnapshot ?? 1,
	};
	const liveColumnId = input.refreshedSnapshot?.currentColumnId ?? "review";
	const maxRounds = clampMaxRounds(livePolicy.maxRounds);
	const round = input.runnerResult.latestRound.round;
	const completedAt = Date.now();

	if (input.runnerResult.latestRound.decision === "pass") {
		return {
			...input.previousState,
			status: "passed",
			completedAt,
			currentRound: round,
			maxRoundsSnapshot: maxRounds,
			reportPath: input.runnerResult.reportPath,
			lastOutcome: "pass",
			stopAfterCurrentRound: liveColumnId !== "review",
			passedBannerVisible: true,
		};
	}

	const exhausted = liveColumnId !== "review" || round >= maxRounds;
	return {
		...input.previousState,
		status: exhausted ? "exhausted" : "changes_requested",
		completedAt,
		currentRound: round,
		maxRoundsSnapshot: maxRounds,
		reportPath: input.runnerResult.reportPath,
		lastOutcome: exhausted ? "exhausted" : "changes_requested",
		stopAfterCurrentRound: exhausted,
		passedBannerVisible: input.previousState.passedBannerVisible,
	};
}

export function createAgentReviewCoordinator(deps: CreateAgentReviewCoordinatorDependencies) {
	const activeRuns = new Set<string>();
	const runReviewRound = deps.runReviewRound ?? runAgentReviewRound;
	const recordFallbackRound = deps.recordFallbackRound ?? recordFallbackReviewRound;

	async function persistState(workspaceId: string, taskId: string, state: AgentReviewState): Promise<void> {
		await deps.persistState({ workspaceId, taskId, state });
	}

	return {
		async executeRound(
			snapshot: AgentReviewTaskSnapshot,
			triggerSource: AgentReviewTriggerSource,
		): Promise<AgentReviewExecutionResult> {
			const activeKey = `${snapshot.workspaceId}:${snapshot.taskId}`;
			if (activeRuns.has(activeKey)) {
				return {
					ok: false,
					state: snapshot.existingState ?? createIdleAgentReviewState(),
					runnerResult: null,
					followUpPrompt: null,
					followUpSent: false,
					duplicate: true,
					skipped: false,
					error: "A review round is already active for this task.",
				};
			}

			if (triggerSource === "automatic" && shouldSkipAutomaticTrigger(snapshot)) {
				return {
					ok: true,
					state: snapshot.existingState ?? createIdleAgentReviewState(),
					runnerResult: null,
					followUpPrompt: null,
					followUpSent: false,
					duplicate: false,
					skipped: true,
				};
			}

			if (!snapshot.originalAgentId) {
				const skippedState = createSkippedAgentReviewState(snapshot, triggerSource);
				await persistState(snapshot.workspaceId, snapshot.taskId, skippedState);
				return {
					ok: true,
					state: skippedState,
					runnerResult: null,
					followUpPrompt: null,
					followUpSent: false,
					duplicate: false,
					skipped: true,
				};
			}

			const launchCommand = await deps.resolveLaunchCommand({
				workspaceId: snapshot.workspaceId,
				preferredAgentId: snapshot.originalAgentId,
			});
			if (!launchCommand) {
				const skippedState = createSkippedAgentReviewState(snapshot, triggerSource);
				await persistState(snapshot.workspaceId, snapshot.taskId, skippedState);
				return {
					ok: true,
					state: skippedState,
					runnerResult: null,
					followUpPrompt: null,
					followUpSent: false,
					duplicate: false,
					skipped: true,
				};
			}

			const previousState = snapshot.existingState;
			const newRun = shouldStartNewRun(previousState, triggerSource);
			const round = newRun ? 1 : Math.max(1, (previousState?.currentRound ?? 0) + 1);
			const runId = newRun ? randomUUID() : (previousState?.runId ?? randomUUID());
			const reviewingState = buildReviewingState({
				snapshot,
				triggerSource,
				round,
				runId,
				reviewerAgentId: launchCommand.agentId,
				reportPath: previousState?.reportPath,
			});

			await persistState(snapshot.workspaceId, snapshot.taskId, {
				...reviewingState,
				status: "pending",
			});
			await persistState(snapshot.workspaceId, snapshot.taskId, reviewingState);

			activeRuns.add(activeKey);
			let runnerResult: AgentReviewRunnerResult | null = null;
			try {
				runnerResult = await runReviewRound({
					taskId: snapshot.taskId,
					runId,
					round,
					workspacePath: snapshot.workspacePath,
					baseRef: snapshot.baseRef,
					reviewer: launchCommand,
					whatWasImplemented: snapshot.taskPrompt,
					requirementsReference: snapshot.requirementsReference,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				await recordFallbackRound({
					workspacePath: snapshot.workspacePath,
					taskId: snapshot.taskId,
					runId,
					round,
					reviewerAgentId: launchCommand.agentId,
					reviewedRef: null,
					output: message,
				});
				const failedState: AgentReviewState = {
					...reviewingState,
					status: "exhausted",
					completedAt: Date.now(),
					currentRound: round,
					reportPath: getCodeReviewReportPath(snapshot.workspacePath),
					lastOutcome: "exhausted",
					stopAfterCurrentRound: true,
				};
				await persistState(snapshot.workspaceId, snapshot.taskId, failedState);
				return {
					ok: false,
					state: failedState,
					runnerResult: null,
					followUpPrompt: null,
					followUpSent: false,
					duplicate: false,
					skipped: false,
					error: message,
				};
			} finally {
				activeRuns.delete(activeKey);
			}

			const refreshedSnapshot = deps.refreshSnapshotAfterRound
				? await deps.refreshSnapshotAfterRound({
						workspaceId: snapshot.workspaceId,
						taskId: snapshot.taskId,
					})
				: null;
			const finalState = determineCompletionState({
				previousState: reviewingState,
				runnerResult,
				refreshedSnapshot,
			});

			let followUpPrompt: string | null = null;
			let followUpSent = false;
			if (runnerResult.latestRound.decision === "changes_requested" && finalState.status === "changes_requested") {
				followUpPrompt = buildImplementationFollowUpPrompt({
					reportPath: runnerResult.reportPath,
					round: runnerResult.latestRound,
				});
				const followUpResult = await deps.sendFollowUpToOriginalAgent({
					workspaceId: snapshot.workspaceId,
					taskId: snapshot.taskId,
					text: followUpPrompt,
				});
				followUpSent = followUpResult.ok;
			}

			await persistState(snapshot.workspaceId, snapshot.taskId, finalState);
			return {
				ok: true,
				state: finalState,
				runnerResult,
				followUpPrompt,
				followUpSent,
				duplicate: false,
				skipped: false,
			};
		},
	};
}

export function shouldContinueAgentReview(state: AgentReviewState | null | undefined): boolean {
	return state?.status === "changes_requested" && state.stopAfterCurrentRound !== true;
}

export function shouldRenderAgentReviewStatus(columnId: RuntimeBoardColumnId, state: AgentReviewState | null | undefined): boolean {
	if (columnId !== "review") {
		return false;
	}
	return (
		state?.status === "pending" ||
		state?.status === "reviewing" ||
		state?.status === "changes_requested" ||
		state?.status === "passed" ||
		state?.status === "exhausted"
	);
}

export function buildAgentReviewStatusLabel(state: AgentReviewState | null | undefined): string | null {
	switch (state?.status) {
		case "pending":
		case "reviewing":
			return "Reviewing";
		case "changes_requested":
			return "Changes Requested";
		case "passed":
			return "Passed";
		case "exhausted":
			return "Agent Review Exhausted";
		default:
			return null;
	}
}

export function buildAgentReviewFollowUpPrompt(reportPath: string, round: CodeReviewRound): string {
	return buildImplementationFollowUpPrompt({ reportPath, round });
}
