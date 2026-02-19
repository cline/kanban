import { ArrowLeft, Settings } from "lucide-react";

import type { RuntimeProjectShortcut } from "@/kanban/runtime/types";

export function TopBar({
	onBack,
	subtitle,
	runtimeHint,
	onOpenSettings,
	shortcuts,
	runningShortcutId,
	onRunShortcut,
}: {
	onBack?: () => void;
	subtitle?: string;
	runtimeHint?: string;
	onOpenSettings?: () => void;
	shortcuts?: RuntimeProjectShortcut[];
	runningShortcutId?: string | null;
	onRunShortcut?: (shortcutId: string) => void;
}): React.ReactElement {
	return (
		<header className="flex h-12 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-4">
			<div className="flex items-center gap-2">
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
