import * as Collapsible from "@radix-ui/react-collapsible";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronUp, Ellipsis, ExternalLink, Info, Lightbulb, Plus } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { canShowFeaturebaseFeedbackButton } from "@/components/featurebase-feedback-button";
import { Button } from "@/components/ui/button";
import { ClineIcon } from "@/components/ui/cline-icon";
import { cn } from "@/components/ui/cn";
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
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { RuntimeAgentId, RuntimeClineProviderSettings, RuntimeProjectSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";
import { isMacPlatform, modifierKeyLabel } from "@/utils/platform";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

const COLLAPSED_WIDTH = 48;
const SIDEBAR_COLLAPSE_THRESHOLD = 120;
const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;
const GITHUB_ISSUES_URL = "https://github.com/cline/kanban/issues";

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
	selectedAgentId,
	clineProviderSettings,
	featurebaseFeedbackState,
	onSelectProject,
	onRemoveProject,
	onAddProject,
	sidebarWidth,
	setExpandedSidebarWidth,
	isCollapsed,
	setSidebarCollapsed,
}: {
	projects: RuntimeProjectSummary[];
	isLoadingProjects?: boolean;
	currentProjectId: string | null;
	removingProjectId: string | null;
	activeSection: "projects" | "agent";
	onActiveSectionChange: (section: "projects" | "agent") => void;
	canShowAgentSection: boolean;
	agentSectionContent?: ReactNode;
	selectedAgentId?: RuntimeAgentId | null;
	clineProviderSettings?: RuntimeClineProviderSettings | null;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
	onSelectProject: (projectId: string) => void;
	onRemoveProject: (projectId: string) => Promise<boolean>;
	onAddProject: () => void;
	sidebarWidth: number;
	setExpandedSidebarWidth: (width: number) => void;
	isCollapsed: boolean;
	setSidebarCollapsed: (collapsed: boolean, persist?: boolean) => void;
}): React.ReactElement {
	const sortedProjects = [...projects].sort((a, b) => a.path.localeCompare(b.path));
	const shouldShowFeaturebaseFeedback = canShowFeaturebaseFeedbackButton({
		selectedAgentId,
		clineProviderSettings,
		featurebaseFeedbackState,
	});

	const [pendingProjectRemoval, setPendingProjectRemoval] = useState<RuntimeProjectSummary | null>(null);
	const isProjectRemovalPending = pendingProjectRemoval !== null && removingProjectId === pendingProjectRemoval.id;
	const pendingProjectTaskCount = pendingProjectRemoval
		? pendingProjectRemoval.taskCounts.backlog +
			pendingProjectRemoval.taskCounts.in_progress +
			pendingProjectRemoval.taskCounts.review +
			pendingProjectRemoval.taskCounts.trash
		: 0;

	const isMobile = useIsMobile();
	const [isMobileClosing, setIsMobileClosing] = useState(false);

	useEffect(() => {
		if (isMobile) {
			setSidebarCollapsed(true, false);
		}
		// Only auto-collapse when crossing the mobile breakpoint, not on every isCollapsed change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isMobile]);

	const setCollapsed = useCallback(
		(collapsed: boolean) => {
			if (isMobile && collapsed) {
				setIsMobileClosing(true);
				return;
			}
			setSidebarCollapsed(collapsed, !isMobile);
		},
		[isMobile, setSidebarCollapsed],
	);

	const handleMobileCloseAnimationEnd = useCallback(() => {
		setIsMobileClosing(false);
		setSidebarCollapsed(true, false);
	}, [setSidebarCollapsed]);

	const [isDragging, setIsDragging] = useState(false);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		setIsDragging(false);
		const previousStyle = previousBodyStyleRef.current;
		if (previousStyle) {
			document.body.style.userSelect = previousStyle.userSelect;
			document.body.style.cursor = previousStyle.cursor;
			previousBodyStyleRef.current = null;
		}
		dragRef.current = null;
	}, []);

	useUnmount(stopDrag);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!isDragging) {
				return;
			}
			const dragState = dragRef.current;
			if (!dragState) {
				return;
			}
			const delta = event.clientX - dragState.startX;
			const newWidth = dragState.startWidth + delta;
			if (newWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
				if (!isCollapsed) {
					setCollapsed(true);
				}
				return;
			}
			if (isCollapsed) {
				setCollapsed(false);
			}
			setExpandedSidebarWidth(newWidth);
		},
		[isCollapsed, isDragging, setExpandedSidebarWidth, setCollapsed],
	);

	const handleMouseUp = useCallback(() => {
		if (!isDragging) {
			return;
		}
		stopDrag();
	}, [isDragging, stopDrag]);

	useWindowEvent("mousemove", isDragging ? handleMouseMove : null);
	useWindowEvent("mouseup", isDragging ? handleMouseUp : null);

	const startDrag = useCallback(
		(e: ReactMouseEvent) => {
			e.preventDefault();
			if (isDragging) {
				stopDrag();
			}
			dragRef.current = { startX: e.clientX, startWidth: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth };
			setIsDragging(true);
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[isCollapsed, isDragging, sidebarWidth, stopDrag],
	);

	if (isMobile && isCollapsed && !isMobileClosing) {
		return <></>;
	}

	const collapsedWidth = COLLAPSED_WIDTH;

	if (isCollapsed) {
		return (
			<aside
				className="flex flex-col items-center min-h-0 overflow-hidden bg-surface-1 relative shrink-0 py-2 gap-1.5"
				style={{
					width: collapsedWidth,
					minWidth: collapsedWidth,
					borderRight: "1px solid var(--color-divider)",
				}}
			>
				{!isMobile && (
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize sidebar"
						onMouseDown={startDrag}
						className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10"
					/>
				)}
				{sortedProjects.map((project) => {
					const isCurrent = currentProjectId === project.id;
					const letter = project.name.charAt(0).toUpperCase();
					return (
						<button
							key={project.id}
							type="button"
							title={project.name}
							onClick={() => {
								if (isMobile) {
									setCollapsed(false);
								}
								onSelectProject(project.id);
							}}
							className={cn(
								"rounded-md text-xs font-semibold shrink-0 border-0 cursor-pointer flex items-center justify-center",
								isMobile ? "w-11 h-11" : "w-8 h-8",
								isCurrent
									? "bg-accent text-white"
									: "bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-4",
							)}
						>
							{letter}
						</button>
					);
				})}
				<button
					type="button"
					title="Add project"
					onClick={onAddProject}
					disabled={removingProjectId !== null}
					className={cn(
						"rounded-md text-xs shrink-0 border-0 cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface-2 mt-auto",
						isMobile ? "w-11 h-11" : "w-8 h-8",
					)}
				>
					<Plus size={16} />
				</button>
			</aside>
		);
	}

	return (
		<aside
			className={cn(
				"flex flex-col min-h-0 overflow-hidden bg-surface-1 shrink-0",
				isMobile ? "fixed inset-y-0 left-0 z-50 shadow-2xl" : "relative",
			)}
			onAnimationEnd={isMobileClosing ? handleMobileCloseAnimationEnd : undefined}
			style={
				isMobile
					? {
							width: "100vw",
							animation: isMobileClosing
								? "kb-sidebar-slide-out 200ms ease forwards"
								: "kb-sidebar-slide-in 200ms ease",
						}
					: {
							width: sidebarWidth,
							minWidth: SIDEBAR_MIN_EXPANDED_WIDTH,
							maxWidth: SIDEBAR_MAX_EXPANDED_WIDTH,
							borderRight: "1px solid var(--color-divider)",
						}
			}
		>
			{!isMobile && (
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize sidebar"
					onMouseDown={startDrag}
					className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10"
				/>
			)}
			<div style={{ padding: "12px 12px 8px" }}>
				<div className="flex items-center justify-between">
					<div className="font-semibold text-base flex items-baseline gap-1.5">
						<ClineIcon size={18} className="text-text-primary shrink-0 self-center" />
						Cline <span className="text-text-secondary font-normal text-xs">v{__APP_VERSION__}</span>
					</div>
					{isMobile ? (
						<Button
							variant="ghost"
							size="sm"
							icon={<Plus size={16} className="rotate-45" />}
							onClick={() => setCollapsed(true)}
							aria-label="Close sidebar"
							className="min-w-[44px] min-h-[44px] -mr-2"
						/>
					) : null}
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
								onSelect={(projectId) => {
									onSelectProject(projectId);
									if (isMobile) {
										setCollapsed(true);
									}
								}}
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
								<span className="text-sm">Add Project</span>
							</button>
						) : null}
					</div>
					<ShortcutsCard />
					<ProjectSupportFooter
						shouldShowFeaturebaseFeedback={shouldShowFeaturebaseFeedback}
						featurebaseFeedbackState={featurebaseFeedbackState}
					/>
				</>
			) : (
				<div className="flex flex-1 min-h-0 flex-col">
					{selectedAgentId && selectedAgentId !== "cline" ? (
						<TerminalAgentHints agentId={selectedAgentId} />
					) : null}
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

const TERMINAL_AGENT_HINTS: readonly { label: string; hint: string }[] = [
	{ label: "Create tasks", hint: "Ask your agent to add tasks, link them, and start work" },
	{ label: "Break down work", hint: "Ask to decompose a feature into linked subtasks" },
	{ label: "Import issues", hint: "Pull issues into task cards via GitHub CLI or Linear MCP" },
];

const AGENT_TIPS_DISMISSED_KEY = "kb-agent-tips-dismissed";

function TerminalAgentHints(_props: { agentId: RuntimeAgentId }): React.ReactElement {
	const [isDismissed, setIsDismissed] = useState(() => localStorage.getItem(AGENT_TIPS_DISMISSED_KEY) === "true");

	const dismiss = useCallback(() => {
		setIsDismissed(true);
		localStorage.setItem(AGENT_TIPS_DISMISSED_KEY, "true");
	}, []);

	const restore = useCallback(() => {
		setIsDismissed(false);
		localStorage.removeItem(AGENT_TIPS_DISMISSED_KEY);
	}, []);

	if (isDismissed) {
		return (
			<div className="shrink-0 px-3 pt-1">
				<button
					type="button"
					onClick={restore}
					className="flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-[11px] text-text-tertiary hover:text-text-secondary"
				>
					<Lightbulb size={11} />
					Show tips
				</button>
			</div>
		);
	}
	return (
		<div className="shrink-0 mx-2 mt-1 mb-1 rounded-md border border-border-bright/50 bg-surface-0/60 px-3 py-2">
			<div className="flex items-center justify-between mb-1.5">
				<span className="text-[11px] font-medium text-text-secondary flex items-center gap-1">
					<Lightbulb size={11} className="text-status-gold" />
					Tips
				</span>
				<button
					type="button"
					onClick={dismiss}
					className="cursor-pointer border-none bg-transparent p-0 text-[10px] text-text-tertiary hover:text-text-secondary"
				>
					Hide
				</button>
			</div>
			<div className="space-y-1">
				{TERMINAL_AGENT_HINTS.map((item) => (
					<p key={item.label} className="m-0 text-[11px] text-text-tertiary">
						<span className="text-text-primary font-medium">{item.label}</span> — {item.hint}
					</p>
				))}
			</div>
		</div>
	);
}

function ProjectSupportFooter({
	shouldShowFeaturebaseFeedback,
	featurebaseFeedbackState,
}: {
	shouldShowFeaturebaseFeedback: boolean;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
}): React.ReactElement {
	const isOpening = featurebaseFeedbackState?.authState === "loading";

	const handleAction = () => {
		if (shouldShowFeaturebaseFeedback) {
			void featurebaseFeedbackState?.openFeedbackWidget();
		} else {
			window.open(GITHUB_ISSUES_URL, "_blank");
		}
	};

	const actionLabel = shouldShowFeaturebaseFeedback ? (isOpening ? "Opening..." : "Send feedback") : "Report issue";

	return (
		<div style={{ padding: "4px 12px 12px" }}>
			<div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
				<Info size={14} className="mt-px shrink-0 text-text-tertiary" />
				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-xs text-text-secondary">
						Kanban is in beta. Help us improve by sharing your experience.
					</p>
					<button
						type="button"
						className="m-0 flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-xs font-semibold text-text-secondary hover:text-text-primary active:text-text-tertiary disabled:cursor-default disabled:opacity-50"
						disabled={shouldShowFeaturebaseFeedback && isOpening}
						onClick={handleAction}
					>
						{actionLabel} {!isOpening && <ExternalLink size={11} />}
					</button>
				</div>
			</div>
		</div>
	);
}

const MOD = isMacPlatform ? "⌘" : modifierKeyLabel;
const ALT = isMacPlatform ? "⌥" : "Alt";

const ESSENTIAL_SHORTCUTS = [
	{ keys: ["C"], label: "New task" },
	{ keys: [MOD, "B"], label: "Start backlog tasks" },
	{ keys: [MOD, "Shift", "S"], label: "Settings" },
	{ keys: ["Click", MOD], label: "Hold to link tasks" },
	{ keys: [MOD, "G"], label: "Toggle git view" },
	{ keys: [MOD, "J"], label: "Toggle terminal" },
];

const MORE_SHORTCUTS = [
	{ keys: [MOD, "Shift", "A"], label: "Toggle plan / act" },
	{ keys: [ALT, "Shift", "Enter"], label: "Start and open task" },
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
	const [isMenuOpen, setIsMenuOpen] = useState(false);
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
			<div className="kb-project-row-actions flex items-center" style={isMenuOpen ? { opacity: 1 } : undefined}>
				<DropdownMenu.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
					<DropdownMenu.Trigger asChild>
						<Button
							variant="ghost"
							size="sm"
							icon={isRemovingProject ? <Spinner size={12} /> : <Ellipsis size={14} />}
							disabled={hasAnyProjectRemoval && !isRemovingProject}
							className={
								isCurrent ? "text-white hover:bg-white/20 hover:text-white active:bg-white/30" : undefined
							}
							onClick={(e) => {
								e.stopPropagation();
							}}
							aria-label="Project actions"
						/>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							side="bottom"
							align="end"
							sideOffset={4}
							className="z-50 min-w-[140px] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
							onCloseAutoFocus={(event) => event.preventDefault()}
						>
							<DropdownMenu.Item
								className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-status-red cursor-pointer outline-none data-[highlighted]:bg-surface-3"
								onSelect={() => onRemove(project.id)}
							>
								Delete
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
		</div>
	);
}
