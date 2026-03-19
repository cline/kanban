// Layout component for the native Cline chat panel.
// Rendering lives here, while session state and action wiring come from the
// controller hook so multiple surfaces can share the same behavior.
import React, { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ShimmeringText } from "@/components/ui/text-shimmer";
import { ClineChatMessageItem } from "@/components/detail-panels/cline-chat-message-item";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import { useClineChatPanelController } from "@/hooks/use-cline-chat-panel-controller";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";

const CLINE_CHAT_COMPOSER_MAX_HEIGHT = 160;

const ThinkingShimmer = React.memo(function ThinkingShimmer() {
	return (
		<div className="px-1.5">
			<ShimmeringText text="Thinking..." className="text-sm" duration={2.5} spread={5} repeatDelay={1.2} startOnView={false} />
		</div>
	);
});

export interface ClineAgentChatPanelProps {
	taskId: string;
	summary: RuntimeTaskSessionSummary | null;
	taskColumnId?: string;
	composerPlaceholder?: string;
	showRightBorder?: boolean;
	onSendMessage?: (taskId: string, text: string) => Promise<ClineChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessage?: ClineChatMessage | null;
	onCommit?: () => void;
	onOpenPr?: () => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
	onMoveToTrash?: () => void;
	isMoveToTrashLoading?: boolean;
	onCancelAutomaticAction?: () => void;
	cancelAutomaticActionLabel?: string | null;
	showMoveToTrash?: boolean;
}

export function ClineAgentChatPanel({
	taskId,
	summary,
	taskColumnId = "in_progress",
	composerPlaceholder = "Ask Cline to make progress on this task",
	showRightBorder = true,
	onSendMessage,
	onCancelTurn,
	onLoadMessages,
	incomingMessage,
	onCommit,
	onOpenPr,
	isCommitLoading = false,
	isOpenPrLoading = false,
	onMoveToTrash,
	isMoveToTrashLoading = false,
	onCancelAutomaticAction,
	cancelAutomaticActionLabel,
	showMoveToTrash = false,
}: ClineAgentChatPanelProps): ReactElement {
	const {
		draft,
		setDraft,
		messages,
		error,
		canSend,
		canCancel,
		showReviewActions,
		showAgentProgressIndicator,
		showActionFooter,
		showCancelAutomaticAction,
		handleSendDraft,
		handleCancelTurn,
	} = useClineChatPanelController({
		taskId,
		summary,
		taskColumnId,
		onSendMessage,
		onCancelTurn,
		onLoadMessages,
		incomingMessage,
		onCommit,
		onOpenPr,
		onMoveToTrash,
		onCancelAutomaticAction,
		cancelAutomaticActionLabel,
		showMoveToTrash,
	});
	const messageEndRef = useRef<HTMLDivElement | null>(null);
	const composerRef = useRef<HTMLTextAreaElement | null>(null);

	useLayoutEffect(() => {
		messageEndRef.current?.scrollIntoView({ block: "end" });
	}, [messages, showAgentProgressIndicator, showActionFooter, showReviewActions, showCancelAutomaticAction]);

	useLayoutEffect(() => {
		const textarea = composerRef.current;
		if (!textarea) {
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, CLINE_CHAT_COMPOSER_MAX_HEIGHT)}px`;
		textarea.style.overflowY = textarea.scrollHeight > CLINE_CHAT_COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
	}, [draft]);

	useEffect(() => {
		if (!canSend) {
			return;
		}
		composerRef.current?.focus();
	}, [canSend, taskId]);

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-1"
			style={{ borderRight: showRightBorder ? "1px solid var(--color-border)" : undefined }}
		>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-3">
				{messages.length === 0 ? (
					<div className="text-sm text-text-secondary">Send a message to start chatting with Cline.</div>
				) : (
					messages.map((message) => <ClineChatMessageItem key={message.id} message={message} />)
				)}
				{showAgentProgressIndicator ? (
					<ThinkingShimmer />
				) : null}
				<div ref={messageEndRef} aria-hidden="true" />
			</div>
			{error ? <div className="border-t border-status-red/30 bg-status-red/10 px-3 py-2 text-xs text-status-red">{error}</div> : null}
			<div className="border-t border-border px-3 py-3">
				<textarea
					ref={composerRef}
					value={draft}
					onChange={(event) => setDraft(event.target.value)}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) {
							return;
						}
						if (event.key === "Escape") {
							if (!canCancel) {
								return;
							}
							event.preventDefault();
							handleCancelTurn();
							return;
						}
						if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
							return;
						}
						if (!canSend || draft.trim().length === 0) {
							return;
						}
						event.preventDefault();
						void handleSendDraft();
					}}
					placeholder={composerPlaceholder}
					disabled={!canSend}
					rows={1}
					className="w-full min-h-9 resize-none rounded-md border border-border bg-surface-2 px-2 py-2 text-sm leading-5 text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none disabled:opacity-50"
					style={{ maxHeight: CLINE_CHAT_COMPOSER_MAX_HEIGHT }}
				/>
			</div>
			{showActionFooter ? (
				<div className="flex flex-col gap-2 px-3 pb-3">
					{showReviewActions ? (
						<div className="flex gap-2">
							<Button
								variant="primary"
								size="sm"
								fill
								disabled={isCommitLoading || isOpenPrLoading}
								onClick={onCommit}
							>
								{isCommitLoading ? "..." : "Commit"}
							</Button>
							<Button
								variant="primary"
								size="sm"
								fill
								disabled={isCommitLoading || isOpenPrLoading}
								onClick={onOpenPr}
							>
								{isOpenPrLoading ? "..." : "Open PR"}
							</Button>
						</div>
					) : null}
					{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
						<Button variant="default" fill onClick={onCancelAutomaticAction}>
							{cancelAutomaticActionLabel}
						</Button>
					) : null}
					<Button variant="danger" fill disabled={isMoveToTrashLoading} onClick={onMoveToTrash}>
						{isMoveToTrashLoading ? <Spinner size={14} /> : "Move Card To Trash"}
					</Button>
				</div>
			) : null}
		</div>
	);
}
