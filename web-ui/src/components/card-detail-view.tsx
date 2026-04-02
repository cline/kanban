import type { DropResult } from "@hello-pangea/dnd";
import type { DockviewReadyEvent, IDockviewPanelProps } from "dockview-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { DockviewPanels, type PanelComponentProps } from "@/components/DockviewPanels";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import type { ClineAgentChatPanelHandle } from "@/components/detail-panels/cline-agent-chat-panel";
import { type DetailPanelContextValue, DetailPanelProvider } from "@/components/detail-panels/detail-panel-context";
import type { DiffLineComment } from "@/components/detail-panels/diff-viewer-panel";
import { DockviewAgentPanel } from "@/components/detail-panels/dockview-agent-panel";
import { DockviewChangesPanel } from "@/components/detail-panels/dockview-changes-panel";
import { DockviewTasksPanel } from "@/components/detail-panels/dockview-tasks-panel";
import { ResizableBottomPane } from "@/components/resizable-bottom-pane";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { isNativeClineAgentSelected } from "@/runtime/native-agent";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesMode,
} from "@/runtime/types";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";
import { useTaskWorkspaceStateVersionValue } from "@/stores/workspace-metadata-store";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import type { BoardCard, CardSelection } from "@/types";
import { useWindowEvent } from "@/utils/react-use";

// ── Constants ──

const DETAIL_DIFF_POLL_INTERVAL_MS = 1_000;
const LAYOUT_STORAGE_KEY = "card-detail-dockview-layout";
const FILE_TREE_VISIBLE_KEY = "card-detail-file-tree-visible";
const LAYOUT_PERSIST_DEBOUNCE_MS = 500;

// ── Helper ──

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isEventInsideDialog(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[role='dialog']") !== null;
}

// ── Dockview component map (stable — components read from context) ──

const DOCKVIEW_COMPONENTS: Record<string, React.FC<IDockviewPanelProps<PanelComponentProps>>> = {
	tasks: () => <DockviewTasksPanel />,
	agent: () => <DockviewAgentPanel />,
	changes: () => <DockviewChangesPanel />,
};

// ── Main component ──

