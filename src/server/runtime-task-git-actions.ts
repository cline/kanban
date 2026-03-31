import type { RuntimeTaskAutoReviewMode, RuntimeTaskWorkspaceInfoResponse } from "../core/api-contract";

export type RuntimeTaskGitAction = Extract<RuntimeTaskAutoReviewMode, "commit" | "pr">;

interface TaskGitPromptTemplates {
	commitPromptTemplate?: string | null;
	openPrPromptTemplate?: string | null;
	commitPromptTemplateDefault?: string | null;
	openPrPromptTemplateDefault?: string | null;
}

interface TaskGitActionState {
	inFlightAction: RuntimeTaskGitAction | null;
	pendingAction: RuntimeTaskGitAction | null;
	autoCleanupAction: RuntimeTaskGitAction | null;
}

export interface RuntimeTaskGitActionCoordinator {
	beginTaskGitAction: (workspaceId: string, taskId: string, action: RuntimeTaskGitAction) => boolean;
	completeTaskGitAction: (
		workspaceId: string,
		taskId: string,
		action: RuntimeTaskGitAction,
		options: { dispatched: boolean; armAutoCleanup: boolean },
	) => void;
	getAutoCleanupTaskGitAction: (workspaceId: string, taskId: string) => RuntimeTaskGitAction | null;
	isTaskGitActionBlocked: (workspaceId: string, taskId: string) => boolean;
	clearTaskGitAction: (workspaceId: string, taskId: string) => void;
	disposeWorkspace: (workspaceId: string) => void;
	close: () => void;
}

/**
 * Resolves the prompt template string that should drive a commit or PR agent action.
 */
function resolveTaskGitActionTemplate(
	action: RuntimeTaskGitAction,
	templates: TaskGitPromptTemplates | null | undefined,
): string {
	if (action === "commit") {
		const template = templates?.commitPromptTemplate?.trim();
		if (template) {
			return template;
		}
		const defaultTemplate = templates?.commitPromptTemplateDefault?.trim();
		if (defaultTemplate) {
			return defaultTemplate;
		}
		return "Handle this commit action using the provided git context.";
	}
	const template = templates?.openPrPromptTemplate?.trim();
	if (template) {
		return template;
	}
	const defaultTemplate = templates?.openPrPromptTemplateDefault?.trim();
	if (defaultTemplate) {
		return defaultTemplate;
	}
	return "Handle this pull request action using the provided git context.";
}

/**
 * Builds the agent prompt used for commit and PR actions from the runtime config templates.
 */
export function buildTaskGitActionPrompt(input: {
	action: RuntimeTaskGitAction;
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
	templates?: TaskGitPromptTemplates | null;
}): string {
	const template = resolveTaskGitActionTemplate(input.action, input.templates);
	return template.replaceAll("{{base_ref}}", input.workspaceInfo.baseRef);
}

/**
 * Creates a workspace-scoped coordinator for commit/PR actions so manual and automatic flows
 * share one source of truth about which tasks are already waiting on git work.
 */
export function createRuntimeTaskGitActionCoordinator(): RuntimeTaskGitActionCoordinator {
	const taskStateByWorkspaceId = new Map<string, Map<string, TaskGitActionState>>();

	/**
	 * Returns the mutable per-task state for a workspace, creating it on first write.
	 */
	function getTaskState(workspaceId: string, taskId: string): TaskGitActionState {
		let taskStateByTaskId = taskStateByWorkspaceId.get(workspaceId);
		if (!taskStateByTaskId) {
			taskStateByTaskId = new Map<string, TaskGitActionState>();
			taskStateByWorkspaceId.set(workspaceId, taskStateByTaskId);
		}
		let taskState = taskStateByTaskId.get(taskId);
		if (!taskState) {
			taskState = {
				inFlightAction: null,
				pendingAction: null,
				autoCleanupAction: null,
			};
			taskStateByTaskId.set(taskId, taskState);
		}
		return taskState;
	}

	/**
	 * Removes an empty task-state map after the last action for a workspace has been cleared.
	 */
	function pruneTaskState(workspaceId: string, taskId: string): void {
		const taskStateByTaskId = taskStateByWorkspaceId.get(workspaceId);
		const taskState = taskStateByTaskId?.get(taskId);
		if (!taskStateByTaskId || !taskState) {
			return;
		}
		if (
			taskState.inFlightAction !== null ||
			taskState.pendingAction !== null ||
			taskState.autoCleanupAction !== null
		) {
			return;
		}
		taskStateByTaskId.delete(taskId);
		if (taskStateByTaskId.size === 0) {
			taskStateByWorkspaceId.delete(workspaceId);
		}
	}

	return {
		beginTaskGitAction: (workspaceId, taskId, action) => {
			const taskState = getTaskState(workspaceId, taskId);
			if (taskState.inFlightAction !== null || taskState.pendingAction !== null) {
				return false;
			}
			taskState.inFlightAction = action;
			return true;
		},
		completeTaskGitAction: (workspaceId, taskId, action, options) => {
			const taskState = getTaskState(workspaceId, taskId);
			if (taskState.inFlightAction === action) {
				taskState.inFlightAction = null;
			}
			if (options.dispatched) {
				taskState.pendingAction = action;
				taskState.autoCleanupAction = options.armAutoCleanup ? action : null;
			} else {
				taskState.pendingAction = null;
				taskState.autoCleanupAction = null;
			}
			pruneTaskState(workspaceId, taskId);
		},
		getAutoCleanupTaskGitAction: (workspaceId, taskId) => {
			return taskStateByWorkspaceId.get(workspaceId)?.get(taskId)?.autoCleanupAction ?? null;
		},
		isTaskGitActionBlocked: (workspaceId, taskId) => {
			const taskState = taskStateByWorkspaceId.get(workspaceId)?.get(taskId);
			return Boolean(
				taskState &&
					(taskState.inFlightAction !== null ||
						taskState.pendingAction !== null ||
						taskState.autoCleanupAction !== null),
			);
		},
		clearTaskGitAction: (workspaceId, taskId) => {
			const taskState = taskStateByWorkspaceId.get(workspaceId)?.get(taskId);
			if (!taskState) {
				return;
			}
			taskState.inFlightAction = null;
			taskState.pendingAction = null;
			taskState.autoCleanupAction = null;
			pruneTaskState(workspaceId, taskId);
		},
		disposeWorkspace: (workspaceId) => {
			taskStateByWorkspaceId.delete(workspaceId);
		},
		close: () => {
			taskStateByWorkspaceId.clear();
		},
	};
}
