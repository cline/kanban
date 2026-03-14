import * as RadixPopover from "@radix-ui/react-popover";
import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	Check,
	ChevronDown,
	CircleArrowDown,
	Command,
	GitBranch,
	Plus,
	Settings,
	Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import { OpenWorkspaceButton } from "@/components/open-workspace-button";
import { getRuntimeShortcutIconComponent } from "@/components/shared/runtime-shortcut-icons";
import type { RuntimeGitSyncAction, RuntimeProjectShortcut } from "@/runtime/types";
import {
	useHomeGitSummaryValue,
	useTaskWorkspaceInfoValue,
	useTaskWorkspaceSnapshotValue,
} from "@/stores/workspace-metadata-store";
import type { OpenTargetId, OpenTargetOption } from "@/utils/open-targets";
import { formatPathForDisplay } from "@/utils/path-display";

type SettingsSection = "shortcuts";

function getWorkspacePathSegments(path: string): string[] {
	return path
		.replaceAll("\\", "/")
		.split("/")
		.filter((segment) => segment.length > 0);
}

function GitBranchStatusControl({
	branchLabel,
	changedFiles,
	additions,
	deletions,
	onToggleGitHistory,
	isGitHistoryOpen,
}: {
	branchLabel: string;
	changedFiles: number;
	additions: number;
	deletions: number;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
}): React.ReactElement {
	if (onToggleGitHistory) {
		return (
			<div className="flex items-center min-w-0 overflow-hidden">
				<Button
					variant={isGitHistoryOpen ? "primary" : "default"}
					size="sm"
					icon={<GitBranch size={12} />}
					onClick={onToggleGitHistory}
					className={cn("font-mono text-xs shrink min-w-0 max-w-full overflow-hidden", isGitHistoryOpen ? "ring-1 ring-accent" : "kb-navbar-btn")}
					title={branchLabel}
				>
					<span className="truncate w-full text-left">{branchLabel}</span>
				</Button>
				<span
					className="font-mono text-xs text-text-tertiary ml-1.5 shrink-0 whitespace-nowrap"
				>
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
					<span className="text-status-green"> +{additions}</span>
					<span className="text-status-red"> -{deletions}</span>)
				</span>
			</div>
		);
	}

	return (
		<span
			className="font-mono text-xs text-text-secondary mr-1 whitespace-nowrap"
		>
			<GitBranch size={12} className="inline-block mr-1" style={{ verticalAlign: -1 }} />
			<span className="text-text-primary">{branchLabel}</span>
			<span className="ml-1.5">
				<span className="text-text-tertiary">
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
				</span>
				<span className="text-status-green"> +{additions}</span>
				<span className="text-status-red"> -{deletions}</span>
				<span className="text-text-tertiary">)</span>
			</span>
		</span>
	);
}