export function CardDetailView({
	selection,
	currentProjectId,
	workspacePath,
	selectedAgentId = null,
	runtimeConfig = null,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	onStartTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onCommitTask,
	onOpenPrTask,
	onAgentCommitTask,
	onAgentOpenPrTask,
	onMoveReviewCardToTrash,
	onRestoreTaskFromTrash,
	onCancelAutomaticTaskAction,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	agentCommitTaskLoadingById,
	agentOpenPrTaskLoadingById,
	moveToTrashLoadingById,
	onAddReviewComments,
	onSendReviewComments,
	onSendClineChatMessage,
	onCancelClineChatTurn,
	onLoadClineChatMessages,
	latestClineChatMessage,
	streamedClineChatMessages,
	onMoveToTrash,
	isMoveToTrashLoading,
	gitHistoryPanel,
	onCloseGitHistory,
	bottomTerminalOpen,
	bottomTerminalTaskId,
	bottomTerminalSummary,
	bottomTerminalSubtitle,
	onBottomTerminalClose,
	bottomTerminalPaneHeight,
	onBottomTerminalPaneHeightChange,
	onBottomTerminalConnectionReady,
	bottomTerminalAgentCommand,
	onBottomTerminalSendAgentCommand,
	isBottomTerminalExpanded,
	onBottomTerminalToggleExpand,
	isDocumentVisible = true,
	onClineSettingsSaved,
}: {
	selection: CardSelection;
	currentProjectId: string | null;
	workspacePath?: string | null;
	selectedAgentId?: RuntimeAgentId | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onAgentCommitTask?: (taskId: string) => void;
	onAgentOpenPrTask?: (taskId: string) => void;
	onMoveReviewCardToTrash?: (taskId: string) => void;
	onRestoreTaskFromTrash?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	agentCommitTaskLoadingById?: Record<string, boolean>;
	agentOpenPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onAddReviewComments?: (taskId: string, text: string) => void;
	onSendReviewComments?: (taskId: string, text: string) => void;
	onSendClineChatMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<ClineChatActionResult>;
	onCancelClineChatTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadClineChatMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	latestClineChatMessage?: ClineChatMessage | null;
	streamedClineChatMessages?: ClineChatMessage[] | null;
	onMoveToTrash: () => void;
	isMoveToTrashLoading?: boolean;
	gitHistoryPanel?: ReactNode;
	onCloseGitHistory?: () => void;
	bottomTerminalOpen: boolean;
	bottomTerminalTaskId: string | null;
	bottomTerminalSummary: RuntimeTaskSessionSummary | null;
	bottomTerminalSubtitle?: string | null;
	onBottomTerminalClose: () => void;
	bottomTerminalPaneHeight?: number;
	onBottomTerminalPaneHeightChange?: (height: number) => void;
	onBottomTerminalConnectionReady?: (taskId: string) => void;
	bottomTerminalAgentCommand?: string | null;
	onBottomTerminalSendAgentCommand?: () => void;
	isBottomTerminalExpanded?: boolean;
	onBottomTerminalToggleExpand?: () => void;
	isDocumentVisible?: boolean;
	onClineSettingsSaved?: () => void;
}): React.ReactElement {
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffComments, setDiffComments] = useState<Map<string, DiffLineComment>>(new Map());
	const [diffMode, setDiffMode] = useState<RuntimeWorkspaceChangesMode>("working_copy");
	const [isFileTreeVisible, setIsFileTreeVisible] = useState(() => {
		try {
			return localStorage.getItem(FILE_TREE_VISIBLE_KEY) !== "false";
		} catch {
			return true;
		}
	});
	const clineAgentChatPanelRef = useRef<ClineAgentChatPanelHandle | null>(null);

	const taskWorkspaceStateVersion = useTaskWorkspaceStateVersionValue(selection.card.id);
	const lastTurnViewKey =
		diffMode === "last_turn"
			? [
					sessionSummary?.state ?? "none",
					sessionSummary?.latestTurnCheckpoint?.commit ?? "none",
					sessionSummary?.previousTurnCheckpoint?.commit ?? "none",
				].join(":")
			: null;
	const { changes: workspaceChanges, isRuntimeAvailable } = useRuntimeWorkspaceChanges(
		selection.card.id,
		currentProjectId,
		selection.card.baseRef,
		diffMode,
		taskWorkspaceStateVersion,
		isDocumentVisible && !gitHistoryPanel && selection.column.id !== "trash" ? DETAIL_DIFF_POLL_INTERVAL_MS : null,
		lastTurnViewKey,
		true,
	);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const isWorkspaceChangesPending = isRuntimeAvailable && workspaceChanges === null;
	const hasNoWorkspaceFileChanges =
		isRuntimeAvailable && workspaceChanges !== null && runtimeFiles !== null && runtimeFiles.length === 0;
	const emptyDiffTitle = diffMode === "last_turn" ? "No changes since last turn" : "No working changes";
	const showMoveToTrashActions = selection.column.id === "review" || selection.column.id === "in_progress";
	const isTaskTerminalEnabled = selection.column.id === "in_progress" || selection.column.id === "review";
	const showClineAgentChatPanel = isNativeClineAgentSelected(sessionSummary?.agentId ?? selectedAgentId);
	const availablePaths = useMemo(() => {
		if (!runtimeFiles || runtimeFiles.length === 0) {
			return [];
		}
		return runtimeFiles.map((file) => file.path);
	}, [runtimeFiles]);

	const handleSelectAdjacentCard = useCallback(
		(step: number) => {
			const cards = selection.column.cards;
			const currentIndex = cards.findIndex((card) => card.id === selection.card.id);
			if (currentIndex === -1) {
				return;
			}
			const nextIndex = (currentIndex + step + cards.length) % cards.length;
			const nextCard = cards[nextIndex];
			if (nextCard) {
				onCardSelect(nextCard.id);
			}
		},
		[onCardSelect, selection.card.id, selection.column.cards],
	);

	useHotkeys(
		"up,left",
		() => {
			handleSelectAdjacentCard(-1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useWindowEvent(
		"keydown",
		useCallback(
			(event: KeyboardEvent) => {
				if (event.key !== "Escape" || event.defaultPrevented || isEventInsideDialog(event.target)) {
					return;
				}
				if (gitHistoryPanel && onCloseGitHistory) {
					event.preventDefault();
					onCloseGitHistory();
					return;
				}
			},
			[gitHistoryPanel, onCloseGitHistory],
		),
	);

	useHotkeys(
		"down,right",
		() => {
			handleSelectAdjacentCard(1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	useEffect(() => {
		setDiffComments(new Map());
	}, [selection.card.id]);

	useEffect(() => {
		setDiffMode("working_copy");
	}, [selection.card.id]);

	const handleToggleFileTree = useCallback(() => {
		setIsFileTreeVisible((prev) => {
			const next = !prev;
			try {
				localStorage.setItem(FILE_TREE_VISIBLE_KEY, String(next));
			} catch {
				// ignore
			}
			return next;
		});
	}, []);

	const handleAddDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				clineAgentChatPanelRef.current?.appendToDraft(formatted);
				return;
			}
			onAddReviewComments?.(selection.card.id, formatted);
		},
		[onAddReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	const handleSendDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				void clineAgentChatPanelRef.current?.sendText(formatted);
				return;
			}
			onSendReviewComments?.(selection.card.id, formatted);
		},
		[onSendReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	// ── Context value for dockview panel components ──

	const panelContext: DetailPanelContextValue = useMemo(
		() => ({
			selection,
			workspacePath,
			onCardSelect,
			taskSessions,
			onTaskDragEnd,
			onCreateTask,
			onStartTask,
			onStartAllTasks,
			onClearTrash,
			editingTaskId,
			inlineTaskEditor,
			onEditTask,
			onCommitTask,
			onOpenPrTask,
			onMoveReviewCardToTrash,
			onRestoreTaskFromTrash,
			commitTaskLoadingById,
			openPrTaskLoadingById,
			moveToTrashLoadingById,
			showClineAgentChatPanel,
			sessionSummary,
			currentProjectId,
			runtimeConfig,
			onClineSettingsSaved,
			onSendClineChatMessage,
			onCancelClineChatTurn,
			onLoadClineChatMessages,
			streamedClineChatMessages,
			latestClineChatMessage,
			onAgentCommitTask,
			onAgentOpenPrTask,
			agentCommitTaskLoadingById,
			agentOpenPrTaskLoadingById,
			showMoveToTrashActions,
			onMoveToTrash,
			isMoveToTrashLoading,
			onCancelAutomaticTaskAction,
			isTaskTerminalEnabled,
			onSessionSummary,
			clineAgentChatPanelRef,
			isRuntimeAvailable,
			diffMode,
			setDiffMode,
			isFileTreeVisible,
			handleToggleFileTree,
			isWorkspaceChangesPending,
			hasNoWorkspaceFileChanges,
			emptyDiffTitle,
			runtimeFiles,
			selectedPath,
			setSelectedPath,
			onAddReviewComments,
			handleAddDiffComments,
			onSendReviewComments,
			handleSendDiffComments,
			diffComments,
			setDiffComments,
		}),
		[
			selection,
			workspacePath,
			onCardSelect,
			taskSessions,
			onTaskDragEnd,
			onCreateTask,
			onStartTask,
			onStartAllTasks,
			onClearTrash,
			editingTaskId,
			inlineTaskEditor,
			onEditTask,
			onCommitTask,
			onOpenPrTask,
			onMoveReviewCardToTrash,
			onRestoreTaskFromTrash,
			commitTaskLoadingById,
			openPrTaskLoadingById,
			moveToTrashLoadingById,
			showClineAgentChatPanel,
			sessionSummary,
			currentProjectId,
			runtimeConfig,
			onClineSettingsSaved,
			onSendClineChatMessage,
			onCancelClineChatTurn,
			onLoadClineChatMessages,
			streamedClineChatMessages,
			latestClineChatMessage,
			onAgentCommitTask,
			onAgentOpenPrTask,
			agentCommitTaskLoadingById,
			agentOpenPrTaskLoadingById,
			showMoveToTrashActions,
			onMoveToTrash,
			isMoveToTrashLoading,
			onCancelAutomaticTaskAction,
			isTaskTerminalEnabled,
			onSessionSummary,
			isRuntimeAvailable,
			diffMode,
			isFileTreeVisible,
			handleToggleFileTree,
			isWorkspaceChangesPending,
			hasNoWorkspaceFileChanges,
			emptyDiffTitle,
			runtimeFiles,
			selectedPath,
			onAddReviewComments,
			handleAddDiffComments,
			onSendReviewComments,
			handleSendDiffComments,
			diffComments,
		],
	);

	// ── Dockview callbacks ──

	const handleDockviewReady = useCallback((event: DockviewReadyEvent) => {
		const api = event.api;

		try {
			const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
			if (saved) {
				api.fromJSON(JSON.parse(saved));
				return;
			}
		} catch {
			// Corrupt or incompatible layout — clear and fall through to default
			localStorage.removeItem(LAYOUT_STORAGE_KEY);
		}

		const totalWidth = api.width;
		api.addPanel({ id: "tasks", component: "tasks", title: "Tasks", initialWidth: totalWidth * 0.2 });
		api.addPanel({
			id: "agent",
			component: "agent",
			title: "Agent",
			position: { direction: "right" },
			initialWidth: totalWidth * 0.4,
		});
		api.addPanel({
			id: "changes",
			component: "changes",
			title: "Changes",
			position: { direction: "right" },
			initialWidth: totalWidth * 0.4,
		});
	}, []);

	const layoutPersistTimer = useRef<ReturnType<typeof setTimeout>>();
	const handleLayoutChange = useCallback((api: import("dockview-react").DockviewApi) => {
		clearTimeout(layoutPersistTimer.current);
		layoutPersistTimer.current = setTimeout(() => {
			try {
				localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(api.toJSON()));
			} catch {
				// Storage full — silently ignore
			}
		}, LAYOUT_PERSIST_DEBOUNCE_MS);
	}, []);

	// ── Render ──

	return (
		<DetailPanelProvider value={panelContext}>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flex: "1 1 0",
					minHeight: 0,
					overflow: "hidden",
					background: "var(--color-surface-0)",
				}}
			>
				{gitHistoryPanel ? (
					<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden" }}>{gitHistoryPanel}</div>
				) : (
					<>
						<DockviewPanels
							components={DOCKVIEW_COMPONENTS}
							onReady={handleDockviewReady}
							onLayoutChange={handleLayoutChange}
							className="flex-1 min-h-0"
						/>
						{bottomTerminalOpen && bottomTerminalTaskId ? (
							<ResizableBottomPane
								minHeight={200}
								initialHeight={bottomTerminalPaneHeight}
								onHeightChange={onBottomTerminalPaneHeightChange}
							>
								<div
									style={{
										display: "flex",
										flex: "1 1 0",
										minWidth: 0,
										paddingLeft: 12,
										paddingRight: 12,
									}}
								>
									<AgentTerminalPanel
										key={`detail-shell-${bottomTerminalTaskId}`}
										taskId={bottomTerminalTaskId}
										workspaceId={currentProjectId}
										summary={bottomTerminalSummary}
										onSummary={onSessionSummary}
										showSessionToolbar={false}
										autoFocus
										onClose={onBottomTerminalClose}
										minimalHeaderTitle="Terminal"
										minimalHeaderSubtitle={bottomTerminalSubtitle}
										panelBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
										terminalBackgroundColor={TERMINAL_THEME_COLORS.surfaceRaised}
										cursorColor={TERMINAL_THEME_COLORS.textPrimary}
										showRightBorder={false}
										onConnectionReady={onBottomTerminalConnectionReady}
										agentCommand={bottomTerminalAgentCommand}
										onSendAgentCommand={onBottomTerminalSendAgentCommand}
										isExpanded={isBottomTerminalExpanded}
										onToggleExpand={onBottomTerminalToggleExpand}
									/>
								</div>
							</ResizableBottomPane>
						) : null}
					</>
				)}
			</div>
		</DetailPanelProvider>
	);
}
