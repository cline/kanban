import { Button, Card, Classes, Colors, Elevation, Spinner } from "@blueprintjs/core";
import { Draggable } from "@hello-pangea/dnd";
import type { MouseEvent } from "react";
import { useState } from "react";
import { createPortal } from "react-dom";

import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type {
	BoardCard as BoardCardModel,
	BoardColumnId,
	ReviewTaskWorkspaceSnapshot,
} from "@/kanban/types";

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
}): React.ReactElement {
	const [isHovered, setIsHovered] = useState(false);
	const showPreview = columnId === "in_progress" || columnId === "review";
	const isTrashCard = columnId === "trash";
	const isCardInteractive = !isTrashCard;

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
	const reviewBranchLabel = !reviewWorkspaceSnapshot?.hasGit
		? "no git"
		: reviewWorkspaceSnapshot.isDetached
			? `detached ${reviewWorkspaceSnapshot.headCommit?.slice(0, 8) ?? "HEAD"}`
			: (reviewWorkspaceSnapshot.branch ?? "detached HEAD");
	const showWorktreeLabel = reviewWorkspaceSnapshot?.mode === "worktree";
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
		Boolean(reviewWorkspaceSnapshot?.hasGit) &&
		(reviewWorkspaceSnapshot?.changedFiles ?? 0) > 0;

	return (
		<Draggable draggableId={card.id} index={index} isDragDisabled={isTrashCard}>
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
						onClick={() => {
							if (!isCardInteractive) {
								return;
							}
							if (!snapshot.isDragging && onClick) {
								onClick();
							}
						}}
						style={{
							...provided.draggableProps.style,
							marginBottom: 8,
							cursor: isTrashCard ? "default" : "grab",
						}}
						onMouseEnter={() => setIsHovered(true)}
						onMouseLeave={() => setIsHovered(false)}
					>
						<Card
							elevation={cardElevation}
							interactive={isCardInteractive}
							selected={selected}
							compact
						>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								{statusMarker ? (
									<div style={{ display: "inline-flex", alignItems: "center" }}>
										{statusMarker}
									</div>
								) : null}
								<div style={{ flex: "1 1 auto", minWidth: 0 }}>
									<p
										className="kb-line-clamp-1"
										style={{
											margin: 0,
											fontWeight: 500,
											color: isTrashCard ? Colors.GRAY3 : undefined,
											textDecoration: isTrashCard ? "line-through" : undefined,
										}}
									>
										{card.title}
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
										icon="trash"
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
							{card.description ? (
								<p
									className={`${isTrashCard ? "" : Classes.TEXT_MUTED} kb-line-clamp-5`}
									style={{
										margin: "4px 0 0",
										fontSize: "var(--bp-typography-size-body-small)",
										lineHeight: 1.4,
										color: isTrashCard ? Colors.GRAY1 : undefined,
									}}
								>
									{card.description}
								</p>
							) : null}
							{showPreview && sessionSummary?.lastActivityLine ? (
								<div className="kb-task-preview-pane">
									<p className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT} kb-line-clamp-2 kb-task-preview-text`}>
										{sessionSummary.lastActivityLine}
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
											{showWorktreeLabel ? (
												<>
													<span style={{ color: Colors.GRAY3 }}>(worktree)</span>
													<span style={{ color: Colors.GRAY3 }}> </span>
												</>
											) : null}
											<span style={{ color: Colors.LIGHT_GRAY5 }}>{reviewBranchLabel}</span>
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
