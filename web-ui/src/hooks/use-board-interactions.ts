import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { DropResult } from "@hello-pangea/dnd";

import { useProgrammaticCardMoves } from "@/hooks/use-programmatic-card-moves";
import { useReviewAutoActions } from "@/hooks/use-review-auto-actions";
import type { UseTaskSessionsResult } from "@/hooks/use-task-sessions";
import type { SendTerminalInputOptions } from "@/terminal/terminal-input";
import { showAppToast } from "@/components/app-toaster";
import { useLinkedBacklogTaskActions, type PendingTrashWarningState } from "@/hooks/use-linked-backlog-task-actions";
import type { RuntimeTaskSessionSummary, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import {
	applyDragResult,
	clearColumnTasks,
	disableTaskAutoReview,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
	updateTask,
} from "@/state/board-state";
import {
	getBrowserNotificationPermission,
	hasPromptedForBrowserNotificationPermission,
	requestBrowserNotificationPermission,
} from "@/utils/notification-permission";
import type {
	BoardCard,
	BoardColumnId,
	BoardData,
	ReviewTaskWorkspaceSnapshot,
} from "@/types";
import { resolveTaskAutoReviewMode } from "@/types";
import { getNextDetailTaskIdAfterTrashMove } from "@/utils/detail-view-task-order";
import type { TaskGitAction } from "@/git-actions/build-task-git-action-prompt";

interface TaskGitActionLoadingStateLike {
	commitSource: string | null;
	prSource: string | null;
}

interface SelectedBoardCard {
	card: BoardCard;
	column: {
		id: BoardColumnId;
	};
}

interface UseBoardInteractionsInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	selectedCard: SelectedBoardCard | null;
	selectedTaskId: string | null;
	selectedTaskWorkspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
	workspaceSnapshots: Record<string, ReviewTaskWorkspaceSnapshot>;
	currentProjectId: string | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	setSelectedTaskWorkspaceInfo: Dispatch<SetStateAction<RuntimeTaskWorkspaceInfoResponse | null>>;
	setPendingTrashWarning: Dispatch<SetStateAction<PendingTrashWarningState | null>>;
	setIsClearTrashDialogOpen: Dispatch<SetStateAction<boolean>>;
	setIsGitHistoryOpen: Dispatch<SetStateAction<boolean>>;
	stopTaskSession: (taskId: string) => Promise<void>;
	cleanupTaskWorkspace: (taskId: string) => Promise<unknown>;
	ensureTaskWorkspace: UseTaskSessionsResult["ensureTaskWorkspace"];
	startTaskSession: UseTaskSessionsResult["startTaskSession"];
	fetchTaskWorkingChangeCount: (task: BoardCard) => Promise<number | null>;
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
	sendTaskSessionInput: (
		taskId: string,
		input: string,
		options?: SendTerminalInputOptions,
	) => Promise<{ ok: boolean; message?: string }>;
	onWorktreeError: (message: string | null) => void;
	readyForReviewNotificationsEnabled: boolean;
	taskGitActionLoadingByTaskId: Record<string, TaskGitActionLoadingStateLike>;
	runAutoReviewGitAction: (taskId: string, action: TaskGitAction) => Promise<boolean>;
}

export interface UseBoardInteractionsResult {
	handleProgrammaticCardMoveReady: ReturnType<typeof useProgrammaticCardMoves>["handleProgrammaticCardMoveReady"];
	confirmMoveTaskToTrash: (
		task: BoardCard,
		currentBoard?: BoardData,
	) => Promise<void>;
	handleCreateDependency: (fromTaskId: string, toTaskId: string) => void;
	handleDeleteDependency: (dependencyId: string) => void;
	handleDragEnd: (result: DropResult, options?: { selectDroppedTask?: boolean }) => void;
	handleStartTask: (taskId: string) => void;
	handleDetailTaskDragEnd: (result: DropResult) => void;
	handleCardSelect: (taskId: string) => void;
	handleMoveToTrash: () => void;
	handleMoveReviewCardToTrash: (taskId: string) => void;
	handleRestoreTaskFromTrash: (taskId: string) => void;
	handleCancelAutomaticTaskAction: (taskId: string) => void;
	handleOpenClearTrash: () => void;
	handleConfirmClearTrash: () => void;
	handleAddReviewComments: (taskId: string, text: string) => Promise<void>;
	handleSendReviewComments: (taskId: string, text: string) => Promise<void>;
	trashTaskCount: number;
}

