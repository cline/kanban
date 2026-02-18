import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { BrowserAcpClient } from "@/kanban/acp/browser-acp-client";
import { useTaskChatSessions } from "@/kanban/chat/hooks/use-task-chat-sessions";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { RuntimeSettingsDialog } from "@/kanban/components/runtime-settings-dialog";
import { TopBar } from "@/kanban/components/top-bar";
import { useRuntimeAcpHealth } from "@/kanban/runtime/use-runtime-acp-health";
import {
	addTaskToColumn,
	applyDragResult,
	findCardSelection,
	getTaskColumnId,
	loadBoardState,
	moveTaskToColumn,
	persistBoardState,
} from "@/kanban/state/board-state";
import type { BoardColumnId, BoardData } from "@/kanban/types";

const acpClient = new BrowserAcpClient();

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => loadBoardState());
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const { health: runtimeAcpHealth, refresh: refreshRuntimeAcpHealth } = useRuntimeAcpHealth();

	const handleTaskRunComplete = useCallback((taskId: string) => {
		setBoard((currentBoard) => {
			const columnId = getTaskColumnId(currentBoard, taskId);
			if (columnId !== "in_progress") {
				return currentBoard;
			}
			const moved = moveTaskToColumn(currentBoard, taskId, "ready_for_review");
			return moved.board;
		});
	}, []);

	const { getSession, ensureSession, startTaskRun, sendPrompt, cancelPrompt, respondToPermission } =
		useTaskChatSessions({
			acpClient,
			onTaskRunComplete: handleTaskRunComplete,
		});

	const selectedCard = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);

	useEffect(() => {
		persistBoardState(board);
	}, [board]);

	useEffect(() => {
		if (selectedTaskId && !selectedCard) {
			setSelectedTaskId(null);
		}
	}, [selectedTaskId, selectedCard]);

	useEffect(() => {
		if (selectedCard) {
			ensureSession(selectedCard.card.id);
		}
	}, [ensureSession, selectedCard]);

	useEffect(() => {
		const inProgressColumn = board.columns.find((column) => column.id === "in_progress");
		if (!inProgressColumn) {
			return;
		}

		for (const task of inProgressColumn.cards) {
			const session = getSession(task.id);
			if (session.status === "idle" && session.timeline.length === 0) {
				startTaskRun(task);
			}
		}
	}, [board.columns, getSession, startTaskRun]);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
	}, []);

	const handleAddCard = useCallback((columnId: BoardColumnId, title: string) => {
		setBoard((currentBoard) => addTaskToColumn(currentBoard, columnId, { title }));
	}, []);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			const applied = applyDragResult(board, result);
			setBoard(applied.board);

			if (applied.moveEvent?.toColumnId === "in_progress") {
				const movedSelection = findCardSelection(applied.board, applied.moveEvent.taskId);
				if (movedSelection) {
					startTaskRun(movedSelection.card);
				}
			}
		},
		[board, startTaskRun],
	);

	const handleCardSelect = useCallback((taskId: string) => {
		setSelectedTaskId(taskId);
	}, []);

	const handleSendPrompt = useCallback(
		(text: string) => {
			if (!selectedCard) {
				return;
			}

			let activeBoard = board;
			let activeTask = selectedCard.card;

			if (selectedCard.column.id !== "in_progress") {
				const moved = moveTaskToColumn(board, selectedCard.card.id, "in_progress");
				if (moved.moved) {
					activeBoard = moved.board;
					setBoard(moved.board);
					const nextSelection = findCardSelection(moved.board, selectedCard.card.id);
					if (nextSelection) {
						activeTask = nextSelection.card;
					}
				}
			}

			if (getTaskColumnId(activeBoard, activeTask.id) === "in_progress") {
				sendPrompt(activeTask, text);
			}
		},
		[board, selectedCard, sendPrompt],
	);

	const detailSession = selectedCard ? getSession(selectedCard.card.id) : null;
	const runtimeHint = useMemo(() => {
		if (!runtimeAcpHealth || runtimeAcpHealth.available) {
			return undefined;
		}

		const detected = runtimeAcpHealth.detectedCommands?.join(", ");
		if (detected) {
			return `Mock ACP mode (detected: ${detected})`;
		}
		return "Mock ACP mode";
	}, [runtimeAcpHealth]);

	return (
		<div className="flex h-svh min-w-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
			<TopBar
				onBack={selectedCard ? handleBack : undefined}
				subtitle={selectedCard?.column.title}
				runtimeHint={runtimeHint}
				onOpenSettings={() => setIsSettingsOpen(true)}
			/>
			<div className={selectedCard ? "hidden" : "flex h-full min-h-0 flex-1 overflow-hidden"}>
				<KanbanBoard
					data={board}
					onCardSelect={handleCardSelect}
					onAddCard={handleAddCard}
					onDragEnd={handleDragEnd}
				/>
			</div>
			{selectedCard && detailSession ? (
				<CardDetailView
					selection={selectedCard}
					session={detailSession}
					onBack={handleBack}
					onCardSelect={handleCardSelect}
					onSendPrompt={handleSendPrompt}
					onCancelPrompt={() => cancelPrompt(selectedCard.card.id)}
					onPermissionRespond={(messageId, optionId) =>
						respondToPermission(selectedCard.card.id, messageId, optionId)
					}
				/>
			) : null}
			<RuntimeSettingsDialog
				open={isSettingsOpen}
				onOpenChange={setIsSettingsOpen}
				onSaved={() => {
					void refreshRuntimeAcpHealth();
				}}
			/>
		</div>
	);
}
