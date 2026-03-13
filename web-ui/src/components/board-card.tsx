import { Button, Card, Classes, Colors, Elevation, Icon, Spinner, Tag, Tooltip } from "@blueprintjs/core";
import { Draggable } from "@hello-pangea/dnd";
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

/** Accent color for the first command word — teal in review, blue everywhere else */
function cmdWordColor(columnId: string): string {
	return columnId === "review" ? "var(--kb-accent-teal)" : "var(--kb-accent-blue)";
}

/** Extract @mention tokens from a task prompt */
function extractMentionTags(prompt: string): string[] {
	const matches = prompt.match(/@\w+/g);
	return matches ? [...new Set(matches)].slice(0, 3) : [];
}

interface CardSessionActivity {
	dotColor: string;
	text: string;
	status?: "executing" | "stable" | "waiting" | "failed";
}

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
		return { dotColor: Colors.GREEN4, text: finalMessage, status: "stable" };
	}
	if (activityText) {
		let dotColor = Colors.BLUE4;
		let text = activityText;
		let status: CardSessionActivity["status"] = "executing";
		if (text.startsWith("Final: ")) {
			dotColor = Colors.GREEN4;
			text = text.slice(7);
			status = "stable";
		} else if (text.startsWith("Waiting for approval")) {
			dotColor = Colors.GOLD4;
			status = "waiting";
		} else if (text.startsWith("Waiting for review")) {
			dotColor = Colors.GREEN4;
			status = "stable";
		} else if (text.startsWith("Failed ")) {
			dotColor = Colors.RED4;
			status = "failed";
		} else if (text === "Agent active" || text === "Working on task" || text.startsWith("Resumed")) {
			return { dotColor: Colors.BLUE4, text: "Thinking...", status: "executing" };
		}
		if (toolName && (text.startsWith("Using ") || text.startsWith("Completed ") || text.startsWith("Failed "))) {
			text = formatToolLabel(toolName, activityText);
		}
		return { dotColor, text, status };
	}
	if (summary.state === "awaiting_review") {
		return { dotColor: Colors.GREEN4, text: "Waiting for review", status: "stable" };
	}
	if (summary.state === "running") {
		return { dotColor: Colors.BLUE4, text: "Thinking...", status: "executing" };
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
			return { title: fallbackTitle, description: "" };
		}
		if (titleRect.width <= 0) {
			return { title: fallbackTitle, description: "" };
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
			return <Spinner size={10} />;
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
	const cancelAutomaticActionLabel = !isTrashCard && card.autoReviewEnabled
		? getTaskAutoReviewCancelButtonLabel(card.autoReviewMode)
		: null;
	const mentionTags = useMemo(() => extractMentionTags(card.prompt), [card.prompt]);

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={false}>
			{(provided, snapshot) => {
				const isDragging = snapshot.isDragging;
				const cardElevation = isDragging
					? Elevation.THREE
					: isHovered && isCardInteractive
						? Elevation.ONE
						: Elevation.ZERO;
				const draggableContent = (
					<div
						ref={provided.innerRef}
						{...provided.draggableProps}
						{...provided.dragHandleProps}
						className="kb-board-card-shell"
						data-task-id={card.id}
						data-column-id={columnId}
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
							marginBottom: 8,
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
						<Card
							elevation={cardElevation}
							interactive={isCardInteractive}
							selected={selected}
							compact
							className={`${isDependencySource ? "kb-board-card-dependency-source" : ""} ${isDependencyTarget ? "kb-board-card-dependency-target" : ""}`.trim()}
							style={{ padding: "8px 10px" }}
						>
							{/* Card action header */}
							<div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", marginBottom: 4 }}>
								<div style={{ display: "flex", alignItems: "center", gap: 4 }}>
									{columnId === "backlog" ? (
										<Button
											icon="play"
											intent="primary"
											variant="minimal"
											size="small"
											aria-label="Start task"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onStart?.(card.id);
											}}
										/>
									) : columnId === "review" ? (
										<Button
											icon={<Icon icon="trash" size={13} />}
											intent="primary"
											variant="minimal"
											size="small"
											aria-label="Move task to trash"
											onMouseDown={stopEvent}
											onClick={(event) => {
												stopEvent(event);
												onMoveToTrash?.(card.id);
											}}
										/>
									) : columnId === "trash" ? (
										<Tooltip
											placement="bottom"
											content={
												<>
													Restore session
													<br />
													in new worktree
												</>
											}
										>
											<Button
												icon={<Icon icon="reset" size={12} />}
												variant="minimal"
												size="small"
												aria-label="Restore task from trash"
												onMouseDown={stopEvent}
												onClick={(event) => {
													stopEvent(event);
													onRestoreFromTrash?.(card.id);
												}}
											/>
										</Tooltip>
									) : null}
									{/* Context menu indicator — decorative */}
									<Icon
										icon="more"
										size={12}
										color="var(--kb-text-meta)"
										style={{ cursor: "default", flexShrink: 0 }}
									/>
								</div>
							</div>

							{/* Title row */}
							<div style={{ display: "flex", alignItems: "flex-start", gap: 6, minHeight: 20 }}>
								{statusMarker ? (
									<div style={{ display: "inline-flex", alignItems: "center", marginTop: 2, flexShrink: 0 }}>{statusMarker}</div>
								) : null}
								<div ref={titleContainerRef} style={{ flex: "1 1 auto", minWidth: 0 }}>
									<p
										ref={titleRef}
										className="kb-line-clamp-1 kb-card-title"
										style={{
											margin: 0,
											color: isTrashCard
												? "rgba(100, 120, 145, 0.55)"
												: "var(--kb-text-primary)",
											textDecoration: isTrashCard ? "line-through" : undefined,
										}}
									>
										{isTrashCard ? (
											displayPromptSplit.title
										) : (() => {
											const words = displayPromptSplit.title.split(/\s+/);
											const cmdWord = words[0] ?? "";
											const rest = words.length > 1 ? ` ${words.slice(1).join(" ")}` : "";
											return (
												<>
													<span style={{ color: cmdWordColor(columnId) }}>{cmdWord}</span>
													{rest}
												</>
											);
										})()}
									</p>
								</div>
							</div>

							{/* Description */}
							{displayPromptSplit.description ? (
								<p
									style={{
										margin: "5px 0 0",
										fontFamily: "var(--kb-font-mono)",
										fontSize: "var(--bp-typography-size-body-small)",
										lineHeight: 1.45,
										display: "-webkit-box",
										WebkitLineClamp: 3,
										WebkitBoxOrient: "vertical",
										overflow: "hidden",
										color: isTrashCard
											? "rgba(80, 100, 120, 0.45)"
											: "rgba(140, 170, 200, 0.65)",
									}}
								>
									{displayPromptSplit.description}
								</p>
							) : null}

							{/* Session activity row */}
							{sessionActivity ? (
								<div
									style={{
										display: "flex",
										gap: 6,
										alignItems: "flex-start",
										marginTop: 6,
									}}
								>
									<span
										style={{
											display: "inline-block",
											width: 6,
											height: 6,
											borderRadius: "50%",
											backgroundColor: isTrashCard ? "rgba(80,100,120,0.4)" : sessionActivity.dotColor,
											flexShrink: 0,
											marginTop: 5,
										}}
									/>
									<span
										className={Classes.MONOSPACE_TEXT}
										style={{
											fontSize: "var(--bp-typography-size-body-small)",
											whiteSpace: "normal",
											overflowWrap: "anywhere",
											color: isTrashCard
												? "rgba(80, 100, 120, 0.45)"
												: "rgba(140, 175, 215, 0.70)",
										}}
									>
										{sessionActivity.text}
									</span>
								</div>
							) : null}

							{/* Workspace status (branch / file changes) */}
							{showWorkspaceStatus && reviewWorkspaceSnapshot ? (
								<p
									className={Classes.MONOSPACE_TEXT}
									style={{
										margin: "6px 0 0",
										fontSize: "var(--bp-typography-size-body-small)",
										lineHeight: 1.4,
										whiteSpace: "normal",
										overflowWrap: "anywhere",
										color: isTrashCard ? "rgba(80,100,120,0.45)" : undefined,
									}}
								>
									{isTrashCard ? (
										<span
											style={{
												color: "rgba(80, 100, 120, 0.45)",
												textDecoration: "line-through",
											}}
										>
											{reviewWorkspacePath}
										</span>
									) : (
										<>
											<span style={{ color: Colors.GRAY4 }}>{reviewWorkspacePath}</span>
											<Icon
												icon="git-branch"
												size={10}
												color={Colors.GRAY4}
												style={{ margin: "0px 4px 2px" }}
											/>
											<span style={{ color: Colors.GRAY4 }}>{reviewRefLabel}</span>
											{reviewChangeSummary ? (
												<>
													<span style={{ color: Colors.GRAY3 }}> (</span>
													<span style={{ color: Colors.GRAY3 }}>{reviewChangeSummary.filesLabel}</span>
													<span style={{ color: Colors.GREEN4 }}> +{reviewChangeSummary.additions}</span>
													<span style={{ color: Colors.RED4 }}> -{reviewChangeSummary.deletions}</span>
													<span style={{ color: Colors.GRAY3 }}>)</span>
												</>
											) : null}
										</>
									)}
								</p>
							) : null}

							{/* @mention tag chips */}
							{mentionTags.length > 0 && !isTrashCard ? (
								<div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
									{mentionTags.map((tag) => (
										<Tag
											key={tag}
											minimal
											round
											style={{
												fontSize: "var(--kb-font-size-label)",
												fontFamily: "var(--kb-font-mono)",
												letterSpacing: "0.06em",
												backgroundColor: "rgba(59, 141, 241, 0.08)",
												border: "1px solid rgba(59, 141, 241, 0.25)",
												color: "var(--kb-accent-blue)",
												padding: "1px 6px",
											}}
										>
											{tag}
										</Tag>
									))}
								</div>
							) : null}

							{/* Review git action buttons */}
							{showReviewGitActions ? (
								<div style={{ display: "flex", gap: 6, marginTop: 8 }}>
									<Button
										text="Commit"
										size="small"
										variant="solid"
										intent="primary"
										style={{ flex: "1 1 0" }}
										loading={isCommitLoading}
										disabled={isAnyGitActionLoading}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onCommit?.(card.id);
										}}
									/>
									<Button
										text="Open PR"
										size="small"
										variant="solid"
										intent="primary"
										style={{ flex: "1 1 0" }}
										loading={isOpenPrLoading}
										disabled={isAnyGitActionLoading}
										onMouseDown={stopEvent}
										onClick={(event) => {
											stopEvent(event);
											onOpenPr?.(card.id);
										}}
									/>
								</div>
							) : null}
							{cancelAutomaticActionLabel && onCancelAutomaticAction ? (
								<Button
									text={cancelAutomaticActionLabel}
									size="small"
									variant="outlined"
									fill
									style={{ marginTop: 12 }}
									onMouseDown={stopEvent}
									onClick={(event) => {
										stopEvent(event);
										onCancelAutomaticAction(card.id);
									}}
								/>
							) : null}
						</Card>
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
