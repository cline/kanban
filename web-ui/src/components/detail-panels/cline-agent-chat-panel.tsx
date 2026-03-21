// Layout component for the native Cline chat panel.
// Rendering lives here, while session state and action wiring come from the
// controller hook so multiple surfaces can share the same behavior.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { ClineChatComposer } from "@/components/detail-panels/cline-chat-composer";
import { ClineChatMessageItem } from "@/components/detail-panels/cline-chat-message-item";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ShimmeringText } from "@/components/ui/text-shimmer";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import { useClineChatPanelController } from "@/hooks/use-cline-chat-panel-controller";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { useRuntimeSettingsClineController } from "@/hooks/use-runtime-settings-cline-controller";
import type { RuntimeConfigResponse, RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "@/runtime/types";

const BOTTOM_LOCK_THRESHOLD_PX = 24;

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
	defaultMode?: RuntimeTaskSessionMode;
	composerPlaceholder?: string;
	showComposerModeToggle?: boolean;
	showRightBorder?: boolean;
	workspaceId?: string | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	onClineSettingsSaved?: () => void;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<ClineChatActionResult>;
	onCancelTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessages?: ClineChatMessage[] | null;
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
	defaultMode = "act",
	composerPlaceholder = "Ask Cline to add, edit, start, or link tasks",
	showComposerModeToggle = true,
	showRightBorder = true,
	workspaceId = null,
	runtimeConfig = null,
	onClineSettingsSaved,
	onSendMessage,
	onCancelTurn,
	onLoadMessages,
	incomingMessages,
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
		isSending,
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
		incomingMessages,
		incomingMessage,
		onCommit,
		onOpenPr,
		onMoveToTrash,
		onCancelAutomaticAction,
		cancelAutomaticActionLabel,
		showMoveToTrash,
	});
	const scrollContainerRef = useRef<HTMLDivElement | null>(null);
	const [composerError, setComposerError] = useState<string | null>(null);
	const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
	const [isSavingModel, setIsSavingModel] = useState(false);
	const [mode, setMode] = useState<RuntimeTaskSessionMode>(defaultMode);
	const clineSettings = useRuntimeSettingsClineController({
		open: true,
		workspaceId,
		selectedAgentId: "cline",
		config: runtimeConfig,
	});

	const modelOptions = useMemo(
		() =>
			clineSettings.providerModels.map((model) => ({
				value: model.id,
				label: model.name,
			})),
		[clineSettings.providerModels],
	);

	const selectedModelButtonText = useMemo(() => {
		if (isSavingModel) {
			return "Saving model...";
		}
		if (clineSettings.isLoadingProviderModels) {
			return "Loading models...";
		}
		const selectedOption = modelOptions.find((option) => option.value === clineSettings.modelId);
		if (selectedOption) {
			return selectedOption.label;
		}
		const trimmedModelId = clineSettings.modelId.trim();
		return trimmedModelId.length > 0 ? trimmedModelId : "Select model";
	}, [clineSettings.isLoadingProviderModels, clineSettings.modelId, isSavingModel, modelOptions]);

	const panelError = composerError ?? error;

	const isPinnedToBottom = useCallback((container: HTMLDivElement): boolean => {
		const remainingDistance = container.scrollHeight - container.scrollTop - container.clientHeight;
		return remainingDistance <= BOTTOM_LOCK_THRESHOLD_PX;
	}, []);

	const handleMessageListScroll = useCallback(() => {
		const container = scrollContainerRef.current;
		if (!container) {
			return;
		}
		const nextIsAutoScrollEnabled = isPinnedToBottom(container);
		setIsAutoScrollEnabled((currentValue) =>
			currentValue === nextIsAutoScrollEnabled ? currentValue : nextIsAutoScrollEnabled,
		);
	}, [isPinnedToBottom]);

	useLayoutEffect(() => {
		const container = scrollContainerRef.current;
		if (!container || !isAutoScrollEnabled) {
			return;
		}
		container.scrollTop = container.scrollHeight;
	}, [isAutoScrollEnabled, messages, showAgentProgressIndicator, showActionFooter, showReviewActions, showCancelAutomaticAction]);

	useEffect(() => {
		setComposerError(null);
	}, [taskId]);

	useEffect(() => {
		setIsAutoScrollEnabled(true);
	}, [taskId]);

	useEffect(() => {
		setMode(defaultMode);
	}, [defaultMode, taskId]);

	const persistSelectedModel = useCallback(
		async (nextModelId?: string): Promise<boolean> => {
			if (!workspaceId) {
				setComposerError("Select a workspace before choosing a Cline model.");
				return false;
			}
			if (clineSettings.providerId.trim().length === 0) {
				setComposerError("Choose a Cline provider in Settings before selecting a model.");
				return false;
			}
			setComposerError(null);
			setIsSavingModel(true);
			try {
				const result = await clineSettings.saveProviderSettings({
					modelId: nextModelId ?? clineSettings.modelId,
				});
				if (!result.ok) {
					setComposerError(result.message ?? "Could not save Cline model.");
					return false;
				}
				onClineSettingsSaved?.();
				return true;
			} finally {
				setIsSavingModel(false);
			}
		},
		[clineSettings, onClineSettingsSaved, workspaceId],
	);

	const handleSelectModel = useCallback(
		(nextModelId: string) => {
			if (nextModelId.trim() === clineSettings.modelId.trim()) {
				return;
			}
			clineSettings.setModelId(nextModelId);
			void persistSelectedModel(nextModelId);
		},
		[clineSettings.modelId, clineSettings.setModelId, persistSelectedModel],
	);

	const handleComposerSend = useCallback(async () => {
		if (isSavingModel) {
			return;
		}
		if (clineSettings.hasUnsavedChanges) {
			const saved = await persistSelectedModel();
			if (!saved) {
				return;
			}
		}
		await handleSendDraft(mode);
	}, [clineSettings.hasUnsavedChanges, handleSendDraft, isSavingModel, mode, persistSelectedModel]);

	return (
		<div
			className="flex min-h-0 min-w-0 flex-1 flex-col"
			style={{ borderRight: showRightBorder ? "1px solid var(--color-border)" : undefined }}
		>
			<div
				ref={scrollContainerRef}
				className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-3"
				onScroll={handleMessageListScroll}
			>
				{messages.map((message) => <ClineChatMessageItem key={message.id} message={message} />)}
				{showAgentProgressIndicator ? <ThinkingShimmer /> : null}
			</div>
			{panelError ? (
				<div className="border-t border-status-red/30 bg-status-red/10 px-2 py-2 text-xs text-status-red">{panelError}</div>
			) : null}
			<div className="px-2 py-3">
				<ClineChatComposer
					taskId={taskId}
					draft={draft}
					onDraftChange={setDraft}
					placeholder={composerPlaceholder}
					mode={mode}
					onModeChange={setMode}
					showModeToggle={showComposerModeToggle}
					canSend={canSend}
					canCancel={canCancel}
					onSend={handleComposerSend}
					onCancel={handleCancelTurn}
					modelOptions={modelOptions}
					selectedModelId={clineSettings.modelId}
					selectedModelButtonText={selectedModelButtonText}
					onSelectModel={handleSelectModel}
					isModelLoading={clineSettings.isLoadingProviderModels}
					isModelSaving={isSavingModel}
					modelPickerDisabled={isSavingModel || clineSettings.providerId.trim().length === 0}
					isSending={isSavingModel || isSending}
					warningMessage={summary?.warningMessage ?? null}
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
