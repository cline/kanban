import { Button, Callout, Classes, Pre } from "@blueprintjs/core";
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
				<div className="kb-status-banner">
					<Callout intent="danger" compact>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
							<span>{worktreeError}</span>
							<Button variant="minimal" size="small" text="Dismiss" onClick={onDismissWorktreeError} />
						</div>
					</Callout>
				</div>
			) : null}
			{shortcutOutput ? (
				<div className="kb-status-banner">
					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
						<span className={Classes.TEXT_MUTED}>
							{shortcutOutput.label} finished with exit code {shortcutOutput.result.exitCode}
						</span>
						<Button variant="minimal" size="small" text="Clear" onClick={onClearShortcutOutput} />
					</div>
					<Pre style={{ maxHeight: 128, overflow: "auto" }}>
						{shortcutOutput.result.combinedOutput || "(no output)"}
					</Pre>
				</div>
			) : null}
		</>
	);
}
