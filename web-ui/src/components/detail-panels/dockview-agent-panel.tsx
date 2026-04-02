// ── Dockview panel: Agent (ClineAgentChatPanel or AgentTerminalPanel) ──

import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ClineAgentChatPanel } from "@/components/detail-panels/cline-agent-chat-panel";
import { TERMINAL_THEME_COLORS } from "@/terminal/theme-colors";
import { getTaskAutoReviewCancelButtonLabel } from "@/types";
import { useDetailPanelContext } from "./detail-panel-context";

export function DockviewAgentPanel() {
	const ctx = useDetailPanelContext();

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
				onCommit={ctx.onAgentCommitTask ? () => ctx.onAgentCommitTask!(ctx.selection.card.id) : undefined}
				onOpenPr={ctx.onAgentOpenPrTask ? () => ctx.onAgentOpenPrTask!(ctx.selection.card.id) : undefined}
				isCommitLoading={ctx.agentCommitTaskLoadingById?.[ctx.selection.card.id] ?? false}
				isOpenPrLoading={ctx.agentOpenPrTaskLoadingById?.[ctx.selection.card.id] ?? false}
				showMoveToTrash={ctx.showMoveToTrashActions}
				onMoveToTrash={ctx.onMoveToTrash}
				isMoveToTrashLoading={ctx.isMoveToTrashLoading}
				onCancelAutomaticAction={
					ctx.selection.card.autoReviewEnabled === true && ctx.onCancelAutomaticTaskAction
						? () => ctx.onCancelAutomaticTaskAction!(ctx.selection.card.id)
						: undefined
				}
				cancelAutomaticActionLabel={
					ctx.selection.card.autoReviewEnabled === true
						? getTaskAutoReviewCancelButtonLabel(ctx.selection.card.autoReviewMode)
						: null
				}
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
			onCommit={ctx.onAgentCommitTask ? () => ctx.onAgentCommitTask!(ctx.selection.card.id) : undefined}
			onOpenPr={ctx.onAgentOpenPrTask ? () => ctx.onAgentOpenPrTask!(ctx.selection.card.id) : undefined}
			isCommitLoading={ctx.agentCommitTaskLoadingById?.[ctx.selection.card.id] ?? false}
			isOpenPrLoading={ctx.agentOpenPrTaskLoadingById?.[ctx.selection.card.id] ?? false}
			showSessionToolbar={false}
			autoFocus
			showMoveToTrash={ctx.showMoveToTrashActions}
			onMoveToTrash={ctx.onMoveToTrash}
			isMoveToTrashLoading={ctx.isMoveToTrashLoading}
			onCancelAutomaticAction={
				ctx.selection.card.autoReviewEnabled === true && ctx.onCancelAutomaticTaskAction
					? () => ctx.onCancelAutomaticTaskAction!(ctx.selection.card.id)
					: undefined
			}
			cancelAutomaticActionLabel={
				ctx.selection.card.autoReviewEnabled === true
					? getTaskAutoReviewCancelButtonLabel(ctx.selection.card.autoReviewMode)
					: null
			}
			panelBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
			terminalBackgroundColor={TERMINAL_THEME_COLORS.surfacePrimary}
			showRightBorder={false}
			taskColumnId={ctx.selection.column.id}
		/>
	);
}
