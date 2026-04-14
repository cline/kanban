import type {
	RuntimeHookEvent,
	RuntimeHookIngestResponse,
	RuntimeTaskPersistedReviewWorkspaceDiff,
	RuntimeTaskSessionSummary,
	RuntimeTaskTurnCheckpoint,
} from "../core/api-contract";
import { parseHookIngestRequest } from "../core/api-validation";
import { loadWorkspaceContextById } from "../state/workspace-state";
import type { TerminalSessionManager } from "../terminal/session-manager";
import {
	getWorkspaceChanges,
	getWorkspaceChangesBetweenRefs,
	getWorkspaceChangesFromRef,
} from "../workspace/get-workspace-changes";
import { captureTaskTurnCheckpoint, deleteTaskTurnCheckpointRef } from "../workspace/turn-checkpoints";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateHooksApiDependencies {
	getWorkspacePathById: (workspaceId: string) => string | null;
	ensureTerminalManagerForWorkspace: (workspaceId: string, repoPath: string) => Promise<TerminalSessionManager>;
	broadcastRuntimeWorkspaceStateUpdated: (workspaceId: string, workspacePath: string) => Promise<void> | void;
	broadcastTaskReadyForReview: (workspaceId: string, taskId: string) => void;
	captureTaskTurnCheckpoint?: (input: {
		cwd: string;
		taskId: string;
		turn: number;
	}) => Promise<RuntimeTaskTurnCheckpoint>;
	deleteTaskTurnCheckpointRef?: (input: { cwd: string; ref: string }) => Promise<void>;
}

function canTransitionTaskForHookEvent(summary: RuntimeTaskSessionSummary, event: RuntimeHookEvent): boolean {
	if (event === "activity") {
		return false;
	}
	if (event === "to_review") {
		return summary.state === "running";
	}
	return (
		summary.state === "awaiting_review" &&
		(summary.reviewReason === "attention" || summary.reviewReason === "hook" || summary.reviewReason === "error")
	);
}

const MAX_PERSISTED_REVIEW_DIFF_FILES = 6;

function summarizePersistedReviewWorkspaceDiff(
	mode: RuntimeTaskPersistedReviewWorkspaceDiff["mode"],
	response: Awaited<ReturnType<typeof getWorkspaceChanges>>,
): RuntimeTaskPersistedReviewWorkspaceDiff {
	const files = response.files.slice(0, MAX_PERSISTED_REVIEW_DIFF_FILES).map((file) => ({
		path: file.path,
		previousPath: file.previousPath,
		status: file.status,
		additions: file.additions,
		deletions: file.deletions,
	}));
	return {
		mode,
		generatedAt: response.generatedAt,
		changedFiles: response.files.length,
		additions: response.files.reduce((total, file) => total + file.additions, 0),
		deletions: response.files.reduce((total, file) => total + file.deletions, 0),
		files,
	};
}

async function capturePersistedReviewWorkspaceDiff(
	cwd: string,
	summary: RuntimeTaskSessionSummary,
): Promise<RuntimeTaskPersistedReviewWorkspaceDiff | null> {
	try {
		const toCheckpoint = summary.latestTurnCheckpoint;
		const fromCheckpoint = summary.previousTurnCheckpoint;
		if (!toCheckpoint) {
			return summarizePersistedReviewWorkspaceDiff("working_copy", await getWorkspaceChanges(cwd));
		}
		if (summary.state === "running" || !fromCheckpoint) {
			return summarizePersistedReviewWorkspaceDiff(
				"working_copy",
				await getWorkspaceChangesFromRef({
					cwd,
					fromRef: toCheckpoint.commit,
				}),
			);
		}
		return summarizePersistedReviewWorkspaceDiff(
			"last_turn",
			await getWorkspaceChangesBetweenRefs({
				cwd,
				fromRef: fromCheckpoint.commit,
				toRef: toCheckpoint.commit,
			}),
		);
	} catch {
		return null;
	}
}

export function createHooksApi(deps: CreateHooksApiDependencies): RuntimeTrpcContext["hooksApi"] {
	const checkpointCapture = deps.captureTaskTurnCheckpoint ?? captureTaskTurnCheckpoint;
	const checkpointRefDelete = deps.deleteTaskTurnCheckpointRef ?? deleteTaskTurnCheckpointRef;

	return {
		ingest: async (input) => {
			try {
				const body = parseHookIngestRequest(input);
				const taskId = body.taskId;
				const workspaceId = body.workspaceId;
				const event = body.event;
				const knownWorkspacePath = deps.getWorkspacePathById(workspaceId);
				const workspaceContext = knownWorkspacePath ? null : await loadWorkspaceContextById(workspaceId);
				const workspacePath = knownWorkspacePath ?? workspaceContext?.repoPath ?? null;
				if (!workspacePath) {
					return {
						ok: false,
						error: `Workspace "${workspaceId}" not found`,
					} satisfies RuntimeHookIngestResponse;
				}

				const manager = await deps.ensureTerminalManagerForWorkspace(workspaceId, workspacePath);
				const summary = manager.getSummary(taskId);
				if (!summary) {
					return {
						ok: false,
						error: `Task "${taskId}" not found in workspace "${workspaceId}"`,
					} satisfies RuntimeHookIngestResponse;
				}

				if (!canTransitionTaskForHookEvent(summary, event)) {
					if (body.metadata) {
						manager.applyHookActivity(taskId, body.metadata);
					}
					return {
						ok: true,
					} satisfies RuntimeHookIngestResponse;
				}

				let transitionedSummary =
					event === "to_review" ? manager.transitionToReview(taskId, "hook") : manager.transitionToRunning(taskId);
				if (!transitionedSummary) {
					return {
						ok: false,
						error: `Task "${taskId}" transition failed`,
					} satisfies RuntimeHookIngestResponse;
				}

				if (event === "to_review") {
					const nextTurn = (transitionedSummary.latestTurnCheckpoint?.turn ?? 0) + 1;
					const checkpointCwd = transitionedSummary.workspacePath ?? workspacePath;
					const staleRef = transitionedSummary.previousTurnCheckpoint?.ref ?? null;
					try {
						const checkpoint = await checkpointCapture({
							cwd: checkpointCwd,
							taskId,
							turn: nextTurn,
						});
						transitionedSummary = manager.applyTurnCheckpoint(taskId, checkpoint) ?? transitionedSummary;
						if (staleRef) {
							void checkpointRefDelete({
								cwd: checkpointCwd,
								ref: staleRef,
							}).catch(() => {
								// Best effort cleanup only.
							});
						}
					} catch {
						// Best effort checkpointing only.
					}
				}

				if (body.metadata) {
					transitionedSummary = manager.applyHookActivity(taskId, body.metadata) ?? transitionedSummary;
				}

				if (event === "to_review") {
					const diffSummary = await capturePersistedReviewWorkspaceDiff(
						transitionedSummary.workspacePath ?? workspacePath,
						transitionedSummary,
					);
					await manager.capturePersistedReviewContext(taskId, {
						workspaceDiff: diffSummary,
					});
				}

				void deps.broadcastRuntimeWorkspaceStateUpdated(workspaceId, workspacePath);
				if (event === "to_review") {
					deps.broadcastTaskReadyForReview(workspaceId, taskId);
				}

				return { ok: true } satisfies RuntimeHookIngestResponse;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, error: message } satisfies RuntimeHookIngestResponse;
			}
		},
	};
}
