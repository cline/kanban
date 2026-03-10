import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";

import { estimateTaskSessionGeometry } from "@/runtime/task-session-geometry";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { trackTaskResumedFromTrash } from "@/telemetry/events";
import { getTerminalController } from "@/terminal/terminal-controller-registry";
import { getTerminalGeometry } from "@/terminal/terminal-geometry-registry";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type {
	RuntimeTaskSessionSummary,
	RuntimeTaskWorkspaceInfoResponse,
	RuntimeWorktreeDeleteResponse,
	RuntimeWorktreeEnsureResponse,
} from "@/runtime/types";
import type { BoardCard, ReviewTaskWorkspaceSnapshot } from "@/types";

interface UseTaskSessionsInput {
	currentProjectId: string | null;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	onWorktreeError: (message: string | null) => void;
}

interface EnsureTaskWorkspaceResult {
	ok: boolean;
	message?: string;
	response?: Extract<RuntimeWorktreeEnsureResponse, { ok: true }>;
}

interface SendTaskSessionInputResult {
	ok: boolean;
	message?: string;
}

interface StartTaskSessionResult {
	ok: boolean;
	message?: string;
}

interface StartTaskSessionOptions {
	resumeFromTrash?: boolean;
}

export interface UseTaskSessionsResult {
	upsertSession: (summary: RuntimeTaskSessionSummary) => void;
	ensureTaskWorkspace: (task: BoardCard) => Promise<EnsureTaskWorkspaceResult>;
	startTaskSession: (task: BoardCard, options?: StartTaskSessionOptions) => Promise<StartTaskSessionResult>;
	stopTaskSession: (taskId: string) => Promise<void>;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<SendTaskSessionInputResult>;
	cleanupTaskWorkspace: (taskId: string) => Promise<RuntimeWorktreeDeleteResponse | null>;
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
	fetchTaskWorkingChangeCount: (task: BoardCard) => Promise<number | null>;
	fetchReviewWorkspaceSnapshot: (task: BoardCard) => Promise<ReviewTaskWorkspaceSnapshot | null>;
}

