// ── Dockview panel: Agent (ClineAgentChatPanel or AgentTerminalPanel) ──

import { useMemo } from "react";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ClineAgentChatPanel } from "@/components/detail-panels/cline-agent-chat-panel";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import { getTaskAutoReviewCancelButtonLabel } from "@/types";
import { useDetailPanelContext } from "./detail-panel-context";

/** Props shared between ClineAgentChatPanel and AgentTerminalPanel. */
function useSharedAgentProps(ctx: ReturnType<typeof useDetailPanelContext>) {
	const taskId = ctx.selection.card.id;
	return useMemo(
		() => ({
			onCommit: ctx.onAgentCommitTask ? () => ctx.onAgentCommitTask!(taskId) : undefined,
			onOpenPr: ctx.onAgentOpenPrTask ? () => ctx.onAgentOpenPrTask!(taskId) : undefined,
			isCommitLoading: ctx.agentCommitTaskLoadingById?.[taskId] ?? false,
			isOpenPrLoading: ctx.agentOpenPrTaskLoadingById?.[taskId] ?? false,
			showMoveToTrash: ctx.showMoveToTrashActions,
			onMoveToTrash: ctx.onMoveToTrash,
			isMoveToTrashLoading: ctx.isMoveToTrashLoading,
			onCancelAutomaticAction:
				ctx.selection.card.autoReviewEnabled === true && ctx.onCancelAutomaticTaskAction
					? () => ctx.onCancelAutomaticTaskAction!(taskId)
					: undefined,
			cancelAutomaticActionLabel:
				ctx.selection.card.autoReviewEnabled === true
					? getTaskAutoReviewCancelButtonLabel(ctx.selection.card.autoReviewMode)
					: null,
		}),
		[
			taskId,
			ctx.onAgentCommitTask,
			ctx.onAgentOpenPrTask,
			ctx.agentCommitTaskLoadingById,
			ctx.agentOpenPrTaskLoadingById,
			ctx.showMoveToTrashActions,
			ctx.onMoveToTrash,
			ctx.isMoveToTrashLoading,
			ctx.selection.card.autoReviewEnabled,
			ctx.selection.card.autoReviewMode,
			ctx.onCancelAutomaticTaskAction,
		],
	);
}

export function DockviewAgentPanel() {
	const ctx = useDetailPanelContext();
	const sharedProps = useSharedAgentProps(ctx);

	if (ctx.showClineAgentChatPanel) {
		return (
			<ClineAgentChatPanel
				ref={ctx.clineAgentChatPanelRef}
				taskId={ctx.selection.card.id}
				summary={ctx.sessionSummary}
				taskColumnId={ctx.selection.column.id}
				defaultMode={ctx.selection.card.startInPlanMode ? "plan" : "act"}
				workspaceId={ctx.currentProjectId}
				runtimeConfig={ctx.runtimeConfig}
				onClineSettingsSaved={ctx.onClineSettingsSaved}
				onSendMessage={ctx.onSendClineChatMessage}
				onCancelTurn={ctx.onCancelClineChatTurn}
				onLoadMessages={ctx.onLoadClineChatMessages}
				incomingMessages={ctx.streamedClineChatMessages}
				incomingMessage={ctx.latestClineChatMessage}
				{...sharedProps}
			/>
		);
	}

	return (
		<AgentTerminalPanel
			taskId={ctx.selection.card.id}
			workspaceId={ctx.currentProjectId}
			terminalEnabled={ctx.isTaskTerminalEnabled}
			summary={ctx.sessionSummary}
			onSummary={ctx.onSessionSummary}
			showSessionToolbar={false}
			autoFocus
			panelBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
			terminalBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
			showRightBorder={false}
			taskColumnId={ctx.selection.column.id}
			{...sharedProps}
		/>
	);
}
