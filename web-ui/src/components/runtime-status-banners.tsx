import type { ReactElement } from "react";

export function RuntimeStatusBanners({
	worktreeError: _worktreeError,
	onDismissWorktreeError: _onDismissWorktreeError,
}: {
	worktreeError: string | null;
	onDismissWorktreeError: () => void;
}): ReactElement | null {
	// FIXME: remove this component. Sometimes moving to trash triggers a transient
	// worktree error during cleanup that briefly flashes then disappears. Need to
	// investigate the root cause in the cleanup flow rather than showing a banner.
	// return (
	// 	<>
	// 		{worktreeError ? (
	// 			<div className="kb-status-banner">
	// 				<Callout intent="danger" compact>
	// 					<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
	// 						<span>{worktreeError}</span>
	// 						<Button variant="minimal" size="small" text="Dismiss" onClick={onDismissWorktreeError} />
	// 					</div>
	// 				</Callout>
	// 			</div>
	// 		) : null}
	// 	</>
	// );
	return <></>;
}
