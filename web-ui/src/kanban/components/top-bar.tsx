import { ArrowLeft, Settings } from "lucide-react";

import type { RuntimeProjectShortcut } from "@/kanban/runtime/types";

function getWorkspacePathSegments(path: string): string[] {
	return path.replaceAll("\\", "/").split("/").filter((segment) => segment.length > 0);
}

export function TopBar({
	onBack,
	subtitle,
	workspacePath,
	runtimeHint,
	onOpenSettings,
	shortcuts,
	runningShortcutId,
	onRunShortcut,
}: {
	onBack?: () => void;
	subtitle?: string;
	workspacePath?: string;
	runtimeHint?: string;
	onOpenSettings?: () => void;
	shortcuts?: RuntimeProjectShortcut[];
	runningShortcutId?: string | null;
	onRunShortcut?: (shortcutId: string) => void;
}): React.ReactElement {
	const workspaceSegments = workspacePath ? getWorkspacePathSegments(workspacePath) : [];
	const isAbsolutePath = Boolean(workspacePath && (workspacePath.startsWith("/") || workspacePath.startsWith("\\")));

	return (
		<header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
			<div className="flex min-w-0 items-center gap-2">
				{onBack ? (
					<button
						type="button"
						onClick={onBack}
						className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
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
						<span className="text-zinc-600">/</span>
						<span className="text-sm font-medium text-zinc-400">{subtitle}</span>
					</>
				) : null}
				{workspacePath ? (
					<>
						<span className="text-zinc-700">|</span>
						<div
							className="min-w-0 max-w-[40rem] truncate font-mono text-xs text-zinc-500"
							title={workspacePath}
							data-testid="workspace-path"
						>
							<span>{isAbsolutePath ? "/" : ""}</span>
							{workspaceSegments.map((segment, index) => {
								const isLast = index === workspaceSegments.length - 1;
								return (
									<span key={`${segment}-${index}`}>
										{index === 0 ? "" : "/"}
										<span className={isLast ? "text-zinc-100" : "text-zinc-500"}>{segment}</span>
									</span>
								);
							})}
						</div>
					</>
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
						className="rounded-md border border-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-600"
						disabled={runningShortcutId === shortcut.id}
					>
						{runningShortcutId === shortcut.id ? `Running ${shortcut.label}...` : shortcut.label}
					</button>
				))}
				<button
					type="button"
					onClick={onOpenSettings}
					className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
					aria-label="Settings"
					data-testid="open-settings-button"
				>
					<Settings className="size-4" />
				</button>
			</div>
		</header>
	);
}
