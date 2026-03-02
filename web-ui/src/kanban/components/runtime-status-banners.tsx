import { Button, Callout } from "@blueprintjs/core";
import type { ReactElement } from "react";

export function RuntimeStatusBanners({
	worktreeError,
	onDismissWorktreeError,
}: {
	worktreeError: string | null;
	onDismissWorktreeError: () => void;
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
		</>
	);
}
