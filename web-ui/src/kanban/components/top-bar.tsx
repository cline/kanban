import {
	Alignment,
	Button,
	Classes,
	Colors,
	Navbar,
	NavbarDivider,
	NavbarGroup,
	NavbarHeading,
	Tag,
} from "@blueprintjs/core";

import type { RuntimeProjectShortcut } from "@/kanban/runtime/types";

function getWorkspacePathSegments(path: string): string[] {
	return path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
}

export function TopBar({
	onBack,
	workspacePath,
	workspaceHint,
	repoHint,
	runtimeHint,
	onOpenSettings,
	shortcuts,
	runningShortcutId,
	onRunShortcut,
}: {
	onBack?: () => void;
	workspacePath?: string;
	workspaceHint?: string;
	repoHint?: string;
	runtimeHint?: string;
	onOpenSettings?: () => void;
	shortcuts?: RuntimeProjectShortcut[];
	runningShortcutId?: string | null;
	onRunShortcut?: (shortcutId: string) => void;
}): React.ReactElement {
	const workspaceSegments = workspacePath ? getWorkspacePathSegments(workspacePath) : [];
	const isAbsolutePath = Boolean(workspacePath && (workspacePath.startsWith("/") || workspacePath.startsWith("\\")));

	return (
		<Navbar fixedToTop={false} style={{ height: 40, minHeight: 40, background: Colors.DARK_GRAY5, boxShadow: "none" }}>
			<NavbarGroup align={Alignment.LEFT} style={{ height: 40 }}>
				{onBack ? (
					<Button icon="arrow-left" variant="minimal" onClick={onBack} aria-label="Back to board" style={{ marginLeft: -8, marginRight: 8 }} />
				) : null}
				<NavbarHeading style={{ marginRight: 8 }}>
					<span role="img" aria-label="banana">🍌</span>
				</NavbarHeading>
				{workspacePath ? (
					<>
						<NavbarDivider />
						<span
							className={`${Classes.MONOSPACE_TEXT} ${Classes.TEXT_OVERFLOW_ELLIPSIS}`}
							style={{ fontSize: 12, maxWidth: 640, color: Colors.GRAY4 }}
							title={workspacePath}
							data-testid="workspace-path"
						>
							{isAbsolutePath ? "/" : ""}
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
					</>
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
			</NavbarGroup>
			<NavbarGroup align={Alignment.RIGHT} style={{ height: 40 }}>
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
