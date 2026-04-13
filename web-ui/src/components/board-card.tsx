import { Draggable } from "@hello-pangea/dnd";
import { getRuntimeAgentCatalogEntry } from "@runtime-agent-catalog";
import { formatClineToolCallLabel } from "@runtime-cline-tool-call-display";
import { buildTaskWorktreeDisplayPath } from "@runtime-task-worktree-path";
import { AlertCircle, AlertTriangle, Bot, GitBranch, Play, RotateCcw, Trash2 } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	formatClineReasoningEffortLabel,
	formatClineSelectedModelButtonText,
	resolveClineModelDisplayName,
} from "@/components/detail-panels/cline-model-picker-options";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import type { BoardCard as BoardCardModel, BoardColumnId } from "@/types";
import { getTaskAutoReviewCancelButtonLabel } from "@/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { useMeasure } from "@/utils/react-use";
import {
	clampTextWithInlineSuffix,
	getTaskPromptDescription,
	normalizePromptForDisplay,
	truncateTaskPromptLabel,
} from "@/utils/task-prompt";
import { DEFAULT_TEXT_MEASURE_FONT, measureTextWidth, readElementFontShorthand } from "@/utils/text-measure";

interface CardSessionActivity {
	dotColor: string;
	text: string;
}

const SESSION_ACTIVITY_COLOR = {
	thinking: "var(--color-status-blue)",
	success: "var(--color-status-green)",
	waiting: "var(--color-status-gold)",
	error: "var(--color-status-red)",
	warning: "var(--color-status-orange)",
	muted: "var(--color-text-tertiary)",
	secondary: "var(--color-text-secondary)",
} as const;

const DESCRIPTION_COLLAPSE_LINES = 3;
const SESSION_PREVIEW_COLLAPSE_LINES = 6;
const DESCRIPTION_EXPAND_LABEL = "See more";
const DESCRIPTION_COLLAPSE_LABEL = "Less";
const DESCRIPTION_COLLAPSE_SUFFIX = `… ${DESCRIPTION_EXPAND_LABEL}`;

function reconstructTaskWorktreeDisplayPath(taskId: string, workspacePath: string | null | undefined): string | null {
	if (!workspacePath) {
		return null;
	}
	try {
		return buildTaskWorktreeDisplayPath(taskId, workspacePath);
	} catch {
		return null;
	}
}

function extractToolInputSummaryFromActivityText(activityText: string, toolName: string): string | null {
	const escapedToolName = toolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = activityText.match(
		new RegExp(`^(?:Using|Completed|Failed|Calling)\\s+${escapedToolName}(?::\\s*(.+))?$`),
	);
	if (!match) {
		return null;
	}
	const rawSummary = match[1]?.trim() ?? "";
	if (!rawSummary) {
		return null;
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return operationSummary?.trim() || null;
	}
	return rawSummary;
}

function parseToolCallFromActivityText(
	activityText: string,
): { toolName: string; toolInputSummary: string | null } | null {
	const match = activityText.match(/^(?:Using|Completed|Failed|Calling)\s+([^:()]+?)(?::\s*(.+))?$/);
	if (!match?.[1]) {
		return null;
	}
	const toolName = match[1].trim();
	if (!toolName) {
		return null;
	}
	const rawSummary = match[2]?.trim() ?? "";
	if (!rawSummary) {
		return { toolName, toolInputSummary: null };
	}
	if (activityText.startsWith("Failed ")) {
		const [operationSummary] = rawSummary.split(": ");
		return {
			toolName,
			toolInputSummary: operationSummary?.trim() || null,
		};
	}
	return {
		toolName,
		toolInputSummary: rawSummary,
	};
}

function resolveToolCallLabel(
	activityText: string | undefined,
	toolName: string | null,
	toolInputSummary: string | null,
): string | null {
	if (toolName) {
		const parsedSummary = extractToolInputSummaryFromActivityText(activityText ?? "", toolName);
		if (!toolInputSummary && !parsedSummary) {
			return null;
		}
		return formatClineToolCallLabel(toolName, toolInputSummary ?? parsedSummary);
	}
	if (!activityText) {
		return null;
	}
	const parsed = parseToolCallFromActivityText(activityText);
	if (!parsed) {
		return null;
	}
	return formatClineToolCallLabel(parsed.toolName, parsed.toolInputSummary);
}

