import type { ReactElement } from "react";

import type { RuntimeShortcutRunResponse } from "@/kanban/runtime/types";

export interface ShortcutOutputState {
	label: string;
	result: RuntimeShortcutRunResponse;
}

export function RuntimeStatusBanners({
	worktreeError,
	onDismissWorktreeError,
	shortcutOutput,
	onClearShortcutOutput,
}: {
	worktreeError: string | null;
	onDismissWorktreeError: () => void;
	shortcutOutput: ShortcutOutputState | null;
	onClearShortcutOutput: () => void;
}): ReactElement {
	return (
		<>
			{worktreeError ? (
				<div className="border-b border-border bg-background px-4 py-2">
					<div className="flex items-center justify-between gap-3">
						<p className="text-xs text-red-300">{worktreeError}</p>
						<button
							type="button"
							onClick={onDismissWorktreeError}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Dismiss
						</button>
					</div>
				</div>
			) : null}
			{shortcutOutput ? (
				<div className="border-b border-border bg-background px-4 py-2">
					<div className="mb-1 flex items-center justify-between">
						<p className="text-xs text-muted-foreground">
							{shortcutOutput.label} finished with exit code {shortcutOutput.result.exitCode}
						</p>
						<button
							type="button"
							onClick={onClearShortcutOutput}
							className="text-xs text-muted-foreground hover:text-foreground"
						>
							Clear
						</button>
					</div>
					<pre className="max-h-32 overflow-auto rounded bg-nav p-2 text-xs text-foreground">
						{shortcutOutput.result.combinedOutput || "(no output)"}
					</pre>
				</div>
			) : null}
		</>
	);
}