export function useTaskSessions({
	currentProjectId,
	setSessions,
	onWorktreeError,
}: UseTaskSessionsInput): UseTaskSessionsResult {
	const upsertSession = useCallback(
		(summary: RuntimeTaskSessionSummary) => {
			setSessions((current) => ({
				...current,
				[summary.taskId]: summary,
			}));
		},
		[setSessions],
	);

	const ensureTaskWorkspace = useCallback(
		async (task: BoardCard): Promise<EnsureTaskWorkspaceResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.ensureWorktree.mutate({
					taskId: task.id,
					baseRef: task.baseRef,
				});
				if (!payload.ok) {
					return {
						ok: false,
						message: payload.error ?? "Worktree setup failed.",
					};
				}
				return { ok: true, response: payload };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, message };
			}
		},
		[currentProjectId],
	);

	const startTaskSession = useCallback(
		async (task: BoardCard, options?: StartTaskSessionOptions): Promise<StartTaskSessionResult> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const kickoffPrompt = options?.resumeFromTrash ? "" : task.prompt.trim();
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const geometry =
					getTerminalGeometry(task.id) ?? estimateTaskSessionGeometry(window.innerWidth, window.innerHeight);
				const payload = await trpcClient.runtime.startTaskSession.mutate({
					taskId: task.id,
					prompt: kickoffPrompt,
					startInPlanMode: options?.resumeFromTrash ? undefined : task.startInPlanMode,
					resumeFromTrash: options?.resumeFromTrash,
					baseRef: task.baseRef,
					cols: geometry.cols,
					rows: geometry.rows,
				});
				if (!payload.ok || !payload.summary) {
					return {
						ok: false,
						message: payload.error ?? "Task session start failed.",
					};
				}
				upsertSession(payload.summary);
				if (options?.resumeFromTrash) {
					trackTaskResumedFromTrash();
				}
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, message };
			}
		},
		[currentProjectId, upsertSession],
	);

	const stopTaskSession = useCallback(
		async (taskId: string): Promise<void> => {
			if (!currentProjectId) {
				return;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				await trpcClient.runtime.stopTaskSession.mutate({ taskId });
			} catch {
				// Ignore stop errors during cleanup.
			}
		},
		[currentProjectId],
	);

	const sendTaskSessionInput = useCallback(
		async (
			taskId: string,
			text: string,
			options?: SendTerminalInputOptions,
		): Promise<SendTaskSessionInputResult> => {
			const appendNewline = options?.appendNewline ?? true;
			const controller = options?.preferTerminal === false ? null : getTerminalController(taskId);
			if (controller) {
				const sent =
					options?.mode === "paste"
						? !appendNewline && controller.paste(text)
						: controller.input(appendNewline ? `${text}\n` : text);
				if (sent) {
					return { ok: true };
				}
			}
			if (!currentProjectId) {
				return { ok: false, message: "No project selected." };
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.runtime.sendTaskSessionInput.mutate({
					taskId,
					text,
					appendNewline,
				});
				if (!payload.ok) {
					const errorMessage = payload.error || "Task session input failed.";
					return { ok: false, message: errorMessage };
				}
				if (payload.summary) {
					upsertSession(payload.summary);
				}
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, message };
			}
		},
		[currentProjectId, upsertSession],
	);

	const cleanupTaskWorkspace = useCallback(
		async (taskId: string): Promise<RuntimeWorktreeDeleteResponse | null> => {
			if (!currentProjectId) {
				return null;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.deleteWorktree.mutate({ taskId });
				if (!payload.ok) {
					const message = payload.error ?? "Could not clean up task workspace.";
					console.error(`[cleanupTaskWorkspace] ${message}`);
					return null;
				}
				return payload;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[cleanupTaskWorkspace] ${message}`);
				return null;
			}
		},
		[currentProjectId],
	);

	const fetchTaskWorkspaceInfo = useCallback(
		async (task: BoardCard): Promise<RuntimeTaskWorkspaceInfoResponse | null> => {
			if (!currentProjectId) {
				return null;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				return await trpcClient.workspace.getTaskContext.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				onWorktreeError(message);
				return null;
			}
		},
		[currentProjectId, onWorktreeError],
	);

	const fetchTaskWorkingChangeCount = useCallback(
		async (task: BoardCard): Promise<number | null> => {
			if (!currentProjectId) {
				return null;
			}
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.getGitSummary.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
				if (!payload.ok) {
					console.error(`[fetchTaskWorkingChangeCount] ${payload.error ?? "Workspace summary request failed."}`);
					return null;
				}
				return payload.summary.changedFiles;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(`[fetchTaskWorkingChangeCount] ${message}`);
				return null;
			}
		},
		[currentProjectId],
	);

	const fetchReviewWorkspaceSnapshot = useCallback(
		async (task: BoardCard): Promise<ReviewTaskWorkspaceSnapshot | null> => {
			if (!currentProjectId) {
				return null;
			}

			let workspaceInfo: RuntimeTaskWorkspaceInfoResponse;
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				workspaceInfo = await trpcClient.workspace.getTaskContext.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
			} catch {
				return null;
			}

			let changedFiles: number | null = null;
			let additions: number | null = null;
			let deletions: number | null = null;
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const summaryPayload = await trpcClient.workspace.getGitSummary.query({
					taskId: task.id,
					baseRef: task.baseRef,
				});
				if (summaryPayload.ok) {
					changedFiles = summaryPayload.summary.changedFiles;
					additions = summaryPayload.summary.additions;
					deletions = summaryPayload.summary.deletions;
				}
			} catch {
				// Swallow errors: this snapshot is informational and should never block review cards.
			}

			return {
				taskId: task.id,
				path: workspaceInfo.path,
				branch: workspaceInfo.branch,
				isDetached: workspaceInfo.isDetached,
				headCommit: workspaceInfo.headCommit,
				changedFiles,
				additions,
				deletions,
			};
		},
		[currentProjectId],
	);

	return {
		upsertSession,
		ensureTaskWorkspace,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		cleanupTaskWorkspace,
		fetchTaskWorkspaceInfo,
		fetchTaskWorkingChangeCount,
		fetchReviewWorkspaceSnapshot,
	};
}
