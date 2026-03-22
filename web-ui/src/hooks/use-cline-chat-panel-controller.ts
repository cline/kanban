// Builds the view model for the native Cline chat panel.
// Keep panel-specific UI state here so the panel component can stay mostly
// declarative and shared across detail and sidebar surfaces.
import { useCallback, useEffect, useState } from "react";

import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import { type ClineChatMessage, useClineChatSession } from "@/hooks/use-cline-chat-session";
import type { RuntimeTaskImage, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";

interface UseClineChatPanelControllerInput {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
	taskColumnId?: string;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<ClineChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessages?: ClineChatMessage[] | null;
	incomingMessage?: ClineChatMessage | null;
	onCommit?: () => void;
	onOpenPr?: () => void;
	onMoveToTrash?: () => void;
	onCancelAutomaticAction?: () => void;
	cancelAutomaticActionLabel?: string | null;
	showMoveToTrash?: boolean;
}

interface UseClineChatPanelControllerResult {
	draft: string;
	setDraft: (draft: string) => void;
	messages: ClineChatMessage[];
	error: string | null;
	isSending: boolean;
	isCanceling: boolean;
	canSend: boolean;
	canCancel: boolean;
	showReviewActions: boolean;
	showAgentProgressIndicator: boolean;
	showActionFooter: boolean;
	showCancelAutomaticAction: boolean;
	handleSendText: (text: string, mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
	handleSendDraft: (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]) => Promise<boolean>;
	handleCancelTurn: () => void;
}

const ASSISTANT_STREAM_ACTIVITY_GRACE_MS = 500;

function isAssistantLikeIncomingMessage(message: ClineChatMessage | null): boolean {
	return message?.role === "assistant" || message?.role === "reasoning";
}

function getLatestAssistantLikeIncomingMessage(messages: ClineChatMessage[] | null): ClineChatMessage | null {
	if (!messages || messages.length === 0) {
		return null;
	}

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message && isAssistantLikeIncomingMessage(message)) {
			return message;
		}
	}

	return null;
}

function hasVisibleStreamingMessage(
	messages: ClineChatMessage[],
	incomingMessage: ClineChatMessage | null,
	hasRecentAssistantStreamActivity: boolean,
): boolean {
	if (hasRecentAssistantStreamActivity) {
		return true;
	}

	if (incomingMessage) {
		if (incomingMessage.role === "tool" && incomingMessage.meta?.hookEventName === "tool_call_start") {
			return true;
		}
	}

	return messages.some((message) => message.role === "tool" && message.meta?.hookEventName === "tool_call_start");
}

function hasFreshAssistantSummarySignal(summary: RuntimeTaskSessionSummary | null): boolean {
	if (summary?.latestHookActivity?.hookEventName !== "assistant_delta" || summary.updatedAt === null) {
		return false;
	}

	return Date.now() - summary.updatedAt < ASSISTANT_STREAM_ACTIVITY_GRACE_MS;
}