export function useBoardInteractions({
	board,
	setBoard,
	sessions,
	setSessions,
	selectedCard,
	selectedTaskId,
	selectedTaskWorkspaceInfo,
	workspaceSnapshots,
	currentProjectId,
	setSelectedTaskId,
	setSelectedTaskWorkspaceInfo,
	setPendingTrashWarning,
	setIsClearTrashDialogOpen,
	setIsGitHistoryOpen,
	stopTaskSession,
	cleanupTaskWorkspace,
	ensureTaskWorkspace,
	startTaskSession,
	fetchTaskWorkingChangeCount,
	fetchTaskWorkspaceInfo,
	sendTaskSessionInput,
	onWorktreeError,
	readyForReviewNotificationsEnabled,
	taskGitActionLoadingByTaskId,
	runAutoReviewGitAction,
}: UseBoardInteractionsInput): UseBoardInteractionsResult {
	const previousSessionsRef = useRef<Record<string, RuntimeTaskSessionSummary>>({});
	const notificationPermissionPromptInFlightRef = useRef(false);
	const {
		handleProgrammaticCardMoveReady,
		setRequestMoveTaskToTrashHandler,
		tryProgrammaticCardMove,
		consumeProgrammaticCardMove,
		resolvePendingProgrammaticTrashMove,
		resetProgrammaticCardMoves,
		requestMoveTaskToTrashWithAnimation,
		programmaticCardMoveCycle,
	} = useProgrammaticCardMoves();

	const handleAddReviewComments = useCallback(
		async (taskId: string, text: string) => {
			const typed = await sendTaskSessionInput(taskId, text, { appendNewline: false, mode: "paste" });
			if (!typed.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: typed.message ?? "Could not add review comments to the task session.",
					timeout: 7000,
				});
			}
		},
		[sendTaskSessionInput],
	);

	const handleSendReviewComments = useCallback(
		async (taskId: string, text: string) => {
			const typed = await sendTaskSessionInput(taskId, text, { appendNewline: false, mode: "paste" });
			if (!typed.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: typed.message ?? "Could not send review comments to the task session.",
					timeout: 7000,
				});
				return;
			}
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 200);
			});
			const submitted = await sendTaskSessionInput(taskId, "\r", { appendNewline: false });
			if (!submitted.ok) {
				showAppToast({
					intent: "danger",
					icon: "warning-sign",
					message: submitted.message ?? "Could not submit review comments to the task session.",
					timeout: 7000,
				});
			}
		},
		[sendTaskSessionInput],
	);

	const trashTaskIds = useMemo(() => {
		const trashColumn = board.columns.find((column) => column.id === "trash");
		return trashColumn ? trashColumn.cards.map((card) => card.id) : [];
	}, [board.columns]);
	const trashTaskCount = trashTaskIds.length;

	const maybeRequestNotificationPermissionForTaskStart = useCallback(() => {
		const shouldPromptForNotificationPermission =
			readyForReviewNotificationsEnabled &&
			getBrowserNotificationPermission() === "default" &&
			!hasPromptedForBrowserNotificationPermission() &&
			!notificationPermissionPromptInFlightRef.current;
		if (!shouldPromptForNotificationPermission) {
			return;
		}
		notificationPermissionPromptInFlightRef.current = true;
		void requestBrowserNotificationPermission().finally(() => {
			notificationPermissionPromptInFlightRef.current = false;
		});
	}, [readyForReviewNotificationsEnabled]);

	const kickoffTaskInProgress = useCallback(
		async (
			task: BoardCard,
			taskId: string,
			fromColumnId: BoardColumnId,
			options?: { optimisticMove?: boolean },
		): Promise<boolean> => {
			const optimisticMove = options?.optimisticMove ?? true;
			const ensured = await ensureTaskWorkspace(task);
			if (!ensured.ok) {
				onWorktreeError(ensured.message ?? "Could not set up task workspace.");
				if (optimisticMove) {
					setBoard((currentBoard) => {
						const currentColumnId = getTaskColumnId(currentBoard, taskId);
						if (currentColumnId !== "in_progress") {
							return currentBoard;
						}
						const reverted = moveTaskToColumn(currentBoard, taskId, fromColumnId);
						return reverted.moved ? reverted.board : currentBoard;
					});
				}
				return false;
			}
			if (selectedTaskId === taskId) {
				if (ensured.response) {
					setSelectedTaskWorkspaceInfo({
						taskId,
						path: ensured.response.path,
						exists: true,
						baseRef: ensured.response.baseRef,
						branch: null,
						isDetached: true,
						headCommit: ensured.response.baseCommit,
					});
				}
				const infoAfterEnsure = await fetchTaskWorkspaceInfo(task);
				if (infoAfterEnsure) {
					setSelectedTaskWorkspaceInfo(infoAfterEnsure);
				}
			}
			const started = await startTaskSession(task);
			if (!started.ok) {
				onWorktreeError(started.message ?? "Could not start task session.");
				if (optimisticMove) {
					setBoard((currentBoard) => {
						const currentColumnId = getTaskColumnId(currentBoard, taskId);
						if (currentColumnId !== "in_progress") {
							return currentBoard;
						}
						const reverted = moveTaskToColumn(currentBoard, taskId, fromColumnId);
						return reverted.moved ? reverted.board : currentBoard;
					});
				}
				return false;
			}
			if (!optimisticMove) {
				setBoard((currentBoard) => {
					const currentColumnId = getTaskColumnId(currentBoard, taskId);
					if (currentColumnId !== fromColumnId) {
						return currentBoard;
					}
					const moved = moveTaskToColumn(currentBoard, taskId, "in_progress", { insertAtTop: true });
					return moved.moved ? moved.board : currentBoard;
				});
			}
			onWorktreeError(null);
			return true;
		},
		[
			ensureTaskWorkspace,
			fetchTaskWorkspaceInfo,
			onWorktreeError,
			selectedTaskId,
			setBoard,
			setSelectedTaskWorkspaceInfo,
			startTaskSession,
		],
	);

	useEffect(() => {
		setBoard((currentBoard) => {
			let nextBoard = currentBoard;
			const previousSessions = previousSessionsRef.current;
			const blockedInterruptedTaskIds = new Set<string>();
			for (const summary of Object.values(sessions)) {
				const previous = previousSessions[summary.taskId];
				if (previous && previous.updatedAt > summary.updatedAt) {
					continue;
				}
				const columnId = getTaskColumnId(nextBoard, summary.taskId);
				if (summary.state === "awaiting_review" && columnId === "in_progress") {
					const programmaticMoveAttempt = tryProgrammaticCardMove(summary.taskId, columnId, "review");
					if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
						continue;
					}
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "review", { insertAtTop: true });
					if (moved.moved) {
						nextBoard = moved.board;
					}
					continue;
				}
				if (summary.state === "running" && columnId === "review") {
					const programmaticMoveAttempt = tryProgrammaticCardMove(summary.taskId, columnId, "in_progress", {
						skipKickoff: true,
					});
					if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
						continue;
					}
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "in_progress", { insertAtTop: true });
					if (moved.moved) {
						nextBoard = moved.board;
					}
					continue;
				}
				if (
					summary.state === "interrupted" &&
					previous?.state !== "interrupted" &&
					columnId &&
					columnId !== "trash"
				) {
					const nextTaskId = getNextDetailTaskIdAfterTrashMove(nextBoard, summary.taskId);
					const programmaticMoveAttempt = tryProgrammaticCardMove(summary.taskId, columnId, "trash", {
						skipTrashWorkflow: true,
					});
					if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
						if (programmaticMoveAttempt === "blocked") {
							blockedInterruptedTaskIds.add(summary.taskId);
						}
						setSelectedTaskId((currentSelectedTaskId) =>
							currentSelectedTaskId === summary.taskId ? nextTaskId : currentSelectedTaskId,
						);
						continue;
					}
					const moved = moveTaskToColumn(nextBoard, summary.taskId, "trash", { insertAtTop: true });
					if (moved.moved) {
						setSelectedTaskId((currentSelectedTaskId) =>
							currentSelectedTaskId === summary.taskId ? nextTaskId : currentSelectedTaskId,
						);
						nextBoard = moved.board;
					}
				}
			}
			const nextPreviousSessions = { ...sessions };
			for (const taskId of blockedInterruptedTaskIds) {
				const previousSession = previousSessions[taskId];
				if (previousSession) {
					nextPreviousSessions[taskId] = previousSession;
					continue;
				}
				delete nextPreviousSessions[taskId];
			}
			previousSessionsRef.current = nextPreviousSessions;
			return nextBoard;
		});
	}, [programmaticCardMoveCycle, sessions, setBoard, setSelectedTaskId, tryProgrammaticCardMove]);

	const { confirmMoveTaskToTrash, handleCreateDependency, handleDeleteDependency, requestMoveTaskToTrash } =
		useLinkedBacklogTaskActions({
			board,
			setBoard,
			selectedTaskWorkspaceInfo,
			setSelectedTaskId,
			setPendingTrashWarning,
			stopTaskSession,
			cleanupTaskWorkspace,
			fetchTaskWorkingChangeCount,
			fetchTaskWorkspaceInfo,
			maybeRequestNotificationPermissionForTaskStart,
			kickoffTaskInProgress,
		});

	useEffect(() => {
		setRequestMoveTaskToTrashHandler(requestMoveTaskToTrash);
	}, [requestMoveTaskToTrash, setRequestMoveTaskToTrashHandler]);

	useReviewAutoActions({
		board,
		workspaceSnapshots,
		taskGitActionLoadingByTaskId,
		runAutoReviewGitAction,
		requestMoveTaskToTrash: requestMoveTaskToTrashWithAnimation,
		resetKey: currentProjectId,
	});

	const resumeTaskFromTrash = useCallback(
		async (task: BoardCard, taskId: string, options?: { optimisticMoveApplied?: boolean }): Promise<void> => {
			const resumed = await startTaskSession(task, { resumeFromTrash: true });
			if (resumed.ok) {
				setBoard((currentBoard) => {
					const disabledAutoReview = disableTaskAutoReview(currentBoard, taskId);
					return disabledAutoReview.updated ? disabledAutoReview.board : currentBoard;
				});
				onWorktreeError(null);
				return;
			}

			onWorktreeError(resumed.message ?? "Could not resume task session.");
			if (!options?.optimisticMoveApplied) {
				return;
			}
			setBoard((currentBoard) => {
				const currentColumnId = getTaskColumnId(currentBoard, taskId);
				if (currentColumnId !== "review") {
					return currentBoard;
				}
				const reverted = moveTaskToColumn(currentBoard, taskId, "trash", {
					insertAtTop: true,
				});
				return reverted.moved ? reverted.board : currentBoard;
			});
		},
		[onWorktreeError, setBoard, startTaskSession],
	);

	const handleDragEnd = useCallback(
		(result: DropResult, options?: { selectDroppedTask?: boolean }) => {
			if (options?.selectDroppedTask && result.type.startsWith("CARD") && result.destination) {
				setSelectedTaskId(result.draggableId);
			}
			const { behavior: programmaticMoveBehavior, programmaticCardMoveInFlight } = consumeProgrammaticCardMove(
				result.draggableId,
			);

			const applied = applyDragResult(board, result, { programmaticCardMoveInFlight });

			const moveEvent = applied.moveEvent;
			if (!moveEvent) {
				setBoard(applied.board);
				return;
			}

			if (moveEvent.toColumnId === "trash") {
				setBoard(applied.board);
				if (programmaticMoveBehavior?.skipTrashWorkflow) {
					resolvePendingProgrammaticTrashMove(moveEvent.taskId);
					return;
				}
				const requestPromise = requestMoveTaskToTrash(moveEvent.taskId, moveEvent.fromColumnId, {
					optimisticMoveApplied: true,
					skipWorkingChangeWarning: programmaticMoveBehavior?.skipWorkingChangeWarning,
				});
				void requestPromise.finally(() => {
					resolvePendingProgrammaticTrashMove(moveEvent.taskId);
				});
				return;
			}

			if (moveEvent.fromColumnId === "trash" && moveEvent.toColumnId === "review") {
				setBoard(applied.board);
				const movedSelection = findCardSelection(applied.board, moveEvent.taskId);
				if (!movedSelection) {
					return;
				}
				void resumeTaskFromTrash(movedSelection.card, moveEvent.taskId, { optimisticMoveApplied: true });
				return;
			}

			setBoard(applied.board);

			if (
				moveEvent.toColumnId === "in_progress" &&
				moveEvent.fromColumnId === "backlog" &&
				!programmaticMoveBehavior?.skipKickoff
			) {
				maybeRequestNotificationPermissionForTaskStart();
				const movedSelection = findCardSelection(applied.board, moveEvent.taskId);
				if (movedSelection) {
					void kickoffTaskInProgress(movedSelection.card, moveEvent.taskId, moveEvent.fromColumnId);
				}
			}
		},
		[
			board,
			consumeProgrammaticCardMove,
			kickoffTaskInProgress,
			maybeRequestNotificationPermissionForTaskStart,
			requestMoveTaskToTrash,
			resumeTaskFromTrash,
			resolvePendingProgrammaticTrashMove,
			setBoard,
			setSelectedTaskId,
		],
	);

	const handleStartTask = useCallback(
		(taskId: string) => {
			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "backlog") {
				return;
			}
			const programmaticMoveAttempt = tryProgrammaticCardMove(taskId, selection.column.id, "in_progress");
			if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
				return;
			}
			const moved = moveTaskToColumn(board, taskId, "in_progress", { insertAtTop: true });
			if (!moved.moved) {
				return;
			}
			setBoard(moved.board);
			const movedSelection = findCardSelection(moved.board, taskId);
			maybeRequestNotificationPermissionForTaskStart();
			if (movedSelection) {
				void kickoffTaskInProgress(movedSelection.card, taskId, "backlog");
			}
		},
		[board, kickoffTaskInProgress, maybeRequestNotificationPermissionForTaskStart, setBoard, tryProgrammaticCardMove],
	);

	const handleDetailTaskDragEnd = useCallback(
		(result: DropResult) => {
			handleDragEnd(result);
		},
		[handleDragEnd],
	);

	const handleCardSelect = useCallback(
		(taskId: string) => {
			setSelectedTaskId(taskId);
			setIsGitHistoryOpen(false);
		},
		[setIsGitHistoryOpen, setSelectedTaskId],
	);

	const handleMoveToTrash = useCallback(() => {
		if (!selectedCard) {
			return;
		}
		const programmaticMoveAttempt = tryProgrammaticCardMove(selectedCard.card.id, selectedCard.column.id, "trash");
		if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
			return;
		}
		void requestMoveTaskToTrash(selectedCard.card.id, selectedCard.column.id);
	}, [requestMoveTaskToTrash, selectedCard, tryProgrammaticCardMove]);

	const handleMoveReviewCardToTrash = useCallback(
		(taskId: string) => {
			const programmaticMoveAttempt = tryProgrammaticCardMove(taskId, "review", "trash");
			if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
				return;
			}
			void requestMoveTaskToTrash(taskId, "review");
		},
		[requestMoveTaskToTrash, tryProgrammaticCardMove],
	);

	const handleRestoreTaskFromTrash = useCallback(
		(taskId: string) => {
			const programmaticMoveAttempt = tryProgrammaticCardMove(taskId, "trash", "review");
			if (programmaticMoveAttempt === "started" || programmaticMoveAttempt === "blocked") {
				return;
			}

			const selection = findCardSelection(board, taskId);
			if (!selection || selection.column.id !== "trash") {
				return;
			}

			const moved = moveTaskToColumn(board, taskId, "review", { insertAtTop: true });
			if (!moved.moved) {
				return;
			}
			setBoard(moved.board);
			const movedSelection = findCardSelection(moved.board, taskId);
			if (!movedSelection) {
				return;
			}
			void resumeTaskFromTrash(movedSelection.card, taskId, { optimisticMoveApplied: true });
		},
		[board, resumeTaskFromTrash, setBoard, tryProgrammaticCardMove],
	);

	const handleCancelAutomaticTaskAction = useCallback(
		(taskId: string) => {
			setBoard((currentBoard) => {
				const selection = findCardSelection(currentBoard, taskId);
				if (!selection || selection.card.autoReviewEnabled !== true) {
					return currentBoard;
				}
				const updated = updateTask(currentBoard, taskId, {
					prompt: selection.card.prompt,
					startInPlanMode: selection.card.startInPlanMode,
					autoReviewEnabled: false,
					autoReviewMode: resolveTaskAutoReviewMode(selection.card.autoReviewMode),
					baseRef: selection.card.baseRef,
				});
				return updated.updated ? updated.board : currentBoard;
			});
		},
		[setBoard],
	);

	const handleOpenClearTrash = useCallback(() => {
		if (trashTaskCount === 0) {
			return;
		}
		setIsClearTrashDialogOpen(true);
	}, [setIsClearTrashDialogOpen, trashTaskCount]);

	const handleConfirmClearTrash = useCallback(() => {
		const taskIds = [...trashTaskIds];
		setIsClearTrashDialogOpen(false);
		if (taskIds.length === 0) {
			return;
		}

		setBoard((currentBoard) => clearColumnTasks(currentBoard, "trash").board);
		setSessions((currentSessions) => {
			const nextSessions = { ...currentSessions };
			for (const taskId of taskIds) {
				delete nextSessions[taskId];
			}
			return nextSessions;
		});
		setPendingTrashWarning((currentWarning) =>
			currentWarning && taskIds.includes(currentWarning.taskId) ? null : currentWarning,
		);
		if (selectedTaskId && taskIds.includes(selectedTaskId)) {
			setSelectedTaskId(null);
			setSelectedTaskWorkspaceInfo(null);
		}

		void (async () => {
			await Promise.all(
				taskIds.map(async (taskId) => {
					await stopTaskSession(taskId);
					await cleanupTaskWorkspace(taskId);
				}),
			);
		})();
	}, [
		cleanupTaskWorkspace,
		selectedTaskId,
		setBoard,
		setIsClearTrashDialogOpen,
		setPendingTrashWarning,
		setSelectedTaskId,
		setSelectedTaskWorkspaceInfo,
		setSessions,
		stopTaskSession,
		trashTaskIds,
	]);

	const resetBoardInteractionsState = useCallback(() => {
		previousSessionsRef.current = {};
		resetProgrammaticCardMoves();
		setIsClearTrashDialogOpen(false);
	}, [resetProgrammaticCardMoves, setIsClearTrashDialogOpen]);

	useEffect(() => {
		resetBoardInteractionsState();
	}, [currentProjectId, resetBoardInteractionsState]);

	return {
		handleProgrammaticCardMoveReady,
		confirmMoveTaskToTrash,
		handleCreateDependency,
		handleDeleteDependency,
		handleDragEnd,
		handleStartTask,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleCancelAutomaticTaskAction,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		trashTaskCount,
	};
}