function TopBarGitStatusSection({
	showHomeGitSummary,
	selectedTaskId,
	selectedTaskBaseRef,
	onToggleGitHistory,
	isGitHistoryOpen,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
}: {
	showHomeGitSummary: boolean;
	selectedTaskId: string | null;
	selectedTaskBaseRef: string | null;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
}): React.ReactElement | null {
	const homeGitSummary = useHomeGitSummaryValue();
	const taskWorkspaceInfo = useTaskWorkspaceInfoValue(selectedTaskId, selectedTaskBaseRef);
	const taskWorkspaceSnapshot = useTaskWorkspaceSnapshotValue(selectedTaskId);

	if (showHomeGitSummary && homeGitSummary) {
		const branchLabel = homeGitSummary.currentBranch ?? "detached HEAD";
		const pullCount = homeGitSummary.behindCount ?? 0;
		const pushCount = homeGitSummary.aheadCount ?? 0;
		const pullTooltip =
			pullCount > 0
				? `Pull ${pullCount} commit${pullCount === 1 ? "" : "s"} from upstream into your local branch.`
				: "Pull from upstream. Branch is already up to date.";
		const pushTooltip =
			pushCount > 0
				? `Push ${pushCount} local commit${pushCount === 1 ? "" : "s"} to upstream.`
				: "Push local commits to upstream. No local commits are pending.";
		return (
			<>
				<div className="w-px h-5 bg-border mx-1" />
				<GitBranchStatusControl
					branchLabel={branchLabel}
					changedFiles={homeGitSummary.changedFiles ?? 0}
					additions={homeGitSummary.additions ?? 0}
					deletions={homeGitSummary.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
				<div className="flex gap-0 ml-1">
					<Tooltip
						side="bottom"
						content="Fetch latest refs from upstream without changing your local branch or files."
					>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "fetch" ? <Spinner size={14} /> : <CircleArrowDown size={18} />}
							onClick={onGitFetch}
							disabled={runningGitAction === "fetch"}
							aria-label="Fetch from upstream"
						/>
					</Tooltip>
					<Tooltip side="bottom" content={pullTooltip}>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "pull" ? <Spinner size={14} /> : <ArrowDown size={14} />}
							onClick={onGitPull}
							disabled={runningGitAction === "pull"}
							aria-label="Pull from upstream"
						>
							<span className="text-text-tertiary">{pullCount}</span>
						</Button>
					</Tooltip>
					<Tooltip side="bottom" content={pushTooltip}>
						<Button
							variant="ghost"
							size="sm"
							icon={runningGitAction === "push" ? <Spinner size={14} /> : <ArrowUp size={14} />}
							onClick={onGitPush}
							disabled={runningGitAction === "push"}
							aria-label="Push to upstream"
						>
							<span className="text-text-tertiary">{pushCount}</span>
						</Button>
					</Tooltip>
				</div>
			</>
		);
	}

	if (selectedTaskId && (taskWorkspaceInfo || taskWorkspaceSnapshot)) {
		return (
			<>
				<div className="w-px h-5 bg-border mx-1" />
				<GitBranchStatusControl
					branchLabel={
						taskWorkspaceInfo?.branch ?? taskWorkspaceSnapshot?.headCommit?.slice(0, 8) ?? "initializing"
					}
					changedFiles={taskWorkspaceSnapshot?.changedFiles ?? 0}
					additions={taskWorkspaceSnapshot?.additions ?? 0}
					deletions={taskWorkspaceSnapshot?.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
			</>
		);
	}

	return null;
}

