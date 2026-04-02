// ── Context for passing CardDetailView state to dockview panel components ──
// Dockview mounts panel components once in portals. They won't re-render from
// parent closure changes. This context bridges that gap — CardDetailView provides
// the latest values, and panel components consume them via useDetailPanelContext().

import type { DropResult } from "@hello-pangea/dnd";
import type { MutableRefObject, ReactNode } from "react";
import { createContext, useContext } from "react";
import type { ClineAgentChatPanelHandle } from "@/components/detail-panels/cline-agent-chat-panel";
import type { DiffLineComment } from "@/components/detail-panels/diff-viewer-panel";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesMode,
	RuntimeWorkspaceFileChange,
} from "@/runtime/types";
import type { BoardCard, CardSelection } from "@/types";

export interface DetailPanelContextValue {
	// Selection & navigation
	selection: CardSelection;
	workspacePath?: string | null;
	onCardSelect: (taskId: string) => void;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onTaskDragEnd: (result: DropResult) => void;

	// Task actions
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onMoveReviewCardToTrash?: (taskId: string) => void;
	onRestoreTaskFromTrash?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;

	// Agent / chat
	showClineAgentChatPanel: boolean;
	sessionSummary: RuntimeTaskSessionSummary | null;
	currentProjectId: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onClineSettingsSaved?: () => void;
	onSendClineChatMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<ClineChatActionResult>;
	onCancelClineChatTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadClineChatMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	streamedClineChatMessages?: ClineChatMessage[] | null;
	latestClineChatMessage?: ClineChatMessage | null;
	onAgentCommitTask?: (taskId: string) => void;
	onAgentOpenPrTask?: (taskId: string) => void;
	agentCommitTaskLoadingById?: Record<string, boolean>;
	agentOpenPrTaskLoadingById?: Record<string, boolean>;
	showMoveToTrashActions: boolean;
	onMoveToTrash: () => void;
	isMoveToTrashLoading?: boolean;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	isTaskTerminalEnabled: boolean;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	clineAgentChatPanelRef: MutableRefObject<ClineAgentChatPanelHandle | null>;

	// Changes / diff
	isRuntimeAvailable: boolean;
	diffMode: RuntimeWorkspaceChangesMode;
	setDiffMode: (mode: RuntimeWorkspaceChangesMode) => void;
	isFileTreeVisible: boolean;
	handleToggleFileTree: () => void;
	isWorkspaceChangesPending: boolean;
	hasNoWorkspaceFileChanges: boolean;
	emptyDiffTitle: string;
	runtimeFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	setSelectedPath: (path: string | null) => void;
	onAddReviewComments?: (taskId: string, text: string) => void;
	handleAddDiffComments: (formatted: string) => void;
	onSendReviewComments?: (taskId: string, text: string) => void;
	handleSendDiffComments: (formatted: string) => void;
	diffComments: Map<string, DiffLineComment>;
	setDiffComments: (comments: Map<string, DiffLineComment>) => void;
}

const DetailPanelContext = createContext<DetailPanelContextValue | null>(null);

export const DetailPanelProvider = DetailPanelContext.Provider;

export function useDetailPanelContext(): DetailPanelContextValue {
	const ctx = useContext(DetailPanelContext);
	if (!ctx) throw new Error("useDetailPanelContext must be used within DetailPanelProvider");
	return ctx;
}
