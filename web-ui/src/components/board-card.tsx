import { Draggable } from "@hello-pangea/dnd";
import { GitBranch, Play, RotateCcw, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { useTaskWorkspaceSnapshotValue } from "@/stores/workspace-metadata-store";
import type { BoardCard as BoardCardModel, BoardColumnId } from "@/types";
import { getTaskAutoReviewCancelButtonLabel } from "@/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { useMeasure } from "@/utils/react-use";
import { splitPromptToTitleDescriptionByWidth, truncateTaskPromptLabel } from "@/utils/task-prompt";
import { DEFAULT_TEXT_MEASURE_FONT, measureTextWidth, readElementFontShorthand } from "@/utils/text-measure";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/components/ui/cn";

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

function formatToolLabel(toolName: string, activityText: string): string {
	const marker = `${toolName}: `;
	const markerIndex = activityText.indexOf(marker);
	if (markerIndex >= 0) {
		const detail = activityText.slice(markerIndex + marker.length);
		return `${toolName}(${detail})`;
	}
	return toolName;
}

function getCardSessionActivity(summary: RuntimeTaskSessionSummary | undefined): CardSessionActivity | null {
	if (!summary) {
		return null;
	}
	const hookActivity = summary.latestHookActivity;
	const activityText = hookActivity?.activityText?.trim();
	const toolName = hookActivity?.toolName?.trim() ?? null;
	const finalMessage = hookActivity?.finalMessage?.trim();
	if (summary.state === "awaiting_review" && finalMessage) {
		return { dotColor: SESSION_ACTIVITY_COLOR.success, text: finalMessage };
	}
	if (activityText) {
		let dotColor: string = SESSION_ACTIVITY_COLOR.thinking;
		let text = activityText;
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
		if (toolName && (text.startsWith("Using ") || text.startsWith("Completed ") || text.startsWith("Failed "))) {
			text = formatToolLabel(toolName, activityText);
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
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const [titleContainerRef, titleRect] = useMeasure<HTMLDivElement>();
	const titleRef = useRef<HTMLParagraphElement | null>(null);
	const [titleFont, setTitleFont] = useState(DEFAULT_TEXT_MEASURE_FONT);
	const reviewWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(card.id);
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;
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
		if (titleRect.width <= 0) {
			return {
				title: fallbackTitle,
				description: "",
			};
		}
		const split = splitPromptToTitleDescriptionByWidth(displayPrompt, {
			maxTitleWidthPx: titleRect.width,
			measureText: (value) => measureTextWidth(value, titleFont),
		});
		return {
			title: split.title || fallbackTitle,
			description: split.description,
		};
	}, [card.prompt, displayPrompt, titleFont, titleRect.width]);

	useEffect(() => {
		setTitleFont(readElementFontShorthand(titleRef.current, DEFAULT_TEXT_MEASURE_FONT));
	}, [titleRect.width]);

	const stopEvent = (event: MouseEvent<HTMLElement>) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const renderStatusMarker = () => {
		if (columnId === "in_progress") {
			return <Spinner size={12} />;
		}
		return null;
	};
	const statusMarker = renderStatusMarker();
	const showWorkspaceStatus = columnId === "in_progress" || columnId === "review" || isTrashCard;
	const reviewWorkspacePath = reviewWorkspaceSnapshot ? formatPathForDisplay(reviewWorkspaceSnapshot.path) : null;
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
								{statusMarker ? (
									<div className="inline-flex items-center">{statusMarker}</div>
								) : null}
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
								<p
									className={cn(
										"text-sm leading-[1.4]",
										isTrashCard ? "text-text-tertiary" : "text-text-secondary",
									)}
									style={{
										margin: "4px 0 0",
										display: "-webkit-box",
										WebkitLineClamp: 3,
										WebkitBoxOrient: "vertical",
										overflow: "hidden",
									}}
								>
									{displayPromptSplit.description}
								</p>
							) : null}
							{sessionActivity ? (
								<div
									className="flex gap-1.5 items-start mt-1"
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
										className="font-mono"
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
							{showWorkspaceStatus && reviewWorkspaceSnapshot ? (
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
									) : (
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
												<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>{reviewChangeSummary.filesLabel}</span>
												<span className="text-status-green"> +{reviewChangeSummary.additions}</span>
												<span className="text-status-red"> -{reviewChangeSummary.deletions}</span>
												<span style={{ color: SESSION_ACTIVITY_COLOR.muted }}>)</span>
												</>
											) : null}
										</>
									)}
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
