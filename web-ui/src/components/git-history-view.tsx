import { GitBranch, Trash2 } from "lucide-react";
import { useState } from "react";

import { GitCommitDiffPanel } from "@/components/git-history/git-commit-diff-panel";
import { GitCommitListPanel } from "@/components/git-history/git-commit-list-panel";
import { GitRefsPanel } from "@/components/git-history/git-refs-panel";
import type { UseGitHistoryDataResult } from "@/components/git-history/use-git-history-data";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeGitCommit } from "@/runtime/types";

function CommitDiffHeader({ commit }: { commit: RuntimeGitCommit }): React.ReactElement {
	return (
		<div
			style={{
				padding: "10px 12px",
				borderBottom: "1px solid var(--color-divider)",
				background: "var(--color-surface-1)",
			}}
		>
			<div
				style={{
					fontSize: 14,
					color: "var(--color-text-primary)",
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
					fontSize: 10,
					color: "var(--color-text-tertiary)",
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
				<code className="font-mono">{commit.shortHash}</code>
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
			<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary" style={{ flex: 1, background: "var(--color-surface-0)" }}>
				<GitBranch size={48} />
				<h3 className="font-semibold text-text-primary">No project selected</h3>
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flex: "1 1 0", minHeight: 0, overflow: "hidden", background: "var(--color-surface-0)" }}>
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
			<div style={{ width: 1, background: "var(--color-divider)", flexShrink: 0 }} />
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
			<div style={{ width: 1, background: "var(--color-divider)", flexShrink: 0 }} />
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
								borderBottom: "1px solid var(--color-border)",
								fontSize: 14,
								color: "var(--color-text-primary)",
							}}
						>
							<span style={{ flex: 1 }}>Working Copy Changes</span>
							{onDiscardWorkingChanges ? (
								<Button
									variant="danger"
									size="sm"
									icon={<Trash2 size={14} />}
									aria-label="Discard all changes"
									disabled={isDiscardWorkingChangesPending}
									onClick={() => setIsDiscardAlertOpen(true)}
								>
									{isDiscardWorkingChangesPending ? <Spinner size={14} /> : null}
								</Button>
							) : null}
						</div>
					) : null
				}
			/>
			<AlertDialog
				open={isDiscardAlertOpen}
				onOpenChange={(open) => { if (!open) setIsDiscardAlertOpen(false); }}
			>
				<AlertDialogTitle className="text-sm font-semibold text-text-primary">
					Discard all changes?
				</AlertDialogTitle>
				<AlertDialogDescription className="text-text-secondary mt-2">
					Are you sure you want to discard all working copy changes? This cannot be undone.
				</AlertDialogDescription>
				<div className="flex justify-end gap-2 mt-4">
					<AlertDialogCancel asChild>
						<Button
							variant="default"
							onClick={() => setIsDiscardAlertOpen(false)}
							disabled={isDiscardWorkingChangesPending}
						>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							disabled={isDiscardWorkingChangesPending}
							onClick={() => {
								setIsDiscardAlertOpen(false);
								onDiscardWorkingChanges?.();
							}}
						>
							{isDiscardWorkingChangesPending ? <Spinner size={14} /> : null}
							Discard All
						</Button>
					</AlertDialogAction>
				</div>
			</AlertDialog>
		</div>
	);
}