function isCardCreditLimitError(summary: RuntimeTaskSessionSummary | undefined): boolean {
	if (!summary) {
		return false;
	}
	if (summary.state !== "awaiting_review" && summary.state !== "failed" && summary.state !== "interrupted") {
		return false;
	}
	return summary.latestHookActivity?.notificationType === "credit_limit";
}

function getCardSessionActivity(summary: RuntimeTaskSessionSummary | undefined): CardSessionActivity | null {
	if (!summary) {
		return null;
	}
	if (isCardCreditLimitError(summary)) {
		return { dotColor: SESSION_ACTIVITY_COLOR.warning, text: "Out of credits" };
	}
	const hookActivity = summary.latestHookActivity;
	const activityText = hookActivity?.activityText?.trim();
	const toolName = hookActivity?.toolName?.trim() ?? null;
	const toolInputSummary = hookActivity?.toolInputSummary?.trim() ?? null;
	const finalMessage = hookActivity?.finalMessage?.trim();
	const hookEventName = hookActivity?.hookEventName?.trim() ?? null;
	if (summary.state === "awaiting_review" && finalMessage) {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: finalMessage };
	}
	if (
		finalMessage &&
		!toolName &&
		(hookEventName === "assistant_delta" || hookEventName === "agent_end" || hookEventName === "turn_start")
	) {
		return {
			dotColor: summary.state === "running" ? SESSION_ACTIVITY_COLOR.thinking : SESSION_ACTIVITY_COLOR.success,
			text: finalMessage,
		};
	}
	if (activityText) {
		let dotColor: string =
			summary.state === "failed" ? SESSION_ACTIVITY_COLOR.error : SESSION_ACTIVITY_COLOR.thinking;
		let text = activityText;
		const toolCallLabel = resolveToolCallLabel(activityText, toolName, toolInputSummary);
		if (toolCallLabel) {
			if (text.startsWith("Failed ")) {
				dotColor = SESSION_ACTIVITY_COLOR.error;
			}
			return {
				dotColor,
				text: toolCallLabel,
			};
		}
		if (text.startsWith("Final: ")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
			text = text.slice(7);
		} else if (text.startsWith("Agent: ")) {
			text = text.slice(7);
		} else if (text.startsWith("Waiting for approval")) {
			dotColor = SESSION_ACTIVITY_COLOR.waiting;
		} else if (text.startsWith("Waiting for review")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
		} else if (text.startsWith("Failed ")) {
			dotColor = SESSION_ACTIVITY_COLOR.error;
		} else if (text === "Agent active" || text === "Working on task" || text.startsWith("Resumed")) {
			return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: "Thinking..." };
		}
		return { dotColor, text };
	}
	if (summary.state === "failed") {
		const failedText = finalMessage ?? activityText ?? "Task failed to start";
		return { dotColor: SESSION_ACTIVITY_COLOR.error, text: failedText };
	}
	if (summary.state === "awaiting_review") {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: "Waiting for review" };
	}
	if (summary.state === "running") {
		return { dotColor: SESSION_ACTIVITY_COLOR.thinking, text: "Thinking..." };
	}
	return null;
}

