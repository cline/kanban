import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useGitHistoryData, type UseGitHistoryDataResult } from "@/components/git-history/use-git-history-data";
import { showAppToast } from "@/components/app-toaster";
import { buildTaskGitActionPrompt, type TaskGitAction } from "@/git-actions/build-task-git-action-prompt";
import { useInterval } from "@/utils/react-use";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import {
	getHomeGitSummary,
	getTaskWorkspaceInfo,
	getTaskWorkspaceSnapshot,
	setHomeGitSummary,
	setTaskWorkspaceInfo,
} from "@/stores/workspace-metadata-store";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import type {
	RuntimeConfigResponse,
	RuntimeGitSyncAction,
	RuntimeTaskWorkspaceInfoResponse,
} from "@/runtime/types";
import { findCardSelection } from "@/state/board-state";
import type { BoardCard, BoardData, CardSelection } from "@/types";

const GIT_HISTORY_POLL_INTERVAL_MS = 3000;

type TaskGitActionSource = "card" | "agent";

interface TaskGitActionLoadingState {
	commitSource: TaskGitActionSource | null;
	prSource: TaskGitActionSource | null;
}

interface UseGitActionsInput {
	currentProjectId: string | null;
	board: BoardData;
	selectedCard: CardSelection | null;
	runtimeProjectConfig: RuntimeConfigResponse | null;
	sendTaskSessionInput: (
		taskId: string,
		text: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
	isGitHistoryOpen: boolean;
	isDocumentVisible: boolean;
	refreshWorkspaceState: () => Promise<void>;
	workspaceRevision: number | null;
}

export interface UseGitActionsResult {
	runningGitAction: RuntimeGitSyncAction | null;
	taskGitActionLoadingByTaskId: Record<string, TaskGitActionLoadingState>;
	commitTaskLoadingById: Record<string, boolean>;
	openPrTaskLoadingById: Record<string, boolean>;
	agentCommitTaskLoadingById: Record<string, boolean>;
	agentOpenPrTaskLoadingById: Record<string, boolean>;
	isSwitchingHomeBranch: boolean;
	isDiscardingHomeWorkingChanges: boolean;
	gitActionError: {
		action: RuntimeGitSyncAction;
		message: string;
		output: string;
	} | null;
	gitActionErrorTitle: string;
	clearGitActionError: () => void;
	gitHistory: UseGitHistoryDataResult;
	runGitAction: (action: RuntimeGitSyncAction) => Promise<void>;
	switchHomeBranch: (branch: string) => Promise<void>;
	discardHomeWorkingChanges: () => Promise<void>;
	handleCommitTask: (taskId: string) => void;
	handleOpenPrTask: (taskId: string) => void;
	handleAgentCommitTask: (taskId: string) => void;
	handleAgentOpenPrTask: (taskId: string) => void;
	runAutoReviewGitAction: (taskId: string, action: TaskGitAction) => Promise<boolean>;
	resetGitActionState: () => void;
}

function matchesWorkspaceInfoSelection(
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null,
	card: BoardCard | null,
): workspaceInfo is RuntimeTaskWorkspaceInfoResponse {
	if (!workspaceInfo || !card) {
		return false;
	}
	return workspaceInfo.taskId === card.id && workspaceInfo.baseRef === card.baseRef;
}

export function useGitActions({
	currentProjectId,
	board,
	selectedCard,
	runtimeProjectConfig,
	sendTaskSessionInput,
	fetchTaskWorkspaceInfo,
	isGitHistoryOpen,
	isDocumentVisible,
	refreshWorkspaceState,
	workspaceRevision,
}: UseGitActionsInput): UseGitActionsResult {
	const [runningGitAction, setRunningGitAction] = useState<RuntimeGitSyncAction | null>(null);
	const [taskGitActionLoadingByTaskId, setTaskGitActionLoadingByTaskId] = useState<
		Record<string, TaskGitActionLoadingState>
	>({});
	const [isSwitchingHomeBranch, setIsSwitchingHomeBranch] = useState(false);
	const [isDiscardingHomeWorkingChanges, setIsDiscardingHomeWorkingChanges] = useState(false);
	const [gitActionError, setGitActionError] = useState<{
		action: RuntimeGitSyncAction;
		message: string;
		output: string;
	} | null>(null);

	const gitHistoryTaskScope = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return {
			taskId: selectedCard.card.id,
			baseRef: selectedCard.card.baseRef,
		};
	}, [selectedCard?.card.baseRef, selectedCard?.card.id]);

	const gitHistory = useGitHistoryData({
		workspaceId: currentProjectId,
		taskScope: gitHistoryTaskScope,
		gitSummary: selectedCard ? null : getHomeGitSummary(),
		enabled: isGitHistoryOpen,
	});
	const refreshGitHistory = gitHistory.refresh;
	const homeGitSummaryRef = useRef(getHomeGitSummary());

	const setTaskGitActionLoading = useCallback(
		(taskId: string, action: TaskGitAction, source: TaskGitActionSource | null) => {
			setTaskGitActionLoadingByTaskId((current) => {
				const existing = current[taskId] ?? { commitSource: null, prSource: null };
				const key = action === "commit" ? "commitSource" : "prSource";
				if (existing[key] === source) {
					return current;
				}
				const nextEntry: TaskGitActionLoadingState = {
					...existing,
					[key]: source,
				};
				if (nextEntry.commitSource === null && nextEntry.prSource === null) {
					const { [taskId]: _removed, ...rest } = current;
					return rest;
				}
				return {
					...current,
					[taskId]: nextEntry,
				};
			});
		},
		[],
	);

	const commitTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.commitSource === "card") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const openPrTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.prSource === "card") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const agentCommitTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.commitSource === "agent") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const agentOpenPrTaskLoadingById = useMemo(() => {
		const next: Record<string, boolean> = {};
		for (const [taskId, loading] of Object.entries(taskGitActionLoadingByTaskId)) {
			if (loading.prSource === "agent") {
				next[taskId] = true;
			}
		}
		return next;
	}, [taskGitActionLoadingByTaskId]);

	const runTaskGitAction = useCallback(
		async (taskId: string, action: TaskGitAction, source: TaskGitActionSource) => {
			const taskLoadingState = taskGitActionLoadingByTaskId[taskId];
			const actionInFlightSource = action === "commit" ? taskLoadingState?.commitSource : taskLoadingState?.prSource;
			if (actionInFlightSource !== null && actionInFlightSource !== undefined) {
				return false;
			}
			setTaskGitActionLoading(taskId, action, source);
			try {
				const selection = findCardSelection(board, taskId);
				if (!selection) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not find the selected task card.",
						timeout: 5000,
					});
					return false;
				}
				if (selection.column.id !== "review") {
					showAppToast({
						intent: "warning",
						icon: "warning-sign",
						message: "Commit and PR actions are only available for tasks in Review.",
						timeout: 5000,
					});
					return false;
				}

				const snapshot = getTaskWorkspaceSnapshot(taskId);
				const snapshotWorkspaceInfo = snapshot
					? {
							taskId,
							path: snapshot.path,
							exists: true,
							baseRef: selection.card.baseRef,
							branch: snapshot.branch,
							isDetached: snapshot.isDetached,
							headCommit: snapshot.headCommit,
						}
					: null;
				const storedWorkspaceInfo = getTaskWorkspaceInfo(selection.card.id, selection.card.baseRef);
				const workspaceInfo = matchesWorkspaceInfoSelection(storedWorkspaceInfo, selection.card)
					? storedWorkspaceInfo
					: (snapshotWorkspaceInfo ?? (await fetchTaskWorkspaceInfo(selection.card)));
				if (!workspaceInfo) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: "Could not resolve task workspace details.",
						timeout: 6000,
					});
					return false;
				}
				setTaskWorkspaceInfo(workspaceInfo);

				const prompt = buildTaskGitActionPrompt({
					action,
					workspaceInfo,
					templates: runtimeProjectConfig
						? {
								commitPromptTemplate: runtimeProjectConfig.commitPromptTemplate,
								openPrPromptTemplate: runtimeProjectConfig.openPrPromptTemplate,
								commitPromptTemplateDefault: runtimeProjectConfig.commitPromptTemplateDefault,
								openPrPromptTemplateDefault: runtimeProjectConfig.openPrPromptTemplateDefault,
							}
						: null,
				});
				const typed = await sendTaskSessionInput(taskId, prompt, { appendNewline: false, mode: "paste" });
				if (!typed.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: typed.message ?? "Could not send instructions to the task session.",
						timeout: 7000,
					});
					return false;
				}
				await new Promise<void>((resolve) => {
					window.setTimeout(resolve, 200);
				});
				const submitted = await sendTaskSessionInput(taskId, "\r", { appendNewline: false });
				if (!submitted.ok) {
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: submitted.message ?? "Could not submit instructions to the task session.",
						timeout: 7000,
					});
					return false;
				}
				return true;
			} finally {
				setTaskGitActionLoading(taskId, action, null);
			}
		},
		[
			board,
			fetchTaskWorkspaceInfo,
			runtimeProjectConfig,
			sendTaskSessionInput,
			setTaskGitActionLoading,
			taskGitActionLoadingByTaskId,
		],
	);

	const handleCommitTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "commit", "card");
		},
		[runTaskGitAction],
	);

	const handleOpenPrTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "pr", "card");
		},
		[runTaskGitAction],
	);

	const handleAgentCommitTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "commit", "agent");
		},
		[runTaskGitAction],
	);

	const handleAgentOpenPrTask = useCallback(
		(taskId: string) => {
			void runTaskGitAction(taskId, "pr", "agent");
		},
		[runTaskGitAction],
	);

	const refreshGitSummary = useCallback(async () => {
		if (!currentProjectId) {
			homeGitSummaryRef.current = null;
			setHomeGitSummary(null);
			return;
		}
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.getGitSummary.query(null);
			if (!payload.ok || !payload.summary) {
				throw new Error(payload.error ?? "Git summary request failed.");
			}
			homeGitSummaryRef.current = payload.summary;
			setHomeGitSummary(payload.summary);
		} catch {
			// Keep the last known summary; transient failures should not synthesize fake git state.
		}
	}, [currentProjectId]);

	useInterval(
		() => {
			if (
				!isGitHistoryOpen ||
				!currentProjectId ||
				!isDocumentVisible ||
				runningGitAction !== null ||
				isSwitchingHomeBranch ||
				isDiscardingHomeWorkingChanges
			) {
				return;
			}
			void (async () => {
				await refreshGitSummary();
				refreshGitHistory({ background: true });
			})();
		},
		isGitHistoryOpen && currentProjectId && isDocumentVisible ? GIT_HISTORY_POLL_INTERVAL_MS : null,
	);

	const runGitAction = useCallback(
		async (action: RuntimeGitSyncAction) => {
			if (!currentProjectId || runningGitAction || isSwitchingHomeBranch) {
				return;
			}
			setRunningGitAction(action);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.runGitSyncAction.mutate({ action });
				if (!payload.ok || !payload.summary) {
					const errorMessage = payload.error ?? `${action} failed.`;
					const output = payload.output ?? "";
					const fallbackSummary = payload.summary ?? null;
					if (fallbackSummary) {
						homeGitSummaryRef.current = fallbackSummary;
						setHomeGitSummary(fallbackSummary);
					}
					setGitActionError({
						action,
						message: errorMessage,
						output,
					});
					return;
				}
				homeGitSummaryRef.current = payload.summary;
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setGitActionError({
					action,
					message,
					output: "",
				});
			} finally {
				setRunningGitAction(null);
			}
		},
		[currentProjectId, isSwitchingHomeBranch, refreshGitHistory, runningGitAction],
	);

	const switchHomeBranch = useCallback(
		async (branch: string) => {
			const normalizedBranch = branch.trim();
			const currentBranch = getHomeGitSummary()?.currentBranch ?? null;
			if (!currentProjectId || isSwitchingHomeBranch || !normalizedBranch || normalizedBranch === currentBranch) {
				return;
			}
			setIsSwitchingHomeBranch(true);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.workspace.checkoutGitBranch.mutate({
					branch: normalizedBranch,
				});
				if (!payload.ok || !payload.summary) {
					const errorMessage = payload.error ?? "Switch branch failed.";
					const fallbackSummary = payload.summary ?? null;
					if (fallbackSummary) {
						homeGitSummaryRef.current = fallbackSummary;
						setHomeGitSummary(fallbackSummary);
					}
					showAppToast({
						intent: "danger",
						icon: "warning-sign",
						message: `Could not switch to ${normalizedBranch}. ${errorMessage}`,
						timeout: 7000,
					});
					return;
				}
				homeGitSummaryRef.current = payload.summary;
				setHomeGitSummary(payload.summary);
				refreshGitHistory();
				await refreshWorkspaceState();
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: `Could not switch to ${normalizedBranch}. ${message}`,
					timeout: 7000,
				});
			} finally {
				setIsSwitchingHomeBranch(false);
			}
		},
		[currentProjectId, isSwitchingHomeBranch, refreshGitHistory, refreshWorkspaceState],
	);

	const discardHomeWorkingChanges = useCallback(async () => {
		if (!currentProjectId || isDiscardingHomeWorkingChanges) {
			return;
		}
		setIsDiscardingHomeWorkingChanges(true);
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const payload = await trpcClient.workspace.discardGitChanges.mutate(null);
			if (!payload.ok) {
				if (payload.summary) {
					homeGitSummaryRef.current = payload.summary;
					setHomeGitSummary(payload.summary);
				}
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: payload.error ?? "Could not discard working copy changes.",
					timeout: 7000,
				});
				return;
			}
			homeGitSummaryRef.current = payload.summary;
			setHomeGitSummary(payload.summary);
			refreshGitHistory();
			showAppToast({
				intent: "success",
				icon: "tick",
				message: "Discarded working copy changes.",
				timeout: 4000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message: `Could not discard working copy changes. ${message}`,
				timeout: 7000,
			});
		} finally {
			setIsDiscardingHomeWorkingChanges(false);
		}
	}, [currentProjectId, isDiscardingHomeWorkingChanges, refreshGitHistory]);

	useEffect(() => {
		if (!currentProjectId || !isDocumentVisible || selectedCard || isGitHistoryOpen) {
			return;
		}
		void refreshGitSummary();
	}, [currentProjectId, isDocumentVisible, isGitHistoryOpen, refreshGitSummary, selectedCard, workspaceRevision]);

	const runAutoReviewGitAction = useCallback(
		async (taskId: string, action: TaskGitAction) => {
			return await runTaskGitAction(taskId, action, "card");
		},
		[runTaskGitAction],
	);

	const resetGitActionState = useCallback(() => {
		homeGitSummaryRef.current = null;
		setHomeGitSummary(null);
		setRunningGitAction(null);
		setTaskGitActionLoadingByTaskId({});
		setIsSwitchingHomeBranch(false);
		setIsDiscardingHomeWorkingChanges(false);
		setGitActionError(null);
	}, []);

	const gitActionErrorTitle = useMemo(() => {
		if (!gitActionError) {
			return "Git action failed";
		}
		if (gitActionError.action === "fetch") {
			return "Fetch failed";
		}
		if (gitActionError.action === "pull") {
			return "Pull failed";
		}
		return "Push failed";
	}, [gitActionError]);

	return {
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isSwitchingHomeBranch,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError: () => {
			setGitActionError(null);
		},
		gitHistory,
		runGitAction,
		switchHomeBranch,
		discardHomeWorkingChanges,
		handleCommitTask,
		handleOpenPrTask,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	};
}
