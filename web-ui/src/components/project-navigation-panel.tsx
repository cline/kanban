import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ClineIcon } from "@/components/ui/cline-icon";
import { cn } from "@/components/ui/cn";
import { openFeaturebaseFeedbackWidget } from "@/hooks/use-featurebase-feedback-widget";
import { useUnmount, useWindowEvent } from "@/utils/react-use";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeProjectSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { isMacPlatform, modifierKeyLabel } from "@/utils/platform";

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;
const SIDEBAR_WIDTH_STORAGE_KEY = "kb-sidebar-width";

function loadSidebarWidth(): number {
	try {
		const stored = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
		if (stored) {
			const parsed = Number(stored);
			if (Number.isFinite(parsed)) {
				return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, parsed));
			}
		}
	} catch {
		// ignore
	}
	return SIDEBAR_DEFAULT_WIDTH;
}

function saveSidebarWidth(width: number): void {
	try {
		localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
	} catch {
		// ignore
	}
}

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
	activeSection,
	onActiveSectionChange,
	canShowAgentSection,
	agentSectionContent,
	onSelectProject,
	onRemoveProject,
	onAddProject,
}: {
	projects: RuntimeProjectSummary[];
	isLoadingProjects?: boolean;
	currentProjectId: string | null;
	removingProjectId: string | null;
	activeSection: "projects" | "agent";
	onActiveSectionChange: (section: "projects" | "agent") => void;
	canShowAgentSection: boolean;
	agentSectionContent?: ReactNode;
	onSelectProject: (projectId: string) => void;
	onRemoveProject: (projectId: string) => Promise<boolean>;
	onAddProject: () => void;
}): React.ReactElement {
	const sortedProjects = [...projects].sort((a, b) => a.path.localeCompare(b.path));

	// Resize state
	const [width, setWidth] = useState(loadSidebarWidth);
	const [isDragging, setIsDragging] = useState(false);
	const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		setIsDragging(false);
		const prev = previousBodyStyleRef.current;
		if (prev) {
			document.body.style.userSelect = prev.userSelect;
			document.body.style.cursor = prev.cursor;
			previousBodyStyleRef.current = null;
		}
		dragStateRef.current = null;
	}, []);

	useUnmount(() => {
		stopDrag();
	});

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!isDragging) {
				return;
			}
			const dragState = dragStateRef.current;
			if (!dragState) {
				return;
			}
			const deltaX = event.clientX - dragState.startX;
			const nextWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, dragState.startWidth + deltaX));
			setWidth(nextWidth);
			saveSidebarWidth(nextWidth);
		},
		[isDragging],
	);

	const handleMouseUp = useCallback(() => {
		if (!isDragging) {
			return;
		}
		stopDrag();
	}, [isDragging, stopDrag]);

	useWindowEvent("mousemove", isDragging ? handleMouseMove : null);
	useWindowEvent("mouseup", isDragging ? handleMouseUp : null);

	const handleResizeMouseDown = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			if (isDragging) {
				stopDrag();
			}
			dragStateRef.current = { startX: event.clientX, startWidth: width };
			setIsDragging(true);
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[width, isDragging, stopDrag],
	);

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
			className="relative flex flex-col min-h-0 overflow-hidden bg-surface-1"
			style={{
				width,
				minWidth: SIDEBAR_MIN_WIDTH,
				maxWidth: SIDEBAR_MAX_WIDTH,
				borderRight: "1px solid var(--color-divider)",
			}}
		>
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label="Resize sidebar"
				onMouseDown={handleResizeMouseDown}
				className="absolute top-0 right-0 bottom-0 z-10 w-[5px] cursor-ew-resize hover:bg-accent/30"
			/>
			<div style={{ padding: "12px 12px 8px" }}>
				<div>
					<div className="font-semibold text-base flex items-baseline gap-1.5">
						<ClineIcon size={18} className="text-text-primary shrink-0 self-center" />
						Cline <span className="text-text-secondary font-normal text-xs">v{__APP_VERSION__}</span>
					</div>
				</div>
				<div className="mt-2 rounded-md bg-surface-2 p-1">
					<div className="grid grid-cols-2 gap-1">
						<button
							type="button"
							onClick={() => onActiveSectionChange("projects")}
							className={cn(
								"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium",
								activeSection === "projects"
									? "bg-surface-4 text-text-primary"
									: "text-text-secondary hover:text-text-primary",
							)}
						>
							Projects
						</button>
						<button
							type="button"
							onClick={() => onActiveSectionChange("agent")}
							disabled={!canShowAgentSection}
							className={cn(
								"cursor-pointer rounded-sm px-2 py-1 text-xs font-medium",
								activeSection === "agent"
									? "bg-surface-4 text-text-primary"
									: "text-text-secondary hover:text-text-primary",
								!canShowAgentSection ? "cursor-not-allowed opacity-50" : null,
							)}
						>
							Kanban Agent
						</button>
					</div>
				</div>
				{activeSection === "agent" ? (
					<p className="text-text-tertiary text-xs" style={{ padding: "8px 12px 0" }}>
						Add tasks, link dependencies, break work down, and manage your board. Try asking to
						create and link some tasks to get started.
					</p>
				) : null}
			</div>

			{activeSection === "projects" ? (
				<>
					<div
						className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1"
						style={{ padding: "4px 12px" }}
					>
						{sortedProjects.length === 0 && isLoadingProjects ? (
							<div style={{ padding: "4px 0" }}>
								{Array.from({ length: 3 }).map((_, index) => (
									<ProjectRowSkeleton key={`project-skeleton-${index}`} />
								))}
							</div>
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

						{!isLoadingProjects ? (
							<button
								type="button"
								className="kb-project-row flex cursor-pointer items-center gap-1.5 rounded-md text-text-secondary hover:text-text-primary"
								style={{ padding: "6px 8px" }}
								onClick={onAddProject}
								disabled={removingProjectId !== null}
							>
								<Plus size={14} className="shrink-0" />
								<span className="text-sm">Add project</span>
							</button>
						) : null}
					</div>
					<ShortcutsCard />
					<FeedbackCard />
				</>
			) : (
				<div className="flex flex-1 min-h-0 flex-col">
					<div className="flex flex-1 min-h-0 overflow-hidden bg-surface-1 px-2 pb-2 pt-1">
						{agentSectionContent ?? (
							<div className="flex w-full items-center justify-center rounded-md border border-border bg-surface-2 px-3 text-center text-sm text-text-secondary">
								Select a project to use the agent.
							</div>
						)}
					</div>
				</div>
			)}
			<AlertDialog
				open={pendingProjectRemoval !== null}
				onOpenChange={(open) => {
					if (!open && !isProjectRemovalPending) {
						setPendingProjectRemoval(null);
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove Project</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription asChild>
						<div className="flex flex-col gap-3">
							<p>{pendingProjectRemoval ? pendingProjectRemoval.name : "This project"}</p>
							<p className="text-text-primary">
								This will delete all project tasks ({pendingProjectTaskCount}), remove task
								workspaces/worktrees, and stop any running processes for this project.
							</p>
							<p className="text-text-primary">This action cannot be undone.</p>
						</div>
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
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
									Removing...
								</>
							) : (
								"Remove Project"
							)}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
		</aside>
	);
}

const MOD = isMacPlatform ? "⌘" : modifierKeyLabel;

const ESSENTIAL_SHORTCUTS = [
	{ keys: ["C"], label: "New task" },
	{ keys: [MOD, "B"], label: "Start backlog tasks" },
	{ keys: [MOD, "Shift", "S"], label: "Settings (Select Agent)" },
	{ keys: ["Click", MOD], label: "Hold to link tasks" },
	{ keys: [MOD, "G"], label: "Toggle git view" },
	{ keys: [MOD, "J"], label: "Toggle terminal" },
];

const MORE_SHORTCUTS = [
	{ keys: [MOD, "Shift", "A"], label: "Toggle plan / act" },
	{ keys: [MOD, "M"], label: "Expand terminal" },
	{ keys: ["Esc"], label: "Close / back" },
];

function ShortcutHint({ keys, label }: { keys: string[]; label: string }): React.ReactElement {
	return (
		<div className="flex justify-between items-center py-px">
			<span className="text-text-tertiary text-xs">{label}</span>
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
			<div style={{ padding: "0 8px" }}>
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
							className="flex items-center gap-1 mt-1.5 text-xs text-text-tertiary hover:text-text-secondary cursor-pointer bg-transparent border-none p-0"
						>
							{expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
							{expanded ? "Less" : "All shortcuts"}
						</button>
					</Collapsible.Trigger>
				</Collapsible.Root>
			</div>
		</div>
	);
}

function FeedbackCard(): React.ReactElement {
	const handleOpenFeedback = useCallback(() => {
		openFeaturebaseFeedbackWidget();
	}, []);

	return (
		<div style={{ padding: "0 12px 10px" }}>
			<Button
				fill
				size="sm"
				variant="ghost"
				className="!border !border-border-bright bg-transparent text-text-secondary hover:bg-surface-2 hover:text-text-primary"
				data-featurebase-feedback
				onClick={handleOpenFeedback}
			>
				Share feedback
			</Button>
		</div>
	);
}

function ProjectRowSkeleton(): React.ReactElement {
	return (
		<div
			className="flex items-center gap-1.5"
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
			className={cn("kb-project-row cursor-pointer rounded-md", isCurrent && "kb-project-row-selected")}
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
					className={isCurrent ? "text-white hover:bg-white/20 hover:text-white active:bg-white/30" : undefined}
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
