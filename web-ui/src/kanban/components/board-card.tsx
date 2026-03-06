import { Button, Card, Classes, Colors, Elevation, Icon, Spinner } from "@blueprintjs/core";
import { Draggable } from "@hello-pangea/dnd";
import type { MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useMeasure } from "@/kanban/hooks/react-use";
import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type {
	BoardCard as BoardCardModel,
	BoardColumnId,
	ReviewTaskWorkspaceSnapshot,
} from "@/kanban/types";
import { formatPathForDisplay } from "@/kanban/utils/path-display";
import { splitPromptToTitleDescriptionByWidth, truncateTaskPromptLabel } from "@/kanban/utils/task-prompt";
import {
	DEFAULT_TEXT_MEASURE_FONT,
	measureTextWidth,
	readElementFontShorthand,
} from "@/kanban/utils/text-measure";

export function BoardCard({
	card,
	index,
	columnId,
	sessionSummary,
	selected = false,
	onClick,
	onStart,
	onMoveToTrash,
	reviewWorkspaceSnapshot,
	onCommit,
	onOpenPr,
	isCommitLoading = false,
	isOpenPrLoading = false,
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
	reviewWorkspaceSnapshot?: ReviewTaskWorkspaceSnapshot;
	onCommit?: (taskId: string) => void;
	onOpenPr?: (taskId: string) => void;
	isCommitLoading?: boolean;
	isOpenPrLoading?: boolean;
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
	const showPreview = columnId === "in_progress" || columnId === "review";
	const isTrashCard = columnId === "trash";
	const isCardDraggable = !isTrashCard;
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
	const showWorkspaceStatus = columnId === "in_progress" || columnId === "review";
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
	const showReviewGitActions =
		columnId === "review" &&
		(reviewWorkspaceSnapshot?.changedFiles ?? 0) > 0;
	const isAnyGitActionLoading = isCommitLoading || isOpenPrLoading;

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={!isCardDraggable}>
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
							if (
								target?.closest(
									"button, a, input, textarea, [contenteditable='true']",
								)
							) {
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
							cursor: isCardDraggable ? "grab" : "default",
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
						>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								{statusMarker ? (
									<div style={{ display: "inline-flex", alignItems: "center" }}>
										{statusMarker}
									</div>
								) : null}
								<div ref={titleContainerRef} style={{ flex: "1 1 auto", minWidth: 0 }}>
									<p
										ref={titleRef}
										className="kb-line-clamp-1"
										style={{
											margin: 0,
											fontWeight: 500,
											color: isTrashCard ? Colors.GRAY3 : undefined,
											textDecoration: isTrashCard ? "line-through" : undefined,
										}}
									>
										{displayPromptSplit.title}
									</p>
								</div>
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
								) : null}
							</div>
							{displayPromptSplit.description ? (
								<p
									className={`${isTrashCard ? "" : Classes.TEXT_MUTED} kb-line-clamp-5`}
									style={{
										margin: "4px 0 0",
										fontSize: "var(--bp-typography-size-body-small)",
										lineHeight: 1.4,
										color: isTrashCard ? Colors.GRAY1 : undefined,
									}}
								>
									{displayPromptSplit.description}
								</p>
							) : null}
							{showPreview && sessionSummary?.activityPreview ? (
								<div className="kb-task-preview-pane">
									<p className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT} kb-line-clamp-5 kb-task-preview-text`}>
										{sessionSummary.activityPreview}
									</p>
								</div>
							) : null}
								{showWorkspaceStatus && reviewWorkspaceSnapshot ? (
									<p
										className={Classes.MONOSPACE_TEXT}
										style={{
											margin: "6px 0 0",
											fontSize: "var(--bp-typography-size-body-small)",
											lineHeight: 1.4,
											whiteSpace: "normal",
											overflowWrap: "anywhere",
										}}
										>
											<>
												<span style={{ color: Colors.GRAY4 }}>{reviewWorkspacePath}</span>
												<Icon icon="git-branch" size={10} color={Colors.GRAY4} style={{ margin: "0px 4px 2px" }} />
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
									</p>
								) : null}
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
