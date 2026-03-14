import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown, ChevronUp, Heart, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Kbd } from "@/components/ui/kbd";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeProjectSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

const GITHUB_URL = "https://github.com/cline/kanban";

interface TaskCountBadge {
	id: string;
	title: string;
	shortLabel: string;
	toneClassName: string;
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
			className="flex flex-col min-h-0 overflow-hidden bg-surface-1"
			style={{
				width: "20%",
				borderRight: "1px solid var(--color-divider)",
			}}
		>
			<div style={{ padding: "12px 12px 8px" }}>
				<div>
					<div className="font-semibold text-base">
						kanban{" "}
						<span className="text-text-secondary font-normal text-xs">
							v{__APP_VERSION__}
						</span>
					</div>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="text-accent-hover text-xs hover:underline"
					>
						View on GitHub
					</a>
				</div>
			</div>

			<div className="flex items-center justify-between" style={{ padding: "4px 12px" }}>
				<span className="text-text-tertiary text-xs font-medium uppercase tracking-wide">
					Projects
				</span>
				<Button
					variant="ghost"
					size="sm"
					icon={<Plus size={14} />}
					onClick={onAddProject}
					aria-label="Add project"
					disabled={removingProjectId !== null}
				/>
			</div>

			<div
				className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1"
				style={{ padding: "4px 0" }}
			>
				{sortedProjects.length === 0 ? (
					isLoadingProjects ? (
						<div style={{ padding: "4px 0" }}>
							{Array.from({ length: 3 }).map((_, index) => (
								<ProjectRowSkeleton key={`project-skeleton-${index}`} />
							))}
						</div>
					) : (
						<div className="text-center" style={{ padding: "24px 12px" }}>
							<span className="text-text-secondary">No projects yet</span>
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
			<ShortcutsCard />
			<a
				href="https://cline.bot"
				target="_blank"
				rel="noopener noreferrer"
				className="text-text-tertiary hover:text-text-primary text-center block transition-colors"
				style={{ padding: "6px 12px", fontSize: 10 }}
			>
				Made with <Heart size={10} fill="currentColor" className="inline-block" /> by Cline
			</a>
			<AlertDialog
				open={pendingProjectRemoval !== null}
				onOpenChange={(open) => {
					if (!open && !isProjectRemovalPending) {
						setPendingProjectRemoval(null);
					}
				}}
			>
				<AlertDialogTitle className="text-sm font-semibold text-text-primary mb-2">
					Delete project permanently?
				</AlertDialogTitle>
				<AlertDialogDescription asChild>
					<div>
						<p className="text-text-secondary mb-2">
							{pendingProjectRemoval ? pendingProjectRemoval.name : "This project"}
						</p>
						<p className="text-text-primary mb-2">
							This will delete all project tasks ({pendingProjectTaskCount}), remove task workspaces/worktrees, and
							stop any running processes for this project.
						</p>
						<p className="text-text-primary">This action cannot be undone.</p>
					</div>
				</AlertDialogDescription>
				<div className="flex justify-end gap-2 mt-4">
					<AlertDialogCancel asChild>
						<Button
							variant="default"
							disabled={isProjectRemovalPending}
							onClick={() => {
								if (!isProjectRemovalPending) {
									setPendingProjectRemoval(null);
								}
							}}
						>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							disabled={isProjectRemovalPending}
							onClick={async () => {
								if (!pendingProjectRemoval) {
									return;
								}
								const removed = await onRemoveProject(pendingProjectRemoval.id);
								if (removed) {
									setPendingProjectRemoval(null);
								}
							}}
						>
							{isProjectRemovalPending ? (
								<>
									<Spinner size={14} />
									Deleting...
								</>
							) : (
								"Delete Project"
							)}
						</Button>
					</AlertDialogAction>
				</div>
			</AlertDialog>
		</aside>
	);
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "\u2318" : "Ctrl";

const ESSENTIAL_SHORTCUTS = [
	{ keys: ["C"], label: "New task" },
	{ keys: [MOD, "\u23CE"], label: "Create task" },
	{ keys: [MOD, "Shift", "\u23CE"], label: "Create & start" },
	{ keys: [MOD, "J"], label: "Toggle terminal" },
	{ keys: [MOD], label: "Hold to link tasks" },
];

const MORE_SHORTCUTS = [
	{ keys: ["\u2191"], label: "Previous card" },
	{ keys: ["\u2193"], label: "Next card" },
	{ keys: [MOD, "M"], label: "Expand terminal" },
	{ keys: ["Esc"], label: "Cancel / back" },
	{ keys: ["\u2191"], label: "Previous commit" },
	{ keys: ["\u2193"], label: "Next commit" },
];

function ShortcutHint({ keys, label }: { keys: string[]; label: string }): React.ReactElement {
	return (
		<div className="flex justify-between items-center py-px">
			<span className="text-text-tertiary text-[11px]">{label}</span>
			<span className="inline-flex items-center gap-0.5">
				{keys.map((key, i) => (
					<Kbd key={`${key}-${i}`}>{key}</Kbd>
				))}
			</span>
		</div>
	);
}

function ShortcutsCard(): React.ReactElement {
	const [expanded, setExpanded] = useState(false);

	return (
		<div style={{ padding: "8px 12px" }}>
			<div className="rounded-md p-2.5">
				<div className="flex flex-col gap-0.5">
					{ESSENTIAL_SHORTCUTS.map((s) => (
						<ShortcutHint key={s.label} keys={s.keys} label={s.label} />
					))}
				</div>
				<Collapsible.Root open={expanded} onOpenChange={setExpanded}>
					<Collapsible.Content>
						<div className="flex flex-col gap-0.5">
							{MORE_SHORTCUTS.map((s) => (
								<ShortcutHint key={s.label} keys={s.keys} label={s.label} />
							))}
						</div>
					</Collapsible.Content>
					<Collapsible.Trigger asChild>
						<button
							type="button"
							className="flex items-center gap-1 mt-1.5 text-[10px] text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none p-0"
						>
							{expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
							{expanded ? "Less" : "All shortcuts"}
						</button>
					</Collapsible.Trigger>
				</Collapsible.Root>
			</div>
		</div>
	);
}

function ProjectRowSkeleton(): React.ReactElement {
	return (
		<div
			className="flex items-center gap-1.5 mx-2"
			style={{
				padding: "6px 8px",
			}}
		>
			<div className="flex-1 min-w-0">
				<div
					className="kb-skeleton"
					style={{
						height: 14,
						width: "58%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				/>
				<div
					className="kb-skeleton font-mono"
					style={{
						height: 10,
						width: "86%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				/>
				<div className="flex gap-1">
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
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
			toneClassName: "bg-text-primary/15 text-text-primary",
			count: project.taskCounts.backlog,
		},
		{
			id: "in_progress",
			title: "In Progress",
			shortLabel: "IP",
			toneClassName: "bg-accent/20 text-accent",
			count: project.taskCounts.in_progress,
		},
		{
			id: "review",
			title: "Review",
			shortLabel: "R",
			toneClassName: "bg-status-green/20 text-status-green",
			count: project.taskCounts.review,
		},
		{
			id: "trash",
			title: "Trash",
			shortLabel: "T",
			toneClassName: "bg-status-red/20 text-status-red",
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
			className={cn(
				"kb-project-row cursor-pointer rounded-md mx-2",
				isCurrent && "kb-project-row-selected",
			)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 8px",
			}}
		>
			<div className="flex-1 min-w-0">
				<div
					className={cn(
						"font-medium whitespace-nowrap overflow-hidden text-ellipsis text-sm",
						isCurrent ? "text-white" : "text-text-primary",
					)}
				>
					{project.name}
				</div>
				<div
					className={cn(
						"font-mono text-[10px] whitespace-nowrap overflow-hidden text-ellipsis",
						isCurrent ? "text-white/60" : "text-text-secondary",
					)}
				>
					{displayPath}
				</div>
				{taskCountBadges.length > 0 ? (
					<div className="flex gap-1 mt-1">
						{taskCountBadges.map((badge) => (
							<span
								key={badge.id}
								className={cn(
									"inline-flex items-center gap-1 rounded-full text-[10px] px-1.5 py-px font-medium",
									isCurrent ? "bg-white/20 text-white" : badge.toneClassName,
								)}
								title={badge.title}
							>
								<span>{badge.shortLabel}</span>
								<span style={{ opacity: 0.4 }}>|</span>
								<span>{badge.count}</span>
							</span>
						))}
					</div>
				) : null}
			</div>
			<div className="kb-project-row-actions flex items-center">
				<Button
					variant="ghost"
					size="sm"
					icon={isRemovingProject ? <Spinner size={12} /> : <Trash2 size={14} />}
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