export function TopBar({
	onBack,
	workspacePath,
	isWorkspacePathLoading = false,
	workspaceHint,
	runtimeHint,
	selectedTaskId,
	selectedTaskBaseRef,
	showHomeGitSummary,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
	onToggleTerminal,
	isTerminalOpen,
	isTerminalLoading,
	onToggleGitHistory,
	isGitHistoryOpen,
	onOpenSettings,
	shortcuts,
	selectedShortcutLabel,
	onSelectShortcutLabel,
	runningShortcutLabel,
	onRunShortcut,
	openTargetOptions,
	selectedOpenTargetId,
	onSelectOpenTarget,
	onOpenWorkspace,
	canOpenWorkspace,
	isOpeningWorkspace,
	hideProjectDependentActions = false,
}: {
	onBack?: () => void;
	workspacePath?: string;
	isWorkspacePathLoading?: boolean;
	workspaceHint?: string;
	runtimeHint?: string;
	selectedTaskId?: string | null;
	selectedTaskBaseRef?: string | null;
	showHomeGitSummary?: boolean;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
	onToggleTerminal?: () => void;
	isTerminalOpen?: boolean;
	isTerminalLoading?: boolean;
	onToggleGitHistory?: () => void;
	isGitHistoryOpen?: boolean;
	onOpenSettings?: (section?: SettingsSection) => void;
	shortcuts?: RuntimeProjectShortcut[];
	selectedShortcutLabel?: string | null;
	onSelectShortcutLabel?: (shortcutLabel: string) => void;
	runningShortcutLabel?: string | null;
	onRunShortcut?: (shortcutLabel: string) => void;
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
	hideProjectDependentActions?: boolean;
}): React.ReactElement {
	const displayWorkspacePath = workspacePath ? formatPathForDisplay(workspacePath) : null;
	const workspaceSegments = displayWorkspacePath ? getWorkspacePathSegments(displayWorkspacePath) : [];
	const hasAbsoluteLeadingSlash = Boolean(displayWorkspacePath?.startsWith("/"));
	const isMacPlatform =
		typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
	const handleAddShortcut = () => {
		onOpenSettings?.("shortcuts");
	};
	const shortcutItems = shortcuts ?? [];
	const selectedShortcutIndex =
		selectedShortcutLabel === null || selectedShortcutLabel === undefined
			? 0
			: shortcutItems.findIndex((shortcut) => shortcut.label === selectedShortcutLabel);
	const selectedShortcut = shortcutItems[selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0] ?? null;
	const SelectedShortcutIcon = selectedShortcut
		? getRuntimeShortcutIconComponent(selectedShortcut.icon)
		: Terminal;

	return (
		<nav
			className="flex flex-nowrap items-center h-10 min-h-[40px] min-w-0 bg-surface-1"
			style={{
				paddingLeft: onBack ? 6 : 12,
				paddingRight: 8,
				borderBottom: "1px solid var(--color-divider)",
			}}
		>
			<div
				className="flex flex-nowrap items-center h-10 flex-1 min-w-0 overflow-hidden gap-1.5"
			>
				{onBack ? (
					<div className="flex items-center shrink-0 overflow-visible">
						<Button
							variant="ghost"
							size="sm"
							icon={<ArrowLeft size={16} />}
							onClick={onBack}
							aria-label="Back to board"
							className="mr-1 shrink-0"
						/>
					</div>
				) : null}
				{isWorkspacePathLoading ? (
					<span
						className="kb-skeleton inline-block"
						style={{ height: 14, width: 320, borderRadius: 3 }}
						aria-hidden
					/>
				) : displayWorkspacePath ? (
					<div className="shrink min-w-0 max-w-[640px] overflow-hidden">
						<span
							className="font-mono truncate block w-full min-w-0 text-xs max-w-full text-text-secondary"
							title={workspacePath}
							data-testid="workspace-path"
						>
							{hasAbsoluteLeadingSlash ? "/" : ""}
							{workspaceSegments.map((segment, index) => {
								const isLast = index === workspaceSegments.length - 1;
								return (
									<span key={`${segment}-${index}`}>
										{index === 0 ? "" : "/"}
										<span className={isLast ? "text-text-primary" : undefined}>{segment}</span>
									</span>
								);
							})}
						</span>
					</div>
				) : null}
				{displayWorkspacePath && !isWorkspacePathLoading ? (
					<div className="ml-2 shrink-0">
						<OpenWorkspaceButton
							options={openTargetOptions}
							selectedOptionId={selectedOpenTargetId}
							disabled={!canOpenWorkspace || isOpeningWorkspace}
							loading={isOpeningWorkspace}
							onOpen={onOpenWorkspace}
							onSelectOption={onSelectOpenTarget}
						/>
					</div>
				) : null}
				{!hideProjectDependentActions && workspaceHint ? (
					<span className="kb-navbar-tag inline-flex items-center rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text-secondary">
						{workspaceHint}
					</span>
				) : null}
				{!hideProjectDependentActions && runtimeHint ? (
					<span className="kb-navbar-tag inline-flex items-center rounded border border-status-orange/30 bg-status-orange/10 px-1.5 py-0.5 text-xs text-status-orange">
						{runtimeHint}
					</span>
				) : null}
				{!hideProjectDependentActions ? (
					<TopBarGitStatusSection
						showHomeGitSummary={showHomeGitSummary === true}
						selectedTaskId={selectedTaskId ?? null}
						selectedTaskBaseRef={selectedTaskBaseRef ?? null}
						onToggleGitHistory={onToggleGitHistory}
						isGitHistoryOpen={isGitHistoryOpen}
						runningGitAction={runningGitAction}
						onGitFetch={onGitFetch}
						onGitPull={onGitPull}
						onGitPush={onGitPush}
					/>
				) : null}
			</div>
			<div
				className="flex flex-nowrap items-center h-10 pr-0.5 shrink-0"
			>
				{!hideProjectDependentActions && selectedShortcut && onRunShortcut ? (
					<div className="flex">
						<Button
							variant="default"
							size="sm"
							icon={runningShortcutLabel ? <Spinner size={12} /> : <SelectedShortcutIcon size={14} />}
							disabled={Boolean(runningShortcutLabel)}
							onClick={() => onRunShortcut(selectedShortcut.label)}
							className="text-xs rounded-r-none kb-navbar-btn"
						>
							{selectedShortcut.label}
						</Button>
						<RadixPopover.Root>
							<RadixPopover.Trigger asChild>
								<Button
									size="sm"
									variant="default"
									icon={<ChevronDown size={12} />}
									aria-label="Select shortcut"
									disabled={Boolean(runningShortcutLabel)}
									className="rounded-l-none border-l-0 kb-navbar-btn"
									style={{ width: 24, paddingLeft: 0, paddingRight: 0 }}
								/>
							</RadixPopover.Trigger>
							<RadixPopover.Portal>
								<RadixPopover.Content
									className="z-50 rounded-lg border border-border bg-surface-2 p-1 shadow-xl"
									style={{ animation: "kb-tooltip-show 100ms ease" }}
									sideOffset={5}
									align="end"
								>
									<div className="min-w-[180px]">
										{shortcutItems.map((shortcut, shortcutIndex) => {
											const ShortcutIcon = getRuntimeShortcutIconComponent(shortcut.icon);
											const isActive = shortcutIndex === (selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0);
											return (
												<button
													type="button"
													key={`${shortcut.label}:${shortcut.command}:${shortcutIndex}`}
													className={cn(
														"flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left",
														isActive && "bg-surface-3",
													)}
													onClick={() => onSelectShortcutLabel?.(shortcut.label)}
												>
													<ShortcutIcon size={14} />
													<span className="flex-1">{shortcut.label}</span>
													{isActive ? <Check size={14} className="text-text-secondary" /> : null}
												</button>
											);
										})}
										<div className="h-px bg-border my-1" />
										<button
											type="button"
											className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left"
											onClick={handleAddShortcut}
										>
											<Plus size={14} />
											<span>Add shortcut</span>
										</button>
									</div>
								</RadixPopover.Content>
							</RadixPopover.Portal>
						</RadixPopover.Root>
					</div>
				) : null}
				{onToggleTerminal ? (
					<Tooltip
						side="bottom"
						content={
							<span className="inline-flex items-center gap-1.5 whitespace-nowrap">
								<span>Toggle terminal</span>
								<span className="inline-flex items-center gap-0.5 whitespace-nowrap">
									<span>(</span>
									{isMacPlatform ? <Command size={11} /> : <span>Ctrl</span>}
									<span>+ J)</span>
								</span>
							</span>
						}
					>
						<Button
							variant="ghost"
							size="sm"
							icon={<Terminal size={16} />}
							onClick={onToggleTerminal}
							disabled={Boolean(isTerminalLoading)}
							aria-label={isTerminalOpen ? "Close terminal" : "Open terminal"}
							className="ml-2"
						/>
					</Tooltip>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					icon={<Settings size={16} />}
					onClick={() => onOpenSettings?.()}
					aria-label="Settings"
					data-testid="open-settings-button"
					className="ml-0.5 mr-0.5"
				/>
			</div>
		</nav>
	);
}
