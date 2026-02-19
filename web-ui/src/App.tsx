import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BrowserAcpClient } from "@/kanban/acp/browser-acp-client";
import { useTaskChatSessions } from "@/kanban/chat/hooks/use-task-chat-sessions";
import { CardDetailView } from "@/kanban/components/card-detail-view";
import { KanbanBoard } from "@/kanban/components/kanban-board";
import { RuntimeSettingsDialog } from "@/kanban/components/runtime-settings-dialog";
import { TopBar } from "@/kanban/components/top-bar";
import { useRuntimeAcpHealth } from "@/kanban/runtime/use-runtime-acp-health";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import type { RuntimeShortcutRunResponse } from "@/kanban/runtime/types";
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
const KICKOFF_COLUMNS = new Set<BoardColumnId>(["todo", "in_progress"]);

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => loadBoardState());
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
	const [newTaskTitle, setNewTaskTitle] = useState("");
	const [runningShortcutId, setRunningShortcutId] = useState<string | null>(null);
	const [lastShortcutOutput, setLastShortcutOutput] = useState<{
		label: string;
		result: RuntimeShortcutRunResponse;
	} | null>(null);
	const { health: runtimeAcpHealth, refresh: refreshRuntimeAcpHealth } = useRuntimeAcpHealth();
	const { config: runtimeProjectConfig, refresh: refreshRuntimeProjectConfig } = useRuntimeProjectConfig();

	const handleTaskRunComplete = useCallback((taskId: string) => {
		setBoard((currentBoard) => {
			const columnId = getTaskColumnId(currentBoard, taskId);
			if (!columnId || columnId === "ready_for_review" || columnId === "done") {
				return currentBoard;
			}
			const moved = moveTaskToColumn(currentBoard, taskId, "ready_for_review");
			return moved.moved ? moved.board : currentBoard;
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

	const searchableTasks = useMemo(() => {
		return board.columns.flatMap((column) =>
			column.cards.map((card) => ({
				id: card.id,
				title: card.title,
				columnTitle: column.title,
			})),
		);
	}, [board.columns]);

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
		for (const column of board.columns) {
			if (!KICKOFF_COLUMNS.has(column.id)) {
				continue;
			}
			for (const task of column.cards) {
				const session = getSession(task.id);
				if (session.status === "idle" && session.timeline.length === 0) {
					startTaskRun(task);
				}
			}
		}
	}, [board.columns, getSession, startTaskRun]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			const isTypingTarget =
				target?.tagName === "INPUT" ||
				target?.tagName === "TEXTAREA" ||
				target?.isContentEditable;
			if (isTypingTarget) {
				return;
			}

			const key = event.key.toLowerCase();
			if ((event.metaKey || event.ctrlKey) && key === "k") {
				event.preventDefault();
				setIsCommandPaletteOpen((current) => !current);
				return;
			}

			if (!event.metaKey && !event.ctrlKey && key === "c") {
				event.preventDefault();
				setIsCreateTaskOpen(true);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const handleBack = useCallback(() => {
		setSelectedTaskId(null);
	}, []);

	const handleAddCard = useCallback((columnId: BoardColumnId, title: string) => {
		setBoard((currentBoard) => addTaskToColumn(currentBoard, columnId, { title }));
	}, []);

	const handleCreateTask = useCallback(() => {
		const title = newTaskTitle.trim();
		if (!title) {
			return;
		}
		handleAddCard("backlog", title);
		setNewTaskTitle("");
		setIsCreateTaskOpen(false);
	}, [handleAddCard, newTaskTitle]);

	const handleRunShortcut = useCallback(
		async (shortcutId: string) => {
			const shortcut = runtimeProjectConfig?.shortcuts.find((item) => item.id === shortcutId);
			if (!shortcut) {
				return;
			}

			setRunningShortcutId(shortcutId);
			try {
				const response = await fetch("/api/runtime/shortcut/run", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						command: shortcut.command,
					}),
				});
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as { error?: string } | null;
					throw new Error(payload?.error ?? `Shortcut run failed with ${response.status}`);
				}
				const result = (await response.json()) as RuntimeShortcutRunResponse;
				setLastShortcutOutput({
					label: shortcut.label,
					result,
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setLastShortcutOutput({
					label: shortcut.label,
					result: {
						exitCode: 1,
						stdout: "",
						stderr: message,
						combinedOutput: message,
						durationMs: 0,
					},
				});
			} finally {
				setRunningShortcutId(null);
			}
		},
		[runtimeProjectConfig?.shortcuts],
	);

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			const applied = applyDragResult(board, result);
			setBoard(applied.board);

			if (!applied.moveEvent) {
				return;
			}

			const movedOutOfBacklog =
				applied.moveEvent.fromColumnId === "backlog" && KICKOFF_COLUMNS.has(applied.moveEvent.toColumnId);
			const movedToInProgress = applied.moveEvent.toColumnId === "in_progress";

			if (movedOutOfBacklog || movedToInProgress) {
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

		if (runtimeAcpHealth.reason) {
			return runtimeAcpHealth.reason;
		}

		const detected = runtimeAcpHealth.detectedCommands?.join(", ");
		if (detected) {
			return `ACP not configured (${detected})`;
		}
		return "ACP not configured";
	}, [runtimeAcpHealth]);

	return (
		<div className="flex h-svh min-w-0 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
			<TopBar
				onBack={selectedCard ? handleBack : undefined}
				subtitle={selectedCard?.column.title}
				runtimeHint={runtimeHint}
				onOpenSettings={() => setIsSettingsOpen(true)}
				shortcuts={runtimeProjectConfig?.shortcuts ?? []}
				runningShortcutId={runningShortcutId}
				onRunShortcut={handleRunShortcut}
			/>
			{lastShortcutOutput ? (
				<div className="border-b border-zinc-800 bg-zinc-900 px-4 py-2">
					<div className="mb-1 flex items-center justify-between">
						<p className="text-xs text-zinc-400">
							{lastShortcutOutput.label} finished with exit code {lastShortcutOutput.result.exitCode}
						</p>
						<button
							type="button"
							onClick={() => setLastShortcutOutput(null)}
							className="text-xs text-zinc-500 hover:text-zinc-300"
						>
							Clear
						</button>
					</div>
					<pre className="max-h-32 overflow-auto rounded bg-zinc-950 p-2 text-xs text-zinc-300">
						{lastShortcutOutput.result.combinedOutput || "(no output)"}
					</pre>
				</div>
			) : null}
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
					void refreshRuntimeProjectConfig();
				}}
			/>
			<CommandDialog open={isCommandPaletteOpen} onOpenChange={setIsCommandPaletteOpen}>
				<CommandInput placeholder="Search tasks..." />
				<CommandList>
					<CommandEmpty>No tasks found.</CommandEmpty>
					<CommandGroup heading="Tasks">
						{searchableTasks.map((task) => (
							<CommandItem
								key={task.id}
								onSelect={() => {
									setSelectedTaskId(task.id);
									setIsCommandPaletteOpen(false);
								}}
							>
								<span className="truncate">{task.title}</span>
								<CommandShortcut>{task.columnTitle}</CommandShortcut>
							</CommandItem>
						))}
					</CommandGroup>
				</CommandList>
			</CommandDialog>
			<Dialog open={isCreateTaskOpen} onOpenChange={setIsCreateTaskOpen}>
				<DialogContent className="border-zinc-800 bg-zinc-900 text-zinc-100">
					<DialogHeader>
						<DialogTitle>Create Task</DialogTitle>
						<DialogDescription className="text-zinc-400">
							New tasks are added to Backlog.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-1">
						<label htmlFor="task-title-input" className="text-xs text-zinc-400">
							Title
						</label>
						<input
							id="task-title-input"
							value={newTaskTitle}
							onChange={(event) => setNewTaskTitle(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									handleCreateTask();
								}
							}}
							className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-zinc-500"
							placeholder="Describe the task"
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setIsCreateTaskOpen(false)}>
							Cancel
						</Button>
						<Button onClick={handleCreateTask} disabled={!newTaskTitle.trim()}>
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
