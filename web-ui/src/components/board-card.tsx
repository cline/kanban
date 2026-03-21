import { Draggable } from "@hello-pangea/dnd";
import { buildTaskWorktreeDisplayPath } from "@runtime-task-worktree-path";
import { GitBranch, Play, RotateCcw, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatClineToolCallLabel } from "@runtime-cline-tool-call-display";
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
	splitPromptToTitleDescriptionByWidth,
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
	muted: "var(--color-text-tertiary)",
	secondary: "var(--color-text-secondary)",
} as const;

const DESCRIPTION_COLLAPSE_LINES = 3;
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

function getCardSessionActivity(summary: RuntimeTaskSessionSummary | undefined): CardSessionActivity | null {
	if (!summary) {
		return null;
	}
	const hookActivity = summary.latestHookActivity;
	const activityText = hookActivity?.activityText?.trim();
	const toolName = hookActivity?.toolName?.trim() ?? null;
	const toolInputSummary = hookActivity?.toolInputSummary?.trim() ?? null;
	const source = hookActivity?.source?.trim() ?? null;
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
		let dotColor: string = SESSION_ACTIVITY_COLOR.thinking;
		let text = activityText;
		if (source === "cline-sdk" && toolName) {
			if (text.startsWith("Failed ")) {
				dotColor = SESSION_ACTIVITY_COLOR.error;
			}
			return {
				dotColor,
				text: formatClineToolCallLabel(toolName, toolInputSummary),
			};
		}
		if (text.startsWith("Final: ")) {
			dotColor = SESSION_ACTIVITY_COLOR.success;
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
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const [titleContainerRef, titleRect] = useMeasure<HTMLDivElement>();
	const [descriptionContainerRef, descriptionRect] = useMeasure<HTMLDivElement>();
	const titleRef = useRef<HTMLParagraphElement | null>(null);
	const descriptionRef = useRef<HTMLParagraphElement | null>(null);
	const [titleWidthFallback, setTitleWidthFallback] = useState(0);
	const [descriptionWidthFallback, setDescriptionWidthFallback] = useState(0);
	const [titleFont, setTitleFont] = useState(DEFAULT_TEXT_MEASURE_FONT);
	const [descriptionFont, setDescriptionFont] = useState(DEFAULT_TEXT_MEASURE_FONT);
	const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(card.id);
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;
	const titleWidth = titleRect.width > 0 ? titleRect.width : titleWidthFallback;
	const descriptionWidth = descriptionRect.width > 0 ? descriptionRect.width : descriptionWidthFallback;
	const displayPrompt = useMemo(() => {
		return card.prompt.trim();
	}, [card.prompt]);
	const displayPromptSplit = useMemo(() => {
		const fallbackTitle = truncateTaskPromptLabel(card.prompt);
		if (!displayPrompt) {
			return {
				title: fallbackTitle,
				description: "",
			};
		}
		if (titleWidth <= 0) {
			return {
				title: fallbackTitle,
				description: "",
			};
		}
		const split = splitPromptToTitleDescriptionByWidth(displayPrompt, {
			maxTitleWidthPx: titleWidth,
			measureText: (value) => measureTextWidth(value, titleFont),
		});
		return {
			title: split.title || fallbackTitle,
			description: split.description,
		};
	}, [card.prompt, displayPrompt, titleFont, titleWidth]);

	useLayoutEffect(() => {
		if (titleRect.width > 0) {
			return;
		}
		const nextWidth = titleRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
		if (nextWidth > 0 && nextWidth !== titleWidthFallback) {
			setTitleWidthFallback(nextWidth);
		}
	}, [titleRect.width, titleWidthFallback]);

	useLayoutEffect(() => {
		if (descriptionRect.width > 0 || !displayPromptSplit.description) {
			return;
		}
		const nextWidth = descriptionRef.current?.parentElement?.getBoundingClientRect().width ?? 0;
		if (nextWidth > 0 && nextWidth !== descriptionWidthFallback) {
			setDescriptionWidthFallback(nextWidth);
		}
	}, [descriptionRect.width, descriptionWidthFallback, displayPromptSplit.description]);

	useLayoutEffect(() => {
		setTitleFont(readElementFontShorthand(titleRef.current, DEFAULT_TEXT_MEASURE_FONT));
	}, [titleWidth]);

	useLayoutEffect(() => {
		setDescriptionFont(readElementFontShorthand(descriptionRef.current, DEFAULT_TEXT_MEASURE_FONT));
	}, [descriptionWidth, displayPromptSplit.description]);

	useEffect(() => {
		setIsDescriptionExpanded(false);
	}, [card.id, displayPromptSplit.description]);

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const isDescriptionMeasured = descriptionRect.width > 0;

	const descriptionDisplay = useMemo(() => {
		if (!displayPromptSplit.description) {
			return {
				text: "",
				isTruncated: false,
			};
		}
		if (descriptionWidth <= 0) {
			return {
				text: displayPromptSplit.description,
				isTruncated: false,
			};
		}
		return clampTextWithInlineSuffix(displayPromptSplit.description, {
			maxWidthPx: descriptionWidth,
			maxLines: DESCRIPTION_COLLAPSE_LINES,
			suffix: DESCRIPTION_COLLAPSE_SUFFIX,
			measureText: (value) => measureTextWidth(value, descriptionFont),
		});
	}, [descriptionFont, descriptionWidth, displayPromptSplit.description]);

	const renderStatusMarker = () => {
		if (columnId === "in_progress") {
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
	const sessionActivity = useMemo(() => getCardSessionActivity(sessionSummary), [sessionSummary]);
	const cancelAutomaticActionLabel =
		!isTrashCard && card.autoReviewEnabled ? getTaskAutoReviewCancelButtonLabel(card.autoReviewMode) : null;

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
								<div ref={titleContainerRef} className="flex-1 min-w-0">
									<p
										ref={titleRef}
										className={cn(
											"kb-line-clamp-1 m-0 font-medium text-sm",
											isTrashCard && "line-through text-text-tertiary",
										)}
									>
										{displayPromptSplit.title}
									</p>
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
							{displayPromptSplit.description ? (
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
											? displayPromptSplit.description
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
									<span
										className="font-mono line-clamp-6"
										style={{
											fontSize: 12,
											whiteSpace: "normal",
											overflowWrap: "anywhere",
										}}
									>
										{sessionActivity.text}
									</span>
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
