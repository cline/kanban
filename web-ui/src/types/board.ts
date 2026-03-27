import type {
	RuntimeBoardColumnId,
	RuntimeTaskAutoReviewMode,
	RuntimeTaskAgentReviewOutcome,
	RuntimeTaskAgentReviewState,
	RuntimeTaskAgentReviewStatus,
	RuntimeTaskAgentReviewTriggerSource,
	RuntimeAgentReviewPolicy,
	RuntimeTaskImage,
} from "@/runtime/types";

export type BoardColumnId = RuntimeBoardColumnId;

export type TaskAutoReviewMode = RuntimeTaskAutoReviewMode;
export type TaskImage = RuntimeTaskImage;

export type TaskAgentReviewTriggerSource = RuntimeTaskAgentReviewTriggerSource;
export type TaskAgentReviewOutcome = RuntimeTaskAgentReviewOutcome;
export type TaskAgentReviewStatus = RuntimeTaskAgentReviewStatus;
export type TaskAgentReviewPolicy = RuntimeAgentReviewPolicy;
export type TaskAgentReviewState = RuntimeTaskAgentReviewState;

export const DEFAULT_TASK_AUTO_REVIEW_MODE: TaskAutoReviewMode = "commit";

export function resolveTaskAutoReviewMode(mode: TaskAutoReviewMode | null | undefined): TaskAutoReviewMode {
	if (mode === "pr" || mode === "move_to_trash") {
		return mode;
	}
	return DEFAULT_TASK_AUTO_REVIEW_MODE;
}

export function getTaskAutoReviewActionLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "PR";
	}
	if (resolvedMode === "move_to_trash") {
		return "move to trash";
	}
	return "commit";
}

export function getTaskAutoReviewCancelButtonLabel(mode: TaskAutoReviewMode | null | undefined): string {
	const resolvedMode = resolveTaskAutoReviewMode(mode);
	if (resolvedMode === "pr") {
		return "Cancel Auto-PR";
	}
	if (resolvedMode === "move_to_trash") {
		return "Cancel Auto-trash";
	}
	return "Cancel Auto-commit";
}

export function resolveTaskAgentReviewStatus(
	status: TaskAgentReviewStatus | null | undefined,
): TaskAgentReviewStatus {
	if (
		status === "pending" ||
		status === "reviewing" ||
		status === "changes_requested" ||
		status === "passed" ||
		status === "exhausted" ||
		status === "skipped"
	) {
		return status;
	}
	return "idle";
}

export function getTaskAgentReviewStatusLabel(
	state: TaskAgentReviewState | null | undefined,
): string | null {
	const status = resolveTaskAgentReviewStatus(state?.status);
	if (status === "pending" || status === "reviewing") {
		return "Agent Review In Progress";
	}
	if (status === "changes_requested") {
		return "Changes Requested";
	}
	if (status === "passed") {
		return "Passed";
	}
	if (status === "exhausted") {
		return "Agent Review Exhausted";
	}
	return null;
}

export function isTaskAgentReviewPinnedToReview(
	state: TaskAgentReviewState | null | undefined,
): boolean {
	const status = resolveTaskAgentReviewStatus(state?.status);
	return (
		status === "pending" ||
		status === "reviewing" ||
		status === "changes_requested" ||
		status === "passed" ||
		status === "exhausted"
	);
}

export function hasTaskPassedAgentReview(
	state: TaskAgentReviewState | null | undefined,
): boolean {
	return resolveTaskAgentReviewStatus(state?.status) === "passed" || state?.passedBannerVisible === true;
}

export interface BoardCard {
	id: string;
	prompt: string;
	startInPlanMode: boolean;
	autoReviewEnabled?: boolean;
	autoReviewMode?: TaskAutoReviewMode;
	agentReview?: TaskAgentReviewState;
	images?: TaskImage[];
	baseRef: string;
	createdAt: number;
	updatedAt: number;
}

export interface BoardColumn {
	id: BoardColumnId;
	title: string;
	cards: BoardCard[];
}

export interface BoardDependency {
	id: string;
	fromTaskId: string;
	toTaskId: string;
	createdAt: number;
}

export interface BoardData {
	columns: BoardColumn[];
	dependencies: BoardDependency[];
}

export interface ReviewTaskWorkspaceSnapshot {
	taskId: string;
	path: string;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
}

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
