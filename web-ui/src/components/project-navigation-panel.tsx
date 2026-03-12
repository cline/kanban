import { Alert, AnchorButton, Button, Classes, CompoundTag, Icon, Intent } from "@blueprintjs/core";
import { useState } from "react";

import { panelSeparatorColor } from "@/data/column-colors";
import type { RuntimeProjectSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

const GITHUB_URL = "https://github.com/cline/kanban";

interface TaskCountBadge {
	id: string;
	title: string;
	shortLabel: string;
	intent?: Intent;
	count: number;
}

export function ProjectNavigationPanel({
	projects,
	isLoadingProjects = false,
	currentProjectId,
	removingProjectId,
	onSelectProject,
	onRemoveProject,
	onAddProject,
}: {
	projects: RuntimeProjectSummary[];
	isLoadingProjects?: boolean;
	currentProjectId: string | null;
	removingProjectId: string | null;
	onSelectProject: (projectId: string) => void;
	onRemoveProject: (projectId: string) => Promise<boolean>;
	onAddProject: () => void;
}): React.ReactElement {
	const sortedProjects = [...projects].sort((a, b) => a.path.localeCompare(b.path));
	const [pendingProjectRemoval, setPendingProjectRemoval] = useState<RuntimeProjectSummary | null>(null);
	const isProjectRemovalPending = pendingProjectRemoval !== null && removingProjectId === pendingProjectRemoval.id;
	const pendingProjectTaskCount = pendingProjectRemoval
		? pendingProjectRemoval.taskCounts.backlog +
			pendingProjectRemoval.taskCounts.in_progress +
			pendingProjectRemoval.taskCounts.review +
			pendingProjectRemoval.taskCounts.trash
		: 0;

	return (
		<aside
			style={{
				display: "flex",
				flexDirection: "column",
				width: "20%",
				minHeight: 0,
				overflow: "hidden",
				borderRight: `1px solid ${panelSeparatorColor}`,
				background: "var(--kb-surface-nav)",
			}}
		>
			{/* App identity header — height matches TopBar via --kb-column-header-height */}
			<div
				style={{
					height: "var(--kb-column-header-height)",
					minHeight: "var(--kb-column-header-height)",
					display: "flex",
					alignItems: "center",
					padding: "0 12px",
					borderBottom: "1px solid var(--kb-border-subtle)",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
					<Icon icon="alignment-top" size={16} color="var(--kb-accent-blue)" />
					<div style={{ minWidth: 0, flex: "1 1 0" }}>
						<div
							style={{
								fontFamily: "var(--kb-font-mono)",
								fontWeight: 700,
								fontSize: "var(--bp-typography-size-body-medium)",
								letterSpacing: "0.06em",
								color: "var(--kb-text-primary)",
								textTransform: "uppercase",
							}}
						>
							kanban
						</div>
						<div
							style={{
								fontFamily: "var(--kb-font-mono)",
								fontSize: "var(--kb-font-size-label)",
								letterSpacing: "0.08em",
								color: "var(--kb-text-label)",
								marginTop: 1,
							}}
						>
							v{__APP_VERSION__}{" "}
							<AnchorButton
								href={GITHUB_URL}
								target="_blank"
								rel="noopener noreferrer"
								variant="minimal"
								intent="primary"
								size="small"
								style={{ padding: 0, minHeight: 0, fontSize: "var(--kb-font-size-label)", letterSpacing: "0.06em" }}
							>
								View on GitHub
							</AnchorButton>
						</div>
					</div>
				</div>
			</div>

			{/* Navigation section header */}
			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px 4px" }}>
				<span className="kb-nav-section-header">
					Projects
				</span>
				<Button
					icon="plus"
					size="small"
					variant="minimal"
					onClick={onAddProject}
					aria-label="Add project"
					disabled={removingProjectId !== null}
				/>
			</div>

			<div
				style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "4px 0" }}
			>
				{sortedProjects.length === 0 ? (
					isLoadingProjects ? (
						<div style={{ padding: "4px 0" }}>
							{Array.from({ length: 3 }).map((_, index) => (
								<ProjectRowSkeleton key={`project-skeleton-${index}`} />
							))}
						</div>
					) : (
						<div style={{ padding: "24px 12px", textAlign: "center" }}>
							<span className={Classes.TEXT_MUTED}>No projects yet</span>
						</div>
					)
				) : null}

				{sortedProjects.map((project) => (
					<ProjectRow
						key={project.id}
						project={project}
						isCurrent={currentProjectId === project.id}
						removingProjectId={removingProjectId}
						onSelect={onSelectProject}
						onRemove={(projectId) => {
							const found = sortedProjects.find((item) => item.id === projectId);
							if (!found) {
								return;
							}
							setPendingProjectRemoval(found);
						}}
					/>
				))}
			</div>
			<Alert
				isOpen={pendingProjectRemoval !== null}
				icon="warning-sign"
				intent="danger"
				confirmButtonText={isProjectRemovalPending ? "Deleting..." : "Delete Project"}
				cancelButtonText="Cancel"
				loading={isProjectRemovalPending}
				onCancel={() => {
					if (isProjectRemovalPending) {
						return;
					}
					setPendingProjectRemoval(null);
				}}
				onConfirm={async () => {
					if (!pendingProjectRemoval) {
						return;
					}
					const removed = await onRemoveProject(pendingProjectRemoval.id);
					if (removed) {
						setPendingProjectRemoval(null);
					}
				}}
				canEscapeKeyCancel={!isProjectRemovalPending}
				canOutsideClickCancel={!isProjectRemovalPending}
			>
				<h4 className={Classes.HEADING}>Delete project permanently?</h4>
				<p className={Classes.TEXT_MUTED} style={{ marginBottom: 8 }}>
					{pendingProjectRemoval ? pendingProjectRemoval.name : "This project"}
				</p>
				<p>
					This will delete all project tasks ({pendingProjectTaskCount}), remove task workspaces/worktrees, and
					stop any running processes for this project.
				</p>
				<p>This action cannot be undone.</p>
			</Alert>
		</aside>
	);
}

function ProjectRowSkeleton(): React.ReactElement {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 8px 6px 12px",
				borderLeft: "2px solid transparent",
			}}
		>
			<div style={{ flex: "1 1 0", minWidth: 0 }}>
				<div
					className={Classes.SKELETON}
					style={{
						height: "var(--bp-typography-size-body-medium)",
						width: "58%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				>
					.
				</div>
				<div
					className={`${Classes.SKELETON} ${Classes.MONOSPACE_TEXT}`}
					style={{
						height: "var(--bp-typography-size-body-x-small)",
						width: "86%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				>
					.
				</div>
				<div style={{ display: "flex", gap: 4 }}>
					<div className={Classes.SKELETON} style={{ height: 18, width: 30, borderRadius: 999 }}>
						.
					</div>
					<div className={Classes.SKELETON} style={{ height: 18, width: 30, borderRadius: 999 }}>
						.
					</div>
					<div className={Classes.SKELETON} style={{ height: 18, width: 30, borderRadius: 999 }}>
						.
					</div>
				</div>
			</div>
		</div>
	);
}

function ProjectRow({
	project,
	isCurrent,
	removingProjectId,
	onSelect,
	onRemove,
}: {
	project: RuntimeProjectSummary;
	isCurrent: boolean;
	removingProjectId: string | null;
	onSelect: (id: string) => void;
	onRemove: (id: string) => void;
}): React.ReactElement {
	const displayPath = formatPathForDisplay(project.path);
	const isRemovingProject = removingProjectId === project.id;
	const hasAnyProjectRemoval = removingProjectId !== null;
	const taskCountBadges: TaskCountBadge[] = [
		{
			id: "backlog",
			title: "Backlog",
			shortLabel: "B",
			intent: undefined,
			count: project.taskCounts.backlog,
		},
		{
			id: "in_progress",
			title: "In Progress",
			shortLabel: "IP",
			intent: Intent.PRIMARY,
			count: project.taskCounts.in_progress,
		},
		{
			id: "review",
			title: "Review",
			shortLabel: "R",
			intent: Intent.SUCCESS,
			count: project.taskCounts.review,
		},
		{
			id: "trash",
			title: "Trash",
			shortLabel: "T",
			intent: Intent.DANGER,
			count: project.taskCounts.trash,
		},
	].filter((item) => item.count > 0);

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onSelect(project.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect(project.id);
				}
			}}
			className={`kb-project-row${isCurrent ? " kb-project-row-selected" : ""}`}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "10px 8px 10px 12px",
				cursor: "pointer",
				borderLeft: isCurrent ? "2px solid var(--bp-intent-primary-rest)" : "2px solid transparent",
			}}
		>
			<div style={{ flex: "1 1 0", minWidth: 0 }}>
				<div
					style={{
						fontWeight: 500,
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
						fontSize: "var(--bp-typography-size-body-medium)",
					}}
				>
					{project.name}
				</div>
				<div
					className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`}
					style={{
						fontSize: "var(--bp-typography-size-body-x-small)",
						whiteSpace: "nowrap",
						overflow: "hidden",
						textOverflow: "ellipsis",
					}}
				>
					{displayPath}
				</div>
				{taskCountBadges.length > 0 && !isCurrent ? (
					<div style={{ display: "flex", gap: 4, marginTop: 4 }}>
						{taskCountBadges.map((badge) => (
							<CompoundTag
								key={badge.id}
								leftContent={badge.shortLabel}
								intent={badge.intent}
								minimal
								round
								interactive={false}
								className="kb-project-count-tag"
								title={badge.title}
							>
								{badge.count}
							</CompoundTag>
						))}
					</div>
				) : null}
			</div>
			<div className="kb-project-row-actions" style={{ display: "flex", alignItems: "center" }}>
				<Button
					icon="trash"
					size="small"
					variant="minimal"
					loading={isRemovingProject}
					disabled={hasAnyProjectRemoval && !isRemovingProject}
					onClick={(e) => {
						e.stopPropagation();
						onRemove(project.id);
					}}
					aria-label="Remove project"
				/>
			</div>
		</div>
	);
}
