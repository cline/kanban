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
import { createInitialBoardData } from "@/kanban/data/board-data";
import { useRuntimeAcpHealth } from "@/kanban/runtime/use-runtime-acp-health";
import { useRuntimeProjectConfig } from "@/kanban/runtime/use-runtime-project-config";
import type {
	RuntimeShortcutRunResponse,
	RuntimeWorkspaceStateResponse,
	RuntimeWorkspaceStateSaveRequest,
} from "@/kanban/runtime/types";
import {
	addTaskToColumn,
	applyDragResult,
	findCardSelection,
	getTaskColumnId,
	moveTaskToColumn,
	normalizeBoardData,
} from "@/kanban/state/board-state";
import type { BoardColumnId, BoardData } from "@/kanban/types";

const acpClient = new BrowserAcpClient();
const WORKSPACE_STATE_PERSIST_DEBOUNCE_MS = 300;

export default function App(): ReactElement {
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [isWorkspaceStateReady, setIsWorkspaceStateReady] = useState(false);
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
			if (columnId !== "in_progress") {
				return currentBoard;
			}
			const moved = moveTaskToColumn(currentBoard, taskId, "review");
			return moved.moved ? moved.board : currentBoard;
		});
	}, []);

	const { sessions, hydrateSessions, getSession, ensureSession, startTaskRun, sendPrompt, cancelPrompt, respondToPermission } =
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
		let cancelled = false;
		const loadWorkspaceState = async () => {
			try {
				const response = await fetch("/api/workspace/state");
				if (!response.ok) {
					throw new Error(`Workspace state request failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeWorkspaceStateResponse;
				if (cancelled) {
					return;
				}
				const normalized = normalizeBoardData(payload.board) ?? createInitialBoardData();
				setWorkspacePath(payload.repoPath);
				setBoard(normalized);
				hydrateSessions(payload.sessions);
			} catch {
				if (!cancelled) {
					setWorkspacePath(null);
					setBoard(createInitialBoardData());
					hydrateSessions({});
				}
			} finally {
				if (!cancelled) {
					setIsWorkspaceStateReady(true);
				}
			}
		};

		void loadWorkspaceState();
		return () => {
			cancelled = true;
		};
	}, [hydrateSessions]);

	useEffect(() => {
		if (!isWorkspaceStateReady) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			const payload: RuntimeWorkspaceStateSaveRequest = {
				board,
				sessions,
			};
			void fetch("/api/workspace/state", {
				method: "PUT",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(payload),
			}).catch(() => {
				// Keep the UI usable even if persistence is temporarily unavailable.
			});
		}, WORKSPACE_STATE_PERSIST_DEBOUNCE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [board, isWorkspaceStateReady, sessions]);

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
		if (!isWorkspaceStateReady) {
			return;
		}
		for (const column of board.columns) {
			if (column.id !== "in_progress") {
				continue;
			}
			for (const task of column.cards) {
				const session = getSession(task.id);
				if (session.status === "idle" && session.timeline.length === 0) {
					startTaskRun(task);
				}
			}
		}
	}, [board.columns, getSession, isWorkspaceStateReady, startTaskRun]);

	const workspaceTitle = useMemo(() => {
		if (!workspacePath) {
			return null;
		}
		const segments = workspacePath.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
		if (segments.length === 0) {
			return workspacePath;
		}
		return segments[segments.length - 1] ?? workspacePath;
	}, [workspacePath]);

	useEffect(() => {
		document.title = workspaceTitle ? `${workspaceTitle} | Kanbanana` : "Kanbanana";
	}, [workspaceTitle]);

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

			if (applied.moveEvent.toColumnId === "in_progress") {
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
			let activeColumnId = selectedCard.column.id;

			if (selectedCard.column.id === "review") {
				const moved = moveTaskToColumn(board, selectedCard.card.id, "in_progress");
				if (moved.moved) {
					activeBoard = moved.board;
					setBoard(moved.board);
					const nextSelection = findCardSelection(moved.board, selectedCard.card.id);
					if (nextSelection) {
						activeTask = nextSelection.card;
						activeColumnId = nextSelection.column.id;
					}
				}
			}

			const latestColumnId = getTaskColumnId(activeBoard, activeTask.id) ?? activeColumnId;
			if (latestColumnId === "in_progress") {
				sendPrompt(activeTask, text);
			}
		},
		[board, selectedCard, sendPrompt],
	);

	const handleMoveToTrash = useCallback(() => {
		if (!selectedTaskId) {
			return;
		}
		setBoard((currentBoard) => {
			const moved = moveTaskToColumn(currentBoard, selectedTaskId, "trash");
			return moved.moved ? moved.board : currentBoard;
		});
	}, [selectedTaskId]);

	const detailSession = selectedCard ? getSession(selectedCard.card.id) : null;
	const sendDisabledReason = useMemo(() => {
		if (!selectedCard) {
			return undefined;
		}
		if (selectedCard.column.id === "backlog") {
			return "Move this card to In Progress to start agent work.";
		}
		if (selectedCard.column.id === "trash") {
			return "This card is in Trash. Move it to In Progress to resume work.";
		}
		return undefined;
	}, [selectedCard]);
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
		<div className="flex h-svh min-w-0 flex-col overflow-hidden bg-background text-foreground">
			<TopBar
				onBack={selectedCard ? handleBack : undefined}
				subtitle={selectedCard?.column.title}
				workspacePath={workspacePath ?? undefined}
				runtimeHint={runtimeHint}
				onOpenSettings={() => setIsSettingsOpen(true)}
				shortcuts={runtimeProjectConfig?.shortcuts ?? []}
				runningShortcutId={runningShortcutId}
				onRunShortcut={handleRunShortcut}
			/>
			{lastShortcutOutput ? (
				<div className="border-b border-border bg-background px-4 py-2">
					<div className="mb-1 flex items-center justify-between">
						<p className="text-xs text-muted-foreground">
							{lastShortcutOutput.label} finished with exit code {lastShortcutOutput.result.exitCode}
						</p>
						<button
							type="button"
							onClick={() => setLastShortcutOutput(null)}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Clear
						</button>
					</div>
					<pre className="max-h-32 overflow-auto rounded bg-nav p-2 text-xs text-foreground">
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
					onMoveToTrash={handleMoveToTrash}
					sendDisabled={Boolean(sendDisabledReason)}
					sendDisabledReason={sendDisabledReason}
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
				<DialogContent className="border-border bg-card text-foreground">
					<DialogHeader>
						<DialogTitle>Create Task</DialogTitle>
						<DialogDescription className="text-muted-foreground">
							New tasks are added to Backlog.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-1">
						<label htmlFor="task-title-input" className="text-xs text-muted-foreground">
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
							className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
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
