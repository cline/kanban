import {
	Alignment,
	Button,
	ButtonGroup,
	Classes,
	Colors,
	Icon,
	Menu,
	MenuItem,
	MenuDivider,
	Navbar,
	NavbarDivider,
	NavbarGroup,
	Popover,
	PopoverInteractionKind,
	Tag,
	Tooltip,
} from "@blueprintjs/core";
import { IconNames, type IconName } from "@blueprintjs/icons";
import { useState } from "react";

import { GitStatusLabel } from "@/kanban/components/git-status-label";
import { OpenWorkspaceButton } from "@/kanban/components/open-workspace-button";
import type { RuntimeGitSyncAction, RuntimeGitSyncSummary, RuntimeProjectShortcut } from "@/kanban/runtime/types";
import type { OpenTargetId, OpenTargetOption } from "@/kanban/utils/open-targets";
import { formatPathForDisplay } from "@/kanban/utils/path-display";

interface BranchSelectOption {
	value: string;
	label: string;
}

const BLUEPRINT_ICON_NAMES = new Set<IconName>(Object.values(IconNames));

export interface TopBarTaskGitSummary {
	hasGit: boolean;
	branch: string | null;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
	scopeLabel?: string | null;
}

type SettingsSection = "shortcuts";

function getWorkspacePathSegments(path: string): string[] {
	return path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
}

function resolveShortcutIcon(icon: string | undefined): IconName {
	const normalized = icon?.trim();
	if (!normalized) {
		return "console";
	}
	const candidate = normalized as IconName;
	return BLUEPRINT_ICON_NAMES.has(candidate) ? candidate : "console";
}

