import {
	Alignment,
	Button,
	ButtonGroup,
	Classes,
	Colors,
	Icon,
	Navbar,
	NavbarDivider,
	NavbarGroup,
	Tag,
	Tooltip,
} from "@blueprintjs/core";

import { OpenWorkspaceButton } from "@/kanban/components/open-workspace-button";
import type { RuntimeGitSyncAction, RuntimeGitSyncSummary, RuntimeProjectShortcut } from "@/kanban/runtime/types";
import type { OpenTargetId, OpenTargetOption } from "@/kanban/utils/open-targets";
import { formatPathForDisplay } from "@/kanban/utils/path-display";

function getWorkspacePathSegments(path: string): string[] {
	return path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
}

export function TopBar({
	onBack,
	workspacePath,
	isWorkspacePathLoading = false,
	workspaceHint,
	repoHint,
	runtimeHint,
	gitSummary,
	runningGitAction,
	onGitFetch,
	onGitPull,
	onGitPush,
	onToggleTerminal,
	isTerminalOpen,
	isTerminalLoading,
	onOpenSettings,
	shortcuts,
	runningShortcutId,
	onRunShortcut,
	openTargetOptions,
	selectedOpenTargetId,
	onSelectOpenTarget,
	onOpenWorkspace,
	canOpenWorkspace,
	isOpeningWorkspace,
}: {
	onBack?: () => void;
	workspacePath?: string;
	isWorkspacePathLoading?: boolean;
	workspaceHint?: string;
	repoHint?: string;
	runtimeHint?: string;
	gitSummary?: RuntimeGitSyncSummary | null;
	runningGitAction?: RuntimeGitSyncAction | null;
	onGitFetch?: () => void;
	onGitPull?: () => void;
	onGitPush?: () => void;
	onToggleTerminal?: () => void;
	isTerminalOpen?: boolean;
	isTerminalLoading?: boolean;
	onOpenSettings?: () => void;
	shortcuts?: RuntimeProjectShortcut[];
	runningShortcutId?: string | null;
	onRunShortcut?: (shortcutId: string) => void;
	openTargetOptions: readonly OpenTargetOption[];
	selectedOpenTargetId: OpenTargetId;
	onSelectOpenTarget: (targetId: OpenTargetId) => void;
	onOpenWorkspace: () => void;
	canOpenWorkspace: boolean;
	isOpeningWorkspace: boolean;
}): React.ReactElement {
	const displayWorkspacePath = workspacePath ? formatPathForDisplay(workspacePath) : null;
	const workspaceSegments = displayWorkspacePath ? getWorkspacePathSegments(displayWorkspacePath) : [];
	const hasAbsoluteLeadingSlash = Boolean(displayWorkspacePath?.startsWith("/"));
	const hasGitSummary = Boolean(gitSummary?.hasGit);
	const branchLabel = gitSummary?.currentBranch ?? "detached HEAD";
	const changedFileCount = gitSummary?.changedFiles ?? 0;
	const fileLabel = changedFileCount === 1 ? "file" : "files";
	const pullCount = gitSummary?.behindCount ?? 0;
	const pushCount = gitSummary?.aheadCount ?? 0;
	const pullTooltip = pullCount > 0
		? `Pull ${pullCount} commit${pullCount === 1 ? "" : "s"} from upstream into your local branch.`
		: "Pull from upstream. Branch is already up to date.";
	const pushTooltip = pushCount > 0
		? `Push ${pushCount} local commit${pushCount === 1 ? "" : "s"} to upstream.`
		: "Push local commits to upstream. No local commits are pending.";
	const isMacPlatform = typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
	const terminalShortcutIcon = isMacPlatform ? "key-command" : "key-control";

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
				{workspaceHint ? (
					<Tag minimal className="kb-navbar-tag">{workspaceHint}</Tag>
				) : null}
				{repoHint ? (
					<Tag minimal intent="warning" className="kb-navbar-tag">{repoHint}</Tag>
				) : null}
				{runtimeHint ? (
					<Tag minimal intent="warning" className="kb-navbar-tag">{runtimeHint}</Tag>
				) : null}
				{hasGitSummary ? (
					<>
						<NavbarDivider />
						<span
							className={Classes.MONOSPACE_TEXT}
							style={{ fontSize: "var(--bp-typography-size-body-small)", color: Colors.GRAY4, marginRight: 4 }}
						>
							<Icon icon="git-branch" size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
							<span style={{ color: Colors.LIGHT_GRAY5 }}>{branchLabel}</span>
							{changedFileCount > 0 ? (
								<span style={{ marginLeft: 6 }}>
									<span style={{ color: Colors.GRAY3 }}>({changedFileCount} {fileLabel}</span>
									<span style={{ color: Colors.GREEN4 }}> +{gitSummary?.additions ?? 0}</span>
									<span style={{ color: Colors.RED4 }}> -{gitSummary?.deletions ?? 0}</span>
									<span style={{ color: Colors.GRAY3 }}>)</span>
								</span>
							) : null}
						</span>
						<ButtonGroup>
							<Tooltip placement="bottom" content="Fetch latest refs from upstream without changing your local branch or files.">
								<Button
									icon={<Icon icon="circle-arrow-down" size={18} />}
									variant="minimal"
									onClick={onGitFetch}
									loading={runningGitAction === "fetch"}
									aria-label="Fetch from upstream"
								/>
							</Tooltip>
							<Tooltip placement="bottom" content={pullTooltip}>
								<Button
									icon="download"
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
									text={<span style={{ color: Colors.GRAY3 }}>{pushCount}</span>}
									variant="minimal"
									onClick={onGitPush}
									loading={runningGitAction === "push"}
									aria-label="Push to upstream"
								/>
							</Tooltip>
						</ButtonGroup>
					</>
				) : null}
			</NavbarGroup>
			<NavbarGroup align={Alignment.RIGHT} style={{ height: 40, paddingRight: 2 }}>
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
							variant="minimal"
							onClick={onToggleTerminal}
							disabled={Boolean(isTerminalLoading)}
							aria-label={isTerminalOpen ? "Close terminal" : "Open terminal"}
						/>
					</Tooltip>
				) : null}
				{shortcuts?.map((shortcut) => (
					<Button
						key={shortcut.id}
						variant="outlined"
						size="small"
						text={runningShortcutId === shortcut.id ? `Running ${shortcut.label}...` : shortcut.label}
						onClick={() => onRunShortcut?.(shortcut.id)}
						disabled={runningShortcutId === shortcut.id}
					/>
				))}
				<Button
					icon="cog"
					variant="minimal"
					onClick={onOpenSettings}
					aria-label="Settings"
					data-testid="open-settings-button"
				/>
			</NavbarGroup>
		</Navbar>
	);
}
