import { Alert, Button, Colors, NonIdealState } from "@blueprintjs/core";
import { useState } from "react";

import { GitCommitDiffPanel } from "@/kanban/components/git-history/git-commit-diff-panel";
import { GitCommitListPanel } from "@/kanban/components/git-history/git-commit-list-panel";
import { GitRefsPanel } from "@/kanban/components/git-history/git-refs-panel";
import type { UseGitHistoryDataResult } from "@/kanban/components/git-history/use-git-history-data";
import { panelSeparatorColor } from "@/kanban/data/column-colors";
import type { RuntimeGitCommit } from "@/kanban/runtime/types";

function CommitDiffHeader({ commit }: { commit: RuntimeGitCommit }): React.ReactElement {
	return (
		<div
			style={{
				padding: "10px 12px",
				borderBottom: `1px solid ${panelSeparatorColor}`,
				background: Colors.DARK_GRAY2,
			}}
		>
			<div
				style={{
					fontSize: "var(--bp-typography-size-body-medium)",
					color: "var(--bp-palette-light-gray-5)",
					marginBottom: 4,
					lineHeight: 1.4,
				}}
			>
				{commit.message}
			</div>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 8,
					fontSize: "var(--bp-typography-size-body-x-small)",
					color: "var(--bp-palette-gray-3)",
				}}
			>
				<span>{commit.authorName}</span>
				<span>
					{new Date(commit.date).toLocaleDateString(undefined, {
						year: "numeric",
						month: "short",
						day: "numeric",
					})}
				</span>
				<code style={{ fontFamily: "var(--bp-font-family-monospace)" }}>{commit.shortHash}</code>
			</div>
		</div>
	);
}

interface GitHistoryViewProps {
	workspaceId: string | null;
	gitHistory: UseGitHistoryDataResult;
	onCheckoutBranch?: (branch: string) => void;
	onDiscardWorkingChanges?: () => void;
	isDiscardWorkingChangesPending?: boolean;
}

export function GitHistoryView({
	workspaceId,
	gitHistory,
	onCheckoutBranch,
	onDiscardWorkingChanges,
	isDiscardWorkingChangesPending = false,
}: GitHistoryViewProps): React.ReactElement {
	const [isDiscardAlertOpen, setIsDiscardAlertOpen] = useState(false);

	if (!workspaceId) {
		return (
			<div className="kb-empty-state-center" style={{ flex: 1, background: Colors.DARK_GRAY1 }}>
				<NonIdealState icon="git-branch" title="No project selected" />
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden", background: Colors.DARK_GRAY1 }}>
			<GitRefsPanel
				refs={gitHistory.refs}
				selectedRefName={gitHistory.viewMode === "working-copy" ? null : (gitHistory.activeRef?.name ?? null)}
				isLoading={gitHistory.isRefsLoading}
				errorMessage={gitHistory.refsErrorMessage}
				workingCopyChanges={gitHistory.hasWorkingCopy ? gitHistory.workingCopyFileCount : null}
				isWorkingCopySelected={gitHistory.viewMode === "working-copy"}
				onSelectRef={gitHistory.selectRef}
				onSelectWorkingCopy={gitHistory.hasWorkingCopy ? gitHistory.selectWorkingCopy : undefined}
				onCheckoutRef={onCheckoutBranch}
			/>
			<div style={{ width: 1, background: panelSeparatorColor, flexShrink: 0 }} />
			<GitCommitListPanel
				commits={gitHistory.commits}
				totalCount={gitHistory.totalCommitCount}
				selectedCommitHash={gitHistory.viewMode === "commit" ? gitHistory.selectedCommitHash : null}
				isLoading={gitHistory.isLogLoading}
				isLoadingMore={gitHistory.isLoadingMoreCommits}
				canLoadMore={gitHistory.commits.length < gitHistory.totalCommitCount}
				errorMessage={gitHistory.logErrorMessage}
				refs={gitHistory.refs}
				onSelectCommit={gitHistory.selectCommit}
				onLoadMore={gitHistory.loadMoreCommits}
			/>
			<div style={{ width: 1, background: panelSeparatorColor, flexShrink: 0 }} />
			<GitCommitDiffPanel
				diffSource={gitHistory.diffSource}
				isLoading={gitHistory.isDiffLoading}
				errorMessage={gitHistory.diffErrorMessage}
				selectedPath={gitHistory.selectedDiffPath}
				onSelectPath={gitHistory.selectDiffPath}
				headerContent={
					gitHistory.viewMode === "commit" && gitHistory.selectedCommit ? (
						<CommitDiffHeader commit={gitHistory.selectedCommit} />
					) : gitHistory.viewMode === "working-copy" ? (
						<div
							className="kb-git-working-copy-header"
							style={{
								display: "flex",
								alignItems: "center",
								padding: "10px 12px",
								borderBottom: `1px solid ${panelSeparatorColor}`,
								fontSize: "var(--bp-typography-size-body-medium)",
								color: "var(--bp-palette-light-gray-5)",
							}}
						>
							<span style={{ flex: 1 }}>Working Copy Changes</span>
							{onDiscardWorkingChanges ? (
								<Button
									icon="trash"
									variant="minimal"
									size="small"
									intent="danger"
									aria-label="Discard all changes"
									disabled={isDiscardWorkingChangesPending}
									loading={isDiscardWorkingChangesPending}
									onClick={() => setIsDiscardAlertOpen(true)}
								/>
							) : null}
						</div>
					) : null
				}
			/>
			<Alert
				isOpen={isDiscardAlertOpen}
				cancelButtonText="Cancel"
				confirmButtonText="Discard All"
				icon="trash"
				intent="danger"
				loading={isDiscardWorkingChangesPending}
				canEscapeKeyCancel
				canOutsideClickCancel
				onCancel={() => setIsDiscardAlertOpen(false)}
				onConfirm={() => {
					setIsDiscardAlertOpen(false);
					onDiscardWorkingChanges?.();
				}}
			>
				<p>Are you sure you want to discard all working copy changes? This cannot be undone.</p>
			</Alert>
		</div>
	);
}
