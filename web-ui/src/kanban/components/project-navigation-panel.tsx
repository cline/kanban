import { AnchorButton, Button, Classes, Colors, Icon, Tag } from "@blueprintjs/core";

import { panelSeparatorColor } from "@/kanban/data/column-colors";
import type { RuntimeProjectSummary } from "@/kanban/runtime/types";

const GITHUB_URL = "https://github.com/cline/kanbanana";

export function ProjectNavigationPanel({
	projects,
	currentProjectId,
	onSelectProject,
	onRemoveProject,
	onAddProject,
}: {
	projects: RuntimeProjectSummary[];
	currentProjectId: string | null;
	onSelectProject: (projectId: string) => void;
	onRemoveProject: (projectId: string) => void;
	onAddProject: () => void;
}): React.ReactElement {
	const sortedProjects = [...projects].sort((a, b) => a.path.localeCompare(b.path));

	return (
		<aside
			style={{
				display: "flex",
				flexDirection: "column",
				width: "20%",
				minHeight: 0,
				overflow: "hidden",
				borderRight: `1px solid ${panelSeparatorColor}`,
				background: Colors.DARK_GRAY2,
			}}
		>
			<div style={{ padding: "12px 12px 8px" }}>
				<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
					<span role="img" aria-label="banana" style={{ fontSize: 24 }}>🍌</span>
					<div>
						<div style={{ fontWeight: 600, fontSize: "var(--bp-typography-size-body-large)" }}>
							kanbanana <span className={Classes.TEXT_MUTED} style={{ fontWeight: 400, fontSize: "var(--bp-typography-size-body-small)" }}>v{__APP_VERSION__}</span>
						</div>
						<AnchorButton href={GITHUB_URL} target="_blank" rel="noopener noreferrer" variant="minimal" intent="primary" size="small" style={{ padding: 0, minHeight: 0, fontSize: "var(--bp-typography-size-body-small)" }}>
							View on GitHub
						</AnchorButton>
					</div>
				</div>
			</div>

			<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 12px" }}>
				<span className={Classes.TEXT_MUTED} style={{ fontSize: "var(--bp-typography-size-body-medium)" }}>Projects</span>
				<Button icon="plus" size="small" variant="minimal" onClick={onAddProject} aria-label="Add project" />
			</div>

			<div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: "4px 0" }}>
				{sortedProjects.length === 0 ? (
					<div style={{ padding: "24px 12px", textAlign: "center" }}>
						<span className={Classes.TEXT_MUTED}>No projects yet</span>
					</div>
				) : null}

				{sortedProjects.map((project) => (
					<ProjectRow
						key={project.id}
						project={project}
						isCurrent={currentProjectId === project.id}
						onSelect={onSelectProject}
						onRemove={onRemoveProject}
					/>
				))}
			</div>
			<div className={Classes.TEXT_MUTED} style={{ padding: "8px 12px", fontSize: "var(--bp-typography-size-body-x-small)", textAlign: "center" }}>
				Made with <Icon icon="heart" size={10} /> by Cline
			</div>
		</aside>
	);
}

function ProjectRow({
	project,
	isCurrent,
	onSelect,
	onRemove,
}: {
	project: RuntimeProjectSummary;
	isCurrent: boolean;
	onSelect: (id: string) => void;
	onRemove: (id: string) => void;
}): React.ReactElement {
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
				padding: "6px 8px 6px 12px",
				cursor: "pointer",
				borderLeft: isCurrent ? "2px solid var(--bp-intent-primary-rest)" : "2px solid transparent",
			}}
		>
			<div style={{ flex: "1 1 0", minWidth: 0 }}>
				<div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontSize: "var(--bp-typography-size-body-medium)" }}>
					{project.name}
				</div>
				<div className={`${Classes.TEXT_MUTED} ${Classes.MONOSPACE_TEXT}`} style={{ fontSize: "var(--bp-typography-size-body-x-small)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
					{project.path}
				</div>
				<div style={{ display: "flex", gap: 4, marginTop: 4 }}>
					<Tag minimal interactive={false} className="kb-project-count-tag" title="Backlog">
						B {project.taskCounts.backlog}
					</Tag>
					<Tag minimal interactive={false} className="kb-project-count-tag" title="In Progress">
						IP {project.taskCounts.in_progress}
					</Tag>
					<Tag minimal interactive={false} className="kb-project-count-tag" title="Review">
						R {project.taskCounts.review}
					</Tag>
					<Tag minimal interactive={false} className="kb-project-count-tag" title="Trash">
						T {project.taskCounts.trash}
					</Tag>
				</div>
			</div>
			<div className="kb-project-row-actions" style={{ display: "flex", alignItems: "center" }}>
				<Button
					icon="trash"
					size="small"
					variant="minimal"
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