export function BoardCard({
	card,
	index,
	columnId,
	sessionSummary,
	selected = false,
	onClick,
	onStart,
	onMoveToTrash,
	onRestoreFromTrash,
	onSaveTitle,
	onCommit,
	onOpenPr,
	onCancelAutomaticAction,
	isCommitLoading = false,
	isOpenPrLoading = false,
	isMoveToTrashLoading = false,
	onDependencyPointerDown,
	onDependencyPointerEnter,
	isDependencySource = false,
	isDependencyTarget = false,
	isDependencyLinking = false,
	workspacePath,
	defaultClineModelId = null,
}: {
	card: BoardCardModel;
	index: number;
	columnId: BoardColumnId;
	sessionSummary?: RuntimeTaskSessionSummary;
	selected?: boolean;
	onClick?: () => void;
	onStart?: (taskId: string) => void;
	onMoveToTrash?: (taskId: string) => void;
	onRestoreFromTrash?: (taskId: string) => void;
	onSaveTitle?: (taskId: string, title: string) => void;
	onCommit?: (taskId: string) => void;
	onOpenPr?: (taskId: string) => void;
	onCancelAutomaticAction?: (taskId: string) => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
	isMoveToTrashLoading?: boolean;
	onDependencyPointerDown?: (taskId: string, event: MouseEvent<HTMLElement>) => void;
	onDependencyPointerEnter?: (taskId: string) => void;
	isDependencySource?: boolean;
	isDependencyTarget?: boolean;
	isDependencyLinking?: boolean;
	workspacePath?: string | null;
	defaultClineModelId?: string | null;
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const [isEditingTitle, setIsEditingTitle] = useState(false);
	const [draftTitle, setDraftTitle] = useState(card.title);
	const titleInputRef = useRef<HTMLInputElement | null>(null);
	const titleEditCancelledRef = useRef(false);
	const [descriptionContainerRef, descriptionRect] = useMeasure<HTMLDivElement>();
	const [sessionPreviewContainerRef, sessionPreviewRect] = useMeasure<HTMLDivElement>();
	const descriptionRef = useRef<HTMLParagraphElement | null>(null);
	const sessionPreviewRef = useRef<HTMLParagraphElement | null>(null);
	const [descriptionWidthFallback, setDescriptionWidthFallback] = useState(0);
	const [sessionPreviewWidthFallback, setSessionPreviewWidthFallback] = useState(0);
	const [descriptionFont, setDescriptionFont] = useState(DEFAULT_TEXT_MEASURE_FONT);
	const [sessionPreviewFont, setSessionPreviewFont] = useState(DEFAULT_TEXT_MEASURE_FONT);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const [isSessionPreviewExpanded, setIsSessionPreviewExpanded] = useState(false);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(card.id);
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;
	const descriptionWidth = descriptionRect.width > 0 ? descriptionRect.width : descriptionWidthFallback;
	const sessionPreviewWidth = sessionPreviewRect.width > 0 ? sessionPreviewRect.width : sessionPreviewWidthFallback;
	const rawSessionActivity = useMemo(() => getCardSessionActivity(sessionSummary), [sessionSummary]);
	const lastSessionActivityRef = useRef<CardSessionActivity | null>(null);
	const lastSessionActivityCardIdRef = useRef<string | null>(null);
	if (lastSessionActivityCardIdRef.current !== card.id) {
		lastSessionActivityCardIdRef.current = card.id;
		lastSessionActivityRef.current = null;
	}
	if (rawSessionActivity) {
		lastSessionActivityRef.current = rawSessionActivity;
	}
	const sessionActivity = rawSessionActivity ?? lastSessionActivityRef.current;
	const displayTitle = useMemo(
		() => normalizePromptForDisplay(card.title) || truncateTaskPromptLabel(card.prompt),
		[card.prompt, card.title],
	);
	const displayDescription = useMemo(
		() => getTaskPromptDescription(card.prompt, displayTitle),
		[card.prompt, displayTitle],
	);

	useLayoutEffect(() => {
		if (descriptionRect.width > 0 || !displayDescription) {
			return;
		}
		const nextWidth = descriptionRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
		if (nextWidth > 0 && nextWidth !== descriptionWidthFallback) {
			setDescriptionWidthFallback(nextWidth);
		}
	}, [descriptionRect.width, descriptionWidthFallback, displayDescription]);

	useLayoutEffect(() => {
		if (sessionPreviewRect.width > 0 || !isTrashCard || !sessionActivity?.text) {
			return;
		}
		const nextWidth = sessionPreviewRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
		if (nextWidth > 0 && nextWidth !== sessionPreviewWidthFallback) {
			setSessionPreviewWidthFallback(nextWidth);
		}
	}, [isTrashCard, sessionActivity?.text, sessionPreviewRect.width, sessionPreviewWidthFallback]);

	useLayoutEffect(() => {
		setDescriptionFont(readElementFontShorthand(descriptionRef.current, DEFAULT_TEXT_MEASURE_FONT));
	}, [descriptionWidth, displayDescription]);

	useLayoutEffect(() => {
		setSessionPreviewFont(readElementFontShorthand(sessionPreviewRef.current, DEFAULT_TEXT_MEASURE_FONT));
	}, [sessionActivity?.text, sessionPreviewWidth]);

	useEffect(() => {
		setIsDescriptionExpanded(false);
	}, [card.id, displayDescription]);

	useEffect(() => {
		setIsSessionPreviewExpanded(false);
	}, [card.id, sessionActivity?.text]);

	useEffect(() => {
		setDraftTitle(card.title);
		setIsEditingTitle(false);
	}, [card.id, card.title]);

	useEffect(() => {
		if (!isEditingTitle) {
			return;
		}
		window.requestAnimationFrame(() => {
			titleInputRef.current?.focus();
			titleInputRef.current?.select();
		});
	}, [isEditingTitle]);

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const submitTitle = () => {
		if (titleEditCancelledRef.current) {
			titleEditCancelledRef.current = false;
			return;
		}
		setIsEditingTitle(false);
		if (!onSaveTitle) {
			return;
		}
		const trimmed = draftTitle.trim();
		if (trimmed === card.title) {
			return;
		}
		onSaveTitle(card.id, trimmed);
	};

	const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			titleInputRef.current?.blur();
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			titleEditCancelledRef.current = true;
			setDraftTitle(card.title);
			setIsEditingTitle(false);
			titleInputRef.current?.blur();
		}
	};

	const isDescriptionMeasured = descriptionRect.width > 0;
	const isSessionPreviewMeasured = sessionPreviewRect.width > 0;

	const descriptionDisplay = useMemo(() => {
		if (!displayDescription) {
			return {
				text: "",
				isTruncated: false,
			};
		}
		if (descriptionWidth <= 0) {
			return {
				text: displayDescription,
				isTruncated: false,
			};
		}
		return clampTextWithInlineSuffix(displayDescription, {
			maxWidthPx: descriptionWidth,
			maxLines: DESCRIPTION_COLLAPSE_LINES,
			suffix: DESCRIPTION_COLLAPSE_SUFFIX,
			measureText: (value) => measureTextWidth(value, descriptionFont),
		});
	}, [descriptionFont, descriptionWidth, displayDescription]);

	const sessionPreviewDisplay = useMemo(() => {
		if (!sessionActivity?.text) {
			return {
				text: "",
				isTruncated: false,
			};
		}
		if (sessionPreviewWidth <= 0) {
			return {
				text: sessionActivity.text,
				isTruncated: false,
			};
		}
		return clampTextWithInlineSuffix(sessionActivity.text, {
			maxWidthPx: sessionPreviewWidth,
			maxLines: SESSION_PREVIEW_COLLAPSE_LINES,
			suffix: DESCRIPTION_COLLAPSE_SUFFIX,
			measureText: (value) => measureTextWidth(value, sessionPreviewFont),
		});
	}, [sessionActivity?.text, sessionPreviewFont, sessionPreviewWidth]);

	const isCreditLimit = isCardCreditLimitError(sessionSummary);
	const renderStatusMarker = () => {
		if (isCreditLimit) {
			return <AlertTriangle size={12} className="text-status-orange" />;
		}
		if (columnId === "in_progress") {
			if (sessionSummary?.state === "failed") {
				return <AlertCircle size={12} className="text-status-red" />;
			}
			return <Spinner size={12} />;
		}
		return null;
	};
	const statusMarker = renderStatusMarker();
	const showWorkspaceStatus = columnId === "in_progress" || columnId === "review" || isTrashCard;
	const reviewWorkspacePath = reviewWorkspaceSnapshot
		? formatPathForDisplay(reviewWorkspaceSnapshot.path)
		: isTrashCard
			? reconstructTaskWorktreeDisplayPath(card.id, workspacePath)
			: null;
	const reviewRefLabel = reviewWorkspaceSnapshot?.branch ?? reviewWorkspaceSnapshot?.headCommit?.slice(0, 8) ?? "HEAD";
	const reviewChangeSummary = reviewWorkspaceSnapshot
		? reviewWorkspaceSnapshot.changedFiles == null
			? null
			: {
					filesLabel: `${reviewWorkspaceSnapshot.changedFiles} ${reviewWorkspaceSnapshot.changedFiles === 1 ? "file" : "files"}`,
					additions: reviewWorkspaceSnapshot.additions ?? 0,
					deletions: reviewWorkspaceSnapshot.deletions ?? 0,
				}
		: null;
	const showReviewGitActions = columnId === "review" && (reviewWorkspaceSnapshot?.changedFiles ?? 0) > 0;
	const isAnyGitActionLoading = isCommitLoading || isOpenPrLoading;
	const cancelAutomaticActionLabel =
		!isTrashCard && card.autoReviewEnabled ? getTaskAutoReviewCancelButtonLabel(card.autoReviewMode) : null;
	const agentOverrideLabel = useMemo(
		() => (card.agentId ? (getRuntimeAgentCatalogEntry(card.agentId)?.label ?? card.agentId) : null),
		[card.agentId],
	);
	const modelOverrideLabel = useMemo(() => {
		if (card.clineSettings === undefined) {
			return null;
		}
		const explicitReasoningLabel = card.clineSettings.reasoningEffort
			? formatClineReasoningEffortLabel(card.clineSettings.reasoningEffort)
			: !card.clineSettings.providerId && !card.clineSettings.modelId
				? "Default"
				: null;
		if (card.clineSettings.providerId && !card.clineSettings.modelId) {
			const providerLabel = `Provider: ${card.clineSettings.providerId}`;
			return explicitReasoningLabel ? `${providerLabel} (${explicitReasoningLabel})` : providerLabel;
		}
		const effectiveModelId = card.clineSettings.modelId ?? defaultClineModelId;
		if (!effectiveModelId) {
			return explicitReasoningLabel ? `Default model (${explicitReasoningLabel})` : null;
		}
		const modelName = resolveClineModelDisplayName(effectiveModelId);
		if (explicitReasoningLabel) {
			return `${modelName} (${explicitReasoningLabel})`;
		}
		const inheritedReasoningEffort = "";
		return formatClineSelectedModelButtonText({
			modelName,
			reasoningEffort: inheritedReasoningEffort,
			showReasoningEffort: Boolean(inheritedReasoningEffort),
		});
	}, [card.clineSettings, defaultClineModelId]);
	const taskAgentSettingsLabel = useMemo(() => {
		const parts = [agentOverrideLabel, modelOverrideLabel].filter((value): value is string => Boolean(value));
		return parts.length > 0 ? parts.join(" · ") : null;
	}, [agentOverrideLabel, modelOverrideLabel]);

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={false}>
			{(provided, snapshot) => {
				const isDragging = snapshot.isDragging;
				const draggableContent = (
					<div
						ref={provided.innerRef}
						{...provided.draggableProps}
						{...provided.dragHandleProps}
						className="kb-board-card-shell"
						data-task-id={card.id}
						data-column-id={columnId}
						data-selected={selected}
						onMouseDownCapture={(event) => {
							if (!isCardInteractive) {
								return;
							}
							if (isDependencyLinking) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (!event.metaKey && !event.ctrlKey) {
								return;
							}
							const target = event.target as HTMLElement | null;
							if (target?.closest("button, a, input, textarea, [contenteditable='true']")) {
								return;
							}
							event.preventDefault();
							event.stopPropagation();
							onDependencyPointerDown?.(card.id, event);
						}}
						onClick={(event) => {
							if (!isCardInteractive) {
								return;
							}
							if (isDependencyLinking) {
								event.preventDefault();
								event.stopPropagation();
								return;
							}
							if (event.metaKey || event.ctrlKey) {
								return;
							}
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 6,
							cursor: "grab",
						}}
						onMouseEnter={() => {
							setIsHovered(true);
							onDependencyPointerEnter?.(card.id);
						}}
						onMouseMove={() => {
							if (!isDependencyLinking) {
								return;
							}
							onDependencyPointerEnter?.(card.id);
						}}
						onMouseLeave={() => setIsHovered(false)}
					>
						<div
							className={cn(
								"rounded-md border border-border-bright bg-surface-2 p-2.5",
								isCardInteractive && "cursor-pointer hover:bg-surface-3 hover:border-border-bright",
								isDragging && "shadow-lg",
								isHovered && isCardInteractive && "bg-surface-3 border-border-bright",
								isDependencySource && "kb-board-card-dependency-source",
								isDependencyTarget && "kb-board-card-dependency-target",
							)}
						>
							<div className="flex items-center gap-2" style={{ minHeight: 24 }}>
								{statusMarker ? <div className="inline-flex items-center">{statusMarker}</div> : null}
								<div className="flex-1 min-w-0">
									{isEditingTitle ? (
										<input
											ref={titleInputRef}
											value={draftTitle}
											onChange={(event) => setDraftTitle(event.currentTarget.value)}
											onBlur={submitTitle}
											onKeyDown={handleTitleKeyDown}
											onMouseDown={(event) => {
												event.stopPropagation();
											}}
											className="h-7 w-full rounded-md border border-border-focus bg-surface-2 px-2 text-sm font-medium text-text-primary focus:outline-none"
										/>
									) : onSaveTitle ? (
										<button
											type="button"
											aria-label="Edit task title"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												setDraftTitle(card.title);
												setIsEditingTitle(true);
											}}
											className={cn(
												"kb-line-clamp-1 m-0 w-full cursor-text rounded-sm text-left font-medium text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
												isTrashCard && "line-through text-text-tertiary",
											)}
										>
											{displayTitle}
										</button>
									) : (
										<p
											className={cn(
												"kb-line-clamp-1 m-0 font-medium text-sm",
												isTrashCard && "line-through text-text-tertiary",
											)}
										>
											{displayTitle}
										</p>
									)}
								</div>
								{columnId === "backlog" ? (
									<Button
										icon={<Play size={14} />}
										variant="ghost"
										size="sm"
										aria-label="Start task"
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onStart?.(card.id);
										}}
									/>
								) : columnId === "review" ? (
									<Button
										icon={isMoveToTrashLoading ? <Spinner size={13} /> : <Trash2 size={13} />}
										variant="ghost"
										size="sm"
										disabled={isMoveToTrashLoading}
										aria-label="Move task to trash"
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onMoveToTrash?.(card.id);
										}}
									/>
								) : columnId === "trash" ? (
									<Tooltip
										side="bottom"
										content={
											<>
												Restore session
												<br />
												in new worktree
											</>
										}
									>
										<Button
											icon={<RotateCcw size={12} />}
											variant="ghost"
											size="sm"
											aria-label="Restore task from trash"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onRestoreFromTrash?.(card.id);
											}}
										/>
									</Tooltip>
								) : null}
							</div>
							{displayDescription ? (
								<div ref={descriptionContainerRef}>
									<p
										ref={descriptionRef}
										className={cn(
											"text-sm leading-[1.4]",
											isTrashCard ? "text-text-tertiary" : "text-text-secondary",
											!isDescriptionMeasured && !isDescriptionExpanded && "line-clamp-3",
										)}
										style={{
											margin: "2px 0 0",
										}}
									>
										{isDescriptionExpanded || !descriptionDisplay.isTruncated
											? displayDescription
											: descriptionDisplay.text}
										{descriptionDisplay.isTruncated ? (
											isDescriptionExpanded ? (
												<>
													{" "}
													<button
														type="button"
														className="inline cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [color:inherit] [font:inherit]"
														aria-expanded={isDescriptionExpanded}
														aria-label="Collapse task description"
														onMouseDown={stopEvent}
														onClick={(event) => {
															stopEvent(event);
															setIsDescriptionExpanded(false);
														}}
													>
														{DESCRIPTION_COLLAPSE_LABEL}
													</button>
												</>
											) : (
												<>
													{"… "}
													<button
														type="button"
														className="inline cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [color:inherit] [font:inherit]"
														aria-expanded={isDescriptionExpanded}
														aria-label="Expand task description"
														onMouseDown={stopEvent}
														onClick={(event) => {
															stopEvent(event);
															setIsDescriptionExpanded(true);
														}}
													>
														{DESCRIPTION_EXPAND_LABEL}
													</button>
												</>
											)
										) : null}
									</p>
								</div>
							) : null}
							{taskAgentSettingsLabel ? (
								<div className="mt-1">
									<span
										className={cn(
											"inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs",
											isTrashCard
												? "border-border text-text-tertiary bg-surface-1"
												: "border-status-blue/30 bg-status-blue/10 text-status-blue",
										)}
									>
										<Bot size={12} className="shrink-0" />
										<span className="truncate">{taskAgentSettingsLabel}</span>
									</span>
								</div>
							) : null}
							{sessionActivity ? (
								<div
									className="flex gap-1.5 items-start mt-[6px]"
									style={{
										color: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : undefined,
									}}
								>
									<span
										className="inline-block shrink-0 rounded-full"
										style={{
											width: 6,
											height: 6,
											backgroundColor: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : sessionActivity.dotColor,
											marginTop: 4,
										}}
									/>
									<div ref={sessionPreviewContainerRef} className="min-w-0 flex-1">
										<p
											ref={sessionPreviewRef}
											className={cn(
												"m-0 font-mono",
												!isSessionPreviewMeasured && !isSessionPreviewExpanded && "line-clamp-6",
											)}
											style={{
												fontSize: 12,
												whiteSpace: "normal",
												overflowWrap: "anywhere",
											}}
										>
											{isSessionPreviewExpanded || !sessionPreviewDisplay.isTruncated
												? sessionActivity.text
												: sessionPreviewDisplay.text}
											{sessionPreviewDisplay.isTruncated ? (
												isSessionPreviewExpanded ? (
													<>
														{" "}
														<button
															type="button"
															className="inline cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [color:inherit] [font:inherit]"
															aria-expanded={isSessionPreviewExpanded}
															aria-label="Collapse task agent preview"
															onMouseDown={stopEvent}
															onClick={(event) => {
																stopEvent(event);
																setIsSessionPreviewExpanded(false);
															}}
														>
															{DESCRIPTION_COLLAPSE_LABEL}
														</button>
													</>
												) : (
													<>
														{"… "}
														<button
															type="button"
															className="inline cursor-pointer rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [color:inherit] [font:inherit]"
															aria-expanded={isSessionPreviewExpanded}
															aria-label="Expand task agent preview"
															onMouseDown={stopEvent}
															onClick={(event) => {
																stopEvent(event);
																setIsSessionPreviewExpanded(true);
															}}
														>
															{DESCRIPTION_EXPAND_LABEL}
														</button>
													</>
												)
											) : null}
										</p>
									</div>
								</div>
							) : null}
							{showWorkspaceStatus && reviewWorkspacePath ? (
								<p
									className="font-mono"
									style={{
										margin: "4px 0 0",
										fontSize: 12,
										lineHeight: 1.4,
										whiteSpace: "normal",
										overflowWrap: "anywhere",
										color: isTrashCard ? SESSION_ACTIVITY_COLOR.muted : undefined,
									}}
								>
									{isTrashCard ? (
										<span
											style={{
												color: SESSION_ACTIVITY_COLOR.muted,
												textDecoration: "line-through",
											}}
										>
											{reviewWorkspacePath}
										</span>
									) : reviewWorkspaceSnapshot ? (
										<>
											<span style={{ color: SESSION_ACTIVITY_COLOR.secondary }}>{reviewWorkspacePath}</span>
											<GitBranch
												size={10}
												style={{
													display: "inline",
													color: SESSION_ACTIVITY_COLOR.secondary,
													margin: "0px 4px 2px",
													verticalAlign: "middle",
												}}
											/>
											<span style={{ color: SESSION_ACTIVITY_COLOR.secondary }}>{reviewRefLabel}</span>
											{reviewChangeSummary ? (
												<>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}> (</span>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>
														{reviewChangeSummary.filesLabel}
													</span>
													<span className="text-status-green"> +{reviewChangeSummary.additions}</span>
													<span className="text-status-red"> -{reviewChangeSummary.deletions}</span>
													<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>)</span>
												</>
											) : null}
										</>
									) : null}
								</p>
							) : null}
							{showReviewGitActions ? (
								<div className="flex gap-1.5 mt-1.5">
									<Button
										variant="primary"
										size="sm"
										icon={isCommitLoading ? <Spinner size={12} /> : undefined}
										disabled={isAnyGitActionLoading}
										style={{ flex: "1 1 0" }}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onCommit?.(card.id);
										}}
									>
										Commit
									</Button>
									<Button
										variant="primary"
										size="sm"
										icon={isOpenPrLoading ? <Spinner size={12} /> : undefined}
										disabled={isAnyGitActionLoading}
										style={{ flex: "1 1 0" }}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onOpenPr?.(card.id);
										}}
									>
										Open PR
									</Button>
								</div>
							) : null}
							{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
								<Button
									size="sm"
									fill
									style={{ marginTop: 12 }}
									onMouseDown={stopEvent}
									onClick={(event) => {
										stopEvent(event);
										onCancelAutomaticAction(card.id);
									}}
								>
									{cancelAutomaticActionLabel}
								</Button>
							) : null}
						</div>
					</div>
				);

				if (isDragging && typeof document !== "undefined") {
					return createPortal(draggableContent, document.body);
				}
				return draggableContent;
			}}
		</Draggable>
	);
}
