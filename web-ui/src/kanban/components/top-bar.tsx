import { ArrowLeft, Settings } from "lucide-react";

import type { RuntimeProjectShortcut } from "@/kanban/runtime/types";

function getWorkspacePathSegments(path: string): string[] {
	return path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
}

export function TopBar({
	onBack,
	subtitle,
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
	subtitle?: string;
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
		<header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-nav px-4">
			<div className="flex min-w-0 items-center gap-2">
				{onBack ? (
					<button
						type="button"
						onClick={onBack}
						className="rounded-md p-1 text-muted-foreground hover:bg-card hover:text-foreground"
						aria-label="Back to board"
					>
						<ArrowLeft className="size-4" />
					</button>
				) : null}
				<span className="text-lg" role="img" aria-label="banana">
					🍌
				</span>
				<span className="text-base font-semibold tracking-tight text-amber-300">Kanbanana</span>
				{subtitle ? (
					<>
						<span className="text-muted-foreground/80">/</span>
						<span className="text-sm font-medium text-muted-foreground">{subtitle}</span>
					</>
				) : null}
				{workspacePath ? (
					<>
						<span className="text-muted-foreground/80">|</span>
						<div
							className="min-w-0 max-w-[40rem] truncate font-mono text-xs text-muted-foreground"
							title={workspacePath}
							data-testid="workspace-path"
						>
							<span>{isAbsolutePath ? "/" : ""}</span>
							{workspaceSegments.map((segment, index) => {
								const isLast = index === workspaceSegments.length - 1;
								return (
									<span key={`${segment}-${index}`}>
										{index === 0 ? "" : "/"}
										<span className={isLast ? "text-foreground" : "text-muted-foreground"}>{segment}</span>
									</span>
								);
							})}
						</div>
					</>
				) : null}
				{workspaceHint ? (
					<span className="ml-2 rounded border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground">
						{workspaceHint}
					</span>
				) : null}
				{repoHint ? (
					<span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
						{repoHint}
					</span>
				) : null}
				{runtimeHint ? (
					<span className="ml-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-300">
						{runtimeHint}
					</span>
				) : null}
			</div>
			<div className="flex items-center gap-2">
				{shortcuts?.map((shortcut) => (
					<button
						key={shortcut.id}
						type="button"
						onClick={() => onRunShortcut?.(shortcut.id)}
						className="rounded-md border border-border px-2 py-1 text-xs text-foreground hover:border-muted-foreground/80"
						disabled={runningShortcutId === shortcut.id}
					>
						{runningShortcutId === shortcut.id ? `Running ${shortcut.label}...` : shortcut.label}
					</button>
				))}
				<button
					type="button"
					onClick={onOpenSettings}
					className="rounded-md p-1.5 text-muted-foreground hover:bg-card hover:text-foreground"
					aria-label="Settings"
					data-testid="open-settings-button"
				>
					<Settings className="size-4" />
				</button>
			</div>
		</header>
	);
}
