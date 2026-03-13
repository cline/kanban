import {
	Alignment,
	Button,
	ButtonGroup,
	Classes,
	Colors,
	Icon,
	Menu,
	MenuDivider,
	MenuItem,
	Navbar,
	NavbarDivider,
	NavbarGroup,
	Popover,
	PopoverInteractionKind,
	Tag,
	Tooltip,
} from "@blueprintjs/core";
import { type IconName, IconNames } from "@blueprintjs/icons";

import { OpenWorkspaceButton } from "@/components/open-workspace-button";
import type { RuntimeGitSyncAction, RuntimeProjectShortcut } from "@/runtime/types";
import {
	useHomeGitSummaryValue,
	useTaskWorkspaceInfoValue,
	useTaskWorkspaceSnapshotValue,
} from "@/stores/workspace-metadata-store";
import type { OpenTargetId, OpenTargetOption } from "@/utils/open-targets";
import { formatPathForDisplay } from "@/utils/path-display";

const BLUEPRINT_ICON_NAMES = new Set<IconName>(Object.values(IconNames));

type SettingsSection = "shortcuts";

function getWorkspacePathSegments(path: string): string[] {
	return path
		.replaceAll("\\", "/")
		.split("/")
		.filter((segment) => segment.length > 0);
}

function resolveShortcutIcon(icon: string | undefined): IconName {
	const normalized = icon?.trim();
	if (!normalized) {
		return "console";
	}
	const candidate = normalized as IconName;
	return BLUEPRINT_ICON_NAMES.has(candidate) ? candidate : "console";
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
			<div
				style={{
					display: "flex",
					alignItems: "center",
					minWidth: 0,
					overflow: "hidden",
				}}
			>
				<Button
					icon={<Icon icon="git-branch" size={12} />}
					alignText="start"
					ellipsizeText
					size="small"
					variant="outlined"
					intent={isGitHistoryOpen ? "primary" : undefined}
					active={isGitHistoryOpen}
					onClick={onToggleGitHistory}
					className={Classes.MONOSPACE_TEXT}
					textClassName={Classes.FILL}
					style={{
						fontSize: "var(--bp-typography-size-body-small)",
						flexShrink: 1,
						minWidth: 0,
						maxWidth: "100%",
						overflow: "hidden",
					}}
					title={branchLabel}
					text={branchLabel}
				/>
				<span
					className={Classes.MONOSPACE_TEXT}
					style={{
						fontSize: "var(--bp-typography-size-body-small)",
						color: Colors.GRAY3,
						marginLeft: 6,
						flexShrink: 0,
						whiteSpace: "nowrap",
					}}
				>
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
					<span style={{ color: Colors.GREEN4 }}> +{additions}</span>
					<span style={{ color: Colors.RED4 }}> -{deletions}</span>)
				</span>
			</div>
		);
	}

	return (
		<span
			className={Classes.MONOSPACE_TEXT}
			style={{
				fontSize: "var(--bp-typography-size-body-small)",
				color: Colors.GRAY4,
				marginRight: 4,
				whiteSpace: "nowrap",
			}}
		>
			<Icon icon="git-branch" size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
			<span style={{ color: Colors.LIGHT_GRAY5 }}>{branchLabel}</span>
			<span style={{ marginLeft: 6 }}>
				<span style={{ color: Colors.GRAY3 }}>
					({changedFiles} {changedFiles === 1 ? "file" : "files"}
				</span>
				<span style={{ color: Colors.GREEN4 }}> +{additions}</span>
				<span style={{ color: Colors.RED4 }}> -{deletions}</span>
				<span style={{ color: Colors.GRAY3 }}>)</span>
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
				<NavbarDivider />
				<GitBranchStatusControl
					branchLabel={branchLabel}
					changedFiles={homeGitSummary.changedFiles ?? 0}
					additions={homeGitSummary.additions ?? 0}
					deletions={homeGitSummary.deletions ?? 0}
					onToggleGitHistory={onToggleGitHistory}
					isGitHistoryOpen={isGitHistoryOpen}
				/>
				<ButtonGroup style={{ marginLeft: 6 }}>
					<Tooltip
						placement="bottom"
						content="Fetch latest refs from upstream without changing your local branch or files."
					>
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
		);
	}

	if (selectedTaskId && (taskWorkspaceInfo || taskWorkspaceSnapshot)) {
		return (
			<>
				<NavbarDivider />
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
	onOpenKeyboardShortcuts,
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
	onOpenKeyboardShortcuts?: () => void;
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
	const terminalShortcutIcon = isMacPlatform ? "key-command" : "key-control";
	const handleAddShortcut = () => {
		onOpenSettings?.("shortcuts");
	};
	const shortcutItems = shortcuts ?? [];
	const selectedShortcutIndex =
		selectedShortcutLabel === null || selectedShortcutLabel === undefined
			? 0
			: shortcutItems.findIndex((shortcut) => shortcut.label === selectedShortcutLabel);
	const selectedShortcut = shortcutItems[selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0] ?? null;

	return (
		<Navbar
			fixedToTop={false}
			style={{
				display: "flex",
				flexWrap: "nowrap",
				alignItems: "center",
				height: 40,
				minHeight: 40,
				minWidth: 0,
				paddingLeft: onBack ? 6 : 12,
				paddingRight: 8,
				background: Colors.DARK_GRAY3,
				boxShadow: "none",
				borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
			}}
		>
			<NavbarGroup
				align={Alignment.LEFT}
				style={{
					display: "flex",
					flexWrap: "nowrap",
					alignItems: "center",
					height: 40,
					flex: "1 1 auto",
					minWidth: 0,
					overflow: "hidden",
				}}
			>
				{onBack ? (
					<div style={{ display: "flex", alignItems: "center", flexShrink: 0, overflow: "visible" }}>
						<Button
							icon="arrow-left"
							variant="minimal"
							onClick={onBack}
							aria-label="Back to board"
							style={{ marginRight: 4, flexShrink: 0 }}
						/>
						<Icon icon="alignment-top" size={16} color={Colors.GRAY4} style={{ marginRight: 4 }} />
						<NavbarDivider />
					</div>
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
					<div style={{ flex: "0 1 auto", minWidth: 0, maxWidth: 640, overflow: "hidden" }}>
						<span
							className={`${Classes.MONOSPACE_TEXT} ${Classes.TEXT_OVERFLOW_ELLIPSIS}`}
							style={{
								display: "block",
								width: "100%",
								minWidth: 0,
								fontSize: 12,
								maxWidth: "100%",
								color: Colors.GRAY4,
							}}
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
					</div>
				) : null}
				{displayWorkspacePath && !isWorkspacePathLoading ? (
					<div style={{ marginLeft: 8, flexShrink: 0 }}>
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
					<Tag minimal className="kb-navbar-tag">
						{workspaceHint}
					</Tag>
				) : null}
				{!hideProjectDependentActions && runtimeHint ? (
					<Tag minimal intent="warning" className="kb-navbar-tag">
						{runtimeHint}
					</Tag>
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
			</NavbarGroup>
			<NavbarGroup
				align={Alignment.RIGHT}
				style={{
					display: "flex",
					flexWrap: "nowrap",
					alignItems: "center",
					height: 40,
					paddingRight: 2,
					flexShrink: 0,
				}}
			>
				{!hideProjectDependentActions && selectedShortcut && onRunShortcut ? (
					<ButtonGroup>
						<Button
							variant="outlined"
							size="small"
							icon={resolveShortcutIcon(selectedShortcut.icon)}
							text={selectedShortcut.label}
							loading={Boolean(runningShortcutLabel)}
							onClick={() => onRunShortcut(selectedShortcut.label)}
							disabled={Boolean(runningShortcutLabel)}
							style={{ fontSize: "var(--bp-typography-size-body-small)" }}
						/>
						<Popover
							interactionKind={PopoverInteractionKind.CLICK}
							placement="bottom-end"
							content={
								<Menu>
									{shortcutItems.map((shortcut, shortcutIndex) => (
										<MenuItem
											key={`${shortcut.label}:${shortcut.command}:${shortcutIndex}`}
											icon={resolveShortcutIcon(shortcut.icon)}
											text={shortcut.label}
											active={shortcutIndex === (selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0)}
											onClick={() => onSelectShortcutLabel?.(shortcut.label)}
											labelElement={
												shortcutIndex === (selectedShortcutIndex >= 0 ? selectedShortcutIndex : 0) ? (
													<Icon icon="small-tick" />
												) : undefined
											}
										/>
									))}
									<MenuDivider />
									<MenuItem icon="plus" text="Add shortcut" onClick={handleAddShortcut} />
								</Menu>
							}
						>
							<Button
								size="small"
								variant="outlined"
								icon="caret-down"
								aria-label="Select shortcut"
								disabled={Boolean(runningShortcutLabel)}
							/>
						</Popover>
					</ButtonGroup>
				) : null}
				{onToggleTerminal ? (
					<Tooltip
						placement="bottom"
						content={
							<span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
								<span>Toggle terminal</span>
								<span style={{ display: "inline-flex", alignItems: "center", gap: 2, whiteSpace: "nowrap" }}>
									<span>(</span>
									<Icon icon={terminalShortcutIcon} size={11} />
									<span>+ J)</span>
								</span>
							</span>
						}
					>
						<Button
							icon="console"
							size="small"
							variant="minimal"
							onClick={onToggleTerminal}
							disabled={Boolean(isTerminalLoading)}
							aria-label={isTerminalOpen ? "Close terminal" : "Open terminal"}
							style={{ marginLeft: 8 }}
						/>
					</Tooltip>
				) : null}
				<Tooltip placement="bottom" content="Keyboard shortcuts">
					<Button
						icon="key-command"
						size="small"
						variant="minimal"
						onClick={onOpenKeyboardShortcuts}
						aria-label="Keyboard shortcuts"
						style={{ marginLeft: 5 }}
					/>
				</Tooltip>
				<Button
					icon="cog"
					size="small"
					variant="minimal"
					onClick={() => onOpenSettings?.()}
					aria-label="Settings"
					data-testid="open-settings-button"
					style={{ marginLeft: 2, marginRight: 2 }}
				/>
			</NavbarGroup>
		</Navbar>
	);
}