export function TopBar({
	onBack,
	workspacePath,
	isWorkspacePathLoading = false,
	workspaceHint,
	repoHint,
	runtimeHint,
	gitSummary,
	taskGitSummary,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
	homeBranchOptions,
	selectedHomeBranch,
	onSelectHomeBranch,
	isSwitchingHomeBranch,
	onToggleTerminal,
	isTerminalOpen,
	isTerminalLoading,
	onOpenSettings,
	shortcuts,
	selectedShortcutId,
	onSelectShortcutId,
	runningShortcutId,
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
	repoHint?: string;
	runtimeHint?: string;
	gitSummary?: RuntimeGitSyncSummary | null;
	taskGitSummary?: TopBarTaskGitSummary | null;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
	homeBranchOptions?: readonly BranchSelectOption[];
	selectedHomeBranch?: string | null;
	onSelectHomeBranch?: (branch: string) => void;
	isSwitchingHomeBranch?: boolean;
	onToggleTerminal?: () => void;
	isTerminalOpen?: boolean;
	isTerminalLoading?: boolean;
	onOpenSettings?: (section?: SettingsSection) => void;
	shortcuts?: RuntimeProjectShortcut[];
	selectedShortcutId?: string | null;
	onSelectShortcutId?: (shortcutId: string) => void;
	runningShortcutId?: string | null;
	onRunShortcut?: (shortcutId: string) => void;
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
	hideProjectDependentActions?: boolean;
}): React.ReactElement {
	const [isBranchPickerOpen, setIsBranchPickerOpen] = useState(false);
	const displayWorkspacePath = workspacePath ? formatPathForDisplay(workspacePath) : null;
	const workspaceSegments = displayWorkspacePath ? getWorkspacePathSegments(displayWorkspacePath) : [];
	const hasAbsoluteLeadingSlash = Boolean(displayWorkspacePath?.startsWith("/"));
	const hasHomeGitSummary = Boolean(gitSummary?.hasGit);
	const branchLabel = gitSummary?.currentBranch ?? "detached HEAD";
	const selectedBranchOption = selectedHomeBranch ?? null;
	const hasHomeBranchPicker = hasHomeGitSummary && Boolean(onSelectHomeBranch) && Boolean(homeBranchOptions?.length);
	const pullCount = gitSummary?.behindCount ?? 0;
	const pushCount = gitSummary?.aheadCount ?? 0;
	const hasTaskGitSummary = Boolean(taskGitSummary?.hasGit);
	const taskBranchLabel =
		taskGitSummary?.branch ??
		taskGitSummary?.headCommit?.slice(0, 8) ??
		"initializing";
	const taskScopeLabel = taskGitSummary?.scopeLabel?.trim();
	const pullTooltip = pullCount > 0
		? `Pull ${pullCount} commit${pullCount === 1 ? "" : "s"} from upstream into your local branch.`
		: "Pull from upstream. Branch is already up to date.";
	const pushTooltip = pushCount > 0
		? `Push ${pushCount} local commit${pushCount === 1 ? "" : "s"} to upstream.`
		: "Push local commits to upstream. No local commits are pending.";
	const isMacPlatform = typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
	const terminalShortcutIcon = isMacPlatform ? "key-command" : "key-control";
	const handleAddShortcut = () => {
		onOpenSettings?.("shortcuts");
	};
	const selectedShortcut =
		(shortcuts ?? []).find((shortcut) => shortcut.id === selectedShortcutId) ??
		(shortcuts ?? [])[0] ??
		null;

	return (
		<Navbar
			fixedToTop={false}
			style={{
				height: 40,
				minHeight: 40,
				paddingLeft: 12,
				paddingRight: 8,
				background: Colors.DARK_GRAY3,
				boxShadow: "none",
				borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
			}}
		>
			<NavbarGroup align={Alignment.LEFT} style={{ height: 40 }}>
				{onBack ? (
					<>
						<Button icon="arrow-left" variant="minimal" onClick={onBack} aria-label="Back to board" style={{ marginLeft: -8, marginRight: 4 }} />
						<span role="img" aria-label="banana" style={{ marginRight: 4 }}>🍌</span>
						<NavbarDivider />
					</>
				) : null}
				{isWorkspacePathLoading ? (
					<span
						className={Classes.SKELETON}
						style={{ display: "inline-block", height: 14, width: 320, borderRadius: 3 }}
						aria-hidden
					>
						.
					</span>
				) : displayWorkspacePath ? (
					<span
						className={`${Classes.MONOSPACE_TEXT} ${Classes.TEXT_OVERFLOW_ELLIPSIS}`}
						style={{ fontSize: 12, maxWidth: 640, color: Colors.GRAY4 }}
						title={workspacePath}
						data-testid="workspace-path"
					>
						{hasAbsoluteLeadingSlash ? "/" : ""}
						{workspaceSegments.map((segment, index) => {
							const isLast = index === workspaceSegments.length - 1;
							return (
								<span key={`${segment}-${index}`}>
									{index === 0 ? "" : "/"}
									<span style={isLast ? { color: Colors.LIGHT_GRAY5 } : undefined}>{segment}</span>
								</span>
							);
						})}
					</span>
				) : null}
				{displayWorkspacePath && !isWorkspacePathLoading ? (
					<div style={{ marginLeft: 8 }}>
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
					<Tag minimal className="kb-navbar-tag">{workspaceHint}</Tag>
				) : null}
				{!hideProjectDependentActions && repoHint ? (
					<Tag minimal intent="warning" className="kb-navbar-tag">{repoHint}</Tag>
				) : null}
				{!hideProjectDependentActions && runtimeHint ? (
					<Tag minimal intent="warning" className="kb-navbar-tag">{runtimeHint}</Tag>
				) : null}
				{!hideProjectDependentActions && hasHomeGitSummary ? (
					<>
						<NavbarDivider />
						{hasHomeBranchPicker ? (
							<>
								<Tooltip placement="bottom" content="Switch the branch for the local workspace." disabled={isBranchPickerOpen}>
									<Popover
										interactionKind={PopoverInteractionKind.CLICK}
										placement="bottom-start"
										onOpening={() => setIsBranchPickerOpen(true)}
										onClosing={() => setIsBranchPickerOpen(false)}
										content={(
											<Menu style={{ maxHeight: 300, overflowY: "auto" }}>
												{(homeBranchOptions ?? []).map((option) => (
													<MenuItem
														key={option.value}
														text={option.label}
														active={option.value === selectedBranchOption}
														onClick={() => onSelectHomeBranch?.(option.value)}
														labelElement={option.value === selectedBranchOption ? <Icon icon="small-tick" /> : undefined}
													/>
												))}
											</Menu>
										)}
									>
										<Button
											size="small"
											variant="outlined"
											icon={<Icon icon="git-branch" size={12} />}
											endIcon="caret-down"
											text={selectedBranchOption ?? branchLabel}
											disabled={Boolean(runningGitAction) || Boolean(isSwitchingHomeBranch)}
											className={Classes.MONOSPACE_TEXT}
											style={{
												fontSize: "var(--bp-typography-size-body-small)",
												maxWidth: 200,
											}}
										/>
									</Popover>
								</Tooltip>
								<span
									className={Classes.MONOSPACE_TEXT}
									style={{
										fontSize: "var(--bp-typography-size-body-small)",
										color: Colors.GRAY3,
										marginLeft: 6,
									}}
								>
									({gitSummary?.changedFiles ?? 0} {(gitSummary?.changedFiles ?? 0) === 1 ? "file" : "files"}
									<span style={{ color: Colors.GREEN4 }}> +{gitSummary?.additions ?? 0}</span>
									<span style={{ color: Colors.RED4 }}> -{gitSummary?.deletions ?? 0}</span>
									)
								</span>
							</>
						) : (
							<GitStatusLabel
								branchLabel={branchLabel}
								changedFiles={gitSummary?.changedFiles ?? 0}
								additions={gitSummary?.additions ?? 0}
								deletions={gitSummary?.deletions ?? 0}
							/>
						)}
						<ButtonGroup style={{ marginLeft: 6 }}>
							<Tooltip placement="bottom" content="Fetch latest refs from upstream without changing your local branch or files.">
								<Button
									icon={<Icon icon="circle-arrow-down" size={18} />}
									size="small"
									variant="minimal"
									onClick={onGitFetch}
									loading={runningGitAction === "fetch"}
									aria-label="Fetch from upstream"
								/>
							</Tooltip>
							<Tooltip placement="bottom" content={pullTooltip}>
								<Button
									icon="download"
									size="small"
									text={<span style={{ color: Colors.GRAY3 }}>{pullCount}</span>}
									variant="minimal"
									onClick={onGitPull}
									loading={runningGitAction === "pull"}
									aria-label="Pull from upstream"
								/>
							</Tooltip>
							<Tooltip placement="bottom" content={pushTooltip}>
								<Button
									icon="upload"
									size="small"
									text={<span style={{ color: Colors.GRAY3 }}>{pushCount}</span>}
									variant="minimal"
									onClick={onGitPush}
									loading={runningGitAction === "push"}
									aria-label="Push to upstream"
								/>
							</Tooltip>
						</ButtonGroup>
					</>
				) : hasTaskGitSummary ? (
					<>
						<NavbarDivider />
						{taskScopeLabel ? (
							<span
								style={{
									fontSize: "var(--bp-typography-size-body-small)",
									fontWeight: 600,
									color: Colors.LIGHT_GRAY5,
									marginRight: 6,
								}}
							>
								{taskScopeLabel}:
							</span>
						) : null}
						<GitStatusLabel
							branchLabel={taskBranchLabel}
							changedFiles={taskGitSummary?.changedFiles ?? null}
							additions={taskGitSummary?.additions ?? null}
							deletions={taskGitSummary?.deletions ?? null}
						/>
					</>
				) : null}
			</NavbarGroup>
			<NavbarGroup align={Alignment.RIGHT} style={{ height: 40, paddingRight: 2 }}>
				{!hideProjectDependentActions && selectedShortcut && onRunShortcut ? (
					<ButtonGroup>
						<Button
							variant="outlined"
							size="small"
							icon={<Icon icon={resolveShortcutIcon(selectedShortcut.icon)} size={13} />}
							text={selectedShortcut.label}
							loading={Boolean(runningShortcutId)}
							onClick={() => onRunShortcut(selectedShortcut.id)}
							disabled={Boolean(runningShortcutId)}
							style={{ fontSize: "var(--bp-typography-size-body-small)" }}
						/>
						<Popover
							interactionKind={PopoverInteractionKind.CLICK}
							placement="bottom-end"
							content={(
								<Menu>
									{(shortcuts ?? []).map((shortcut) => (
										<MenuItem
											key={shortcut.id}
											icon={resolveShortcutIcon(shortcut.icon)}
											text={shortcut.label}
											active={shortcut.id === selectedShortcut.id}
											onClick={() => onSelectShortcutId?.(shortcut.id)}
											labelElement={
												shortcut.id === selectedShortcut.id
													? <Icon icon="small-tick" />
													: undefined
											}
										/>
									))}
									<MenuDivider />
									<MenuItem
										icon="plus"
										text="Add shortcut"
										onClick={handleAddShortcut}
									/>
								</Menu>
							)}
						>
							<Button
								size="small"
								variant="outlined"
								icon="caret-down"
								aria-label="Select shortcut"
								disabled={Boolean(runningShortcutId)}
							/>
						</Popover>
					</ButtonGroup>
				) : null}
				{onToggleTerminal ? (
					<Tooltip
						placement="bottom"
						content={(
							<span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
								<span>Toggle terminal</span>
								<span style={{ display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}>
									<span>(</span>
									<Icon icon={terminalShortcutIcon} size={11} />
									<span>+ J)</span>
								</span>
							</span>
						)}
					>
						<Button
							icon="console"
							size="small"
							variant="minimal"
							onClick={onToggleTerminal}
							disabled={Boolean(isTerminalLoading)}
							aria-label={isTerminalOpen ? "Close terminal" : "Open terminal"}
							style={{ marginLeft: 9 }}
						/>
					</Tooltip>
				) : null}
				<Button
					icon="cog"
					size="small"
					variant="minimal"
					onClick={() => onOpenSettings?.()}
					aria-label="Settings"
					data-testid="open-settings-button"
					style={{ marginLeft: 5, marginRight: 2 }}
				/>
			</NavbarGroup>
		</Navbar>
	);
}