function useRecentAssistantStreamActivity(
	summary: RuntimeTaskSessionSummary | null,
	incomingMessages: ClineChatMessage[] | null,
	incomingMessage: ClineChatMessage | null,
): boolean {
	const latestHookEventName = summary?.latestHookActivity?.hookEventName ?? null;
	const latestAssistantLikeIncomingMessage = isAssistantLikeIncomingMessage(incomingMessage)
		? incomingMessage
		: getLatestAssistantLikeIncomingMessage(incomingMessages);
	const [hasRecentIncomingAssistantActivity, setHasRecentIncomingAssistantActivity] = useState(() =>
		latestAssistantLikeIncomingMessage !== null,
	);
	const [hasRecentAssistantSummaryActivity, setHasRecentAssistantSummaryActivity] = useState(() =>
		hasFreshAssistantSummarySignal(summary),
	);

	useEffect(() => {
		if (!latestAssistantLikeIncomingMessage) {
			setHasRecentIncomingAssistantActivity(false);
			return;
		}

		setHasRecentIncomingAssistantActivity(true);
		const timeoutId = window.setTimeout(() => {
			setHasRecentIncomingAssistantActivity(false);
		}, ASSISTANT_STREAM_ACTIVITY_GRACE_MS);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [
		latestAssistantLikeIncomingMessage?.id,
		latestAssistantLikeIncomingMessage?.role,
		latestAssistantLikeIncomingMessage?.content,
		latestAssistantLikeIncomingMessage?.meta?.hookEventName,
	]);

	useEffect(() => {
		const summaryUpdatedAt = summary?.updatedAt ?? null;
		if (latestHookEventName !== "assistant_delta" || summaryUpdatedAt === null) {
			setHasRecentAssistantSummaryActivity(false);
			return;
		}

		const remainingMs = summaryUpdatedAt + ASSISTANT_STREAM_ACTIVITY_GRACE_MS - Date.now();
		if (remainingMs <= 0) {
			setHasRecentAssistantSummaryActivity(false);
			return;
		}

		setHasRecentAssistantSummaryActivity(true);
		const timeoutId = window.setTimeout(() => {
			setHasRecentAssistantSummaryActivity(false);
		}, remainingMs);
		return () => {
			window.clearTimeout(timeoutId);
		};
	}, [latestHookEventName, summary?.updatedAt]);

	return hasRecentIncomingAssistantActivity || hasRecentAssistantSummaryActivity;
}

export function useClineChatPanelController({
	taskId,
	summary,
	taskColumnId = "in_progress",
	onSendMessage,
	onCancelTurn,
	onLoadMessages,
	incomingMessages = null,
	incomingMessage = null,
	onCommit,
	onOpenPr,
	onMoveToTrash,
	onCancelAutomaticAction,
	cancelAutomaticActionLabel,
	showMoveToTrash = false,
}: UseClineChatPanelControllerInput): UseClineChatPanelControllerResult {
	const [draft, setDraft] = useState("");
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(taskId);
	const { messages, isSending, isCanceling, error, sendMessage, cancelTurn } = useClineChatSession({
		taskId,
		onSendMessage,
		onCancelTurn,
		onLoadMessages,
		incomingMessages,
		incomingMessage,
	});
	const canSend = Boolean(onSendMessage) && !isSending && !isCanceling;
	const canCancel = Boolean(onCancelTurn) && summary?.state === "running" && !isCanceling;
	const showReviewActions =
		taskColumnId === "review" &&
		(reviewWorkspaceSnapshot?.changedFiles ?? 0) > 0 &&
		Boolean(onCommit) &&
		Boolean(onOpenPr);
	const hasRecentAssistantStreamActivity = useRecentAssistantStreamActivity(summary, incomingMessages, incomingMessage);
	const showAgentProgressIndicator =
		summary?.state === "running" &&
		!hasVisibleStreamingMessage(messages, incomingMessage, hasRecentAssistantStreamActivity);
	const showActionFooter = showMoveToTrash && Boolean(onMoveToTrash);
	const showCancelAutomaticAction = Boolean(cancelAutomaticActionLabel && onCancelAutomaticAction);

	const handleSendText = useCallback(
		async (text: string, mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]): Promise<boolean> => {
			return sendMessage(
				text,
				mode || images?.length
					? {
						...(mode ? { mode } : {}),
						...(images?.length ? { images } : {}),
					}
					: undefined,
			);
		},
		[sendMessage],
	);

	const handleSendDraft = useCallback(async (mode?: RuntimeTaskSessionMode, images?: RuntimeTaskImage[]): Promise<boolean> => {
		const sent = await handleSendText(draft, mode, images);
		if (sent) {
			setDraft("");
		}
		return sent;
	}, [draft, handleSendText]);

	const handleCancelTurn = useCallback(() => {
		void cancelTurn();
	}, [cancelTurn]);

	return {
		draft,
		setDraft,
		messages,
		error,
		isSending,
		isCanceling,
		canSend,
		canCancel,
		showReviewActions,
		showAgentProgressIndicator,
		showActionFooter,
		showCancelAutomaticAction,
		handleSendText,
		handleSendDraft,
		handleCancelTurn,
	};
}
