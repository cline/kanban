// ── Panel: Changes (DiffToolbar + DiffViewer + FileTree) ──

import { GitCompareArrows, PanelRight } from "lucide-react";
import { DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { cn } from "@/components/ui/cn";
import type { RuntimeWorkspaceChangesMode } from "@/runtime/types";
import { useCardDetailContext } from "./card-detail-context";

function SkeletonLine({ width }: { width: string }): React.ReactElement {
	return <div className="kb-skeleton h-3 rounded-sm" style={{ width }} />;
}

function SkeletonFileRow({ width }: { width: string }): React.ReactElement {
	return (
		<div className="flex items-center gap-2 px-2 py-1.5">
			<div className="kb-skeleton size-3 rounded-sm" />
			<div className="kb-skeleton h-3 rounded-sm" style={{ width }} />
		</div>
	);
}

function WorkspaceChangesLoadingPanel(): React.ReactElement {
	return (
		<div className="flex flex-1 min-w-0 min-h-0 bg-surface-0">
			<div className="flex flex-1 flex-col border-r border-divider">
				<div className="px-2.5 pt-2.5 pb-1.5">
					<div className="flex items-center gap-2 mb-2.5">
						<div className="kb-skeleton h-3.5 w-3/5 rounded-sm" />
						<div className="kb-skeleton h-4 w-10 rounded-full" />
					</div>
					<div className="flex flex-col gap-1.5">
						<SkeletonLine width="92%" />
						<SkeletonLine width="84%" />
						<SkeletonLine width="95%" />
						<SkeletonLine width="79%" />
						<SkeletonLine width="88%" />
						<SkeletonLine width="76%" />
					</div>
				</div>
				<div className="flex-1" />
			</div>
			<div className="flex shrink-0 basis-1/3 flex-col px-2 py-2.5">
				<SkeletonFileRow width="61%" />
				<SkeletonFileRow width="70%" />
				<SkeletonFileRow width="53%" />
				<div className="flex-1" />
			</div>
		</div>
	);
}

function WorkspaceChangesEmptyPanel({ title }: { title: string }): React.ReactElement {
	return (
		<div className="flex flex-1 min-w-0 min-h-0 bg-surface-0">
			<div className="kb-empty-state-center flex-1">
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
					<GitCompareArrows size={40} />
					<h3 className="font-semibold text-text-secondary">{title}</h3>
				</div>
			</div>
		</div>
	);
}

function DiffToolbar({
	mode,
	onModeChange,
	isFileTreeVisible,
	onToggleFileTree,
}: {
	mode: RuntimeWorkspaceChangesMode;
	onModeChange: (mode: RuntimeWorkspaceChangesMode) => void;
	isFileTreeVisible: boolean;
	onToggleFileTree: () => void;
}): React.ReactElement {
	return (
		<div className="flex h-9.5 items-center bg-surface-0 border-b border-divider/50 px-2">
			<div className="inline-flex items-center rounded-md bg-surface-2/50 p-0.5">
				{(
					[
						{ key: "working_copy", label: "All Changes" },
						{ key: "last_turn", label: "Last Turn" },
					] as const
				).map(({ key, label }) => (
					<button
						key={key}
						type="button"
						onClick={() => onModeChange(key)}
						className={cn(
							"rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer select-none transition-colors",
							mode === key
								? "bg-surface-3 text-text-primary shadow-[0_1px_2px_rgba(0,0,0,0.15)]"
								: "text-text-secondary hover:text-text-primary",
						)}
					>
						{label}
					</button>
				))}
			</div>

			<button
				type="button"
				onClick={onToggleFileTree}
				className={cn(
					"ml-auto flex items-center justify-center rounded-md size-6 cursor-pointer transition-colors",
					isFileTreeVisible
						? "text-accent hover:bg-surface-3"
						: "text-text-tertiary hover:text-text-secondary hover:bg-surface-3",
				)}
				aria-label={isFileTreeVisible ? "Hide file tree" : "Show file tree"}
				title={isFileTreeVisible ? "Hide file tree" : "Show file tree"}
			>
				<PanelRight size={14} />
			</button>
		</div>
	);
}

export function ChangesPanel() {
	const ctx = useCardDetailContext();

	return (
		<div className="flex flex-col h-full min-h-0">
			{ctx.isRuntimeAvailable ? (
				<DiffToolbar
					mode={ctx.diffMode}
					onModeChange={ctx.setDiffMode}
					isFileTreeVisible={ctx.isFileTreeVisible}
					onToggleFileTree={ctx.handleToggleFileTree}
				/>
			) : null}
			<div className="flex flex-1 min-h-0">
				{ctx.isWorkspaceChangesPending ? (
					<WorkspaceChangesLoadingPanel />
				) : ctx.hasNoWorkspaceFileChanges ? (
					<WorkspaceChangesEmptyPanel title={ctx.emptyDiffTitle} />
				) : (
					<>
						<DiffViewerPanel
							workspaceFiles={ctx.isRuntimeAvailable ? ctx.runtimeFiles : null}
							selectedPath={ctx.selectedPath}
							onSelectedPathChange={ctx.setSelectedPath}
							viewMode="unified"
							onAddToTerminal={
								ctx.onAddReviewComments || ctx.showClineAgentChatPanel ? ctx.handleAddDiffComments : undefined
							}
							onSendToTerminal={
								ctx.onSendReviewComments || ctx.showClineAgentChatPanel ? ctx.handleSendDiffComments : undefined
							}
							comments={ctx.diffComments}
							onCommentsChange={ctx.setDiffComments}
						/>
						{ctx.isFileTreeVisible && (
							<FileTreePanel
								workspaceFiles={ctx.isRuntimeAvailable ? ctx.runtimeFiles : null}
								selectedPath={ctx.selectedPath}
								onSelectPath={ctx.setSelectedPath}
								panelFlex="0 0 33.3333%"
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
}
