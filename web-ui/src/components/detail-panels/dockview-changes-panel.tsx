// ── Dockview panel: Changes (DiffToolbar + DiffViewer + FileTree) ──

import { GitCompareArrows, PanelRight } from "lucide-react";
import { DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { cn } from "@/components/ui/cn";
import type { RuntimeWorkspaceChangesMode } from "@/runtime/types";
import { useDetailPanelContext } from "./detail-panel-context";

const FILE_TREE_PANEL_FLEX = "0 0 33.3333%";

function WorkspaceChangesLoadingPanel(): React.ReactElement {
	return (
		<div style={{ display: "flex", flex: "1 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
			<div
				style={{
					display: "flex",
					flex: "1 1 0",
					flexDirection: "column",
					borderRight: "1px solid var(--color-divider)",
				}}
			>
				<div style={{ padding: "10px 10px 6px" }}>
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
						<div className="kb-skeleton" style={{ height: 14, width: "62%", borderRadius: 3 }} />
						<div className="kb-skeleton" style={{ height: 16, width: 42, borderRadius: 999 }} />
					</div>
					<div className="kb-skeleton" style={{ height: 13, width: "92%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "84%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "95%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "79%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "88%", borderRadius: 3, marginBottom: 7 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "76%", borderRadius: 3 }} />
				</div>
				<div style={{ flex: "1 1 0" }} />
			</div>
			<div
				style={{
					display: "flex",
					flex: FILE_TREE_PANEL_FLEX,
					flexDirection: "column",
					padding: "10px 8px",
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className="kb-skeleton" style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "61%", borderRadius: 3 }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className="kb-skeleton" style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "70%", borderRadius: 3 }} />
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}>
					<div className="kb-skeleton" style={{ height: 12, width: 12, borderRadius: 2 }} />
					<div className="kb-skeleton" style={{ height: 13, width: "53%", borderRadius: 3 }} />
				</div>
				<div style={{ flex: "1 1 0" }} />
			</div>
		</div>
	);
}

function WorkspaceChangesEmptyPanel({ title }: { title: string }): React.ReactElement {
	return (
		<div style={{ display: "flex", flex: "1 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
			<div className="kb-empty-state-center" style={{ flex: 1 }}>
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
		<div
			className="flex items-center px-2"
			style={{
				height: 38,
				backgroundColor: "var(--color-surface-0)",
				borderBottom: "1px solid color-mix(in srgb, var(--color-divider) 50%, transparent)",
			}}
		>
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
					"ml-auto flex items-center justify-center rounded-md w-6 h-6 cursor-pointer transition-colors",
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

export function DockviewChangesPanel() {
	const ctx = useDetailPanelContext();

	return (
		<div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
			{ctx.isRuntimeAvailable ? (
				<DiffToolbar
					mode={ctx.diffMode}
					onModeChange={ctx.setDiffMode}
					isFileTreeVisible={ctx.isFileTreeVisible}
					onToggleFileTree={ctx.handleToggleFileTree}
				/>
			) : null}
			<div style={{ display: "flex", flex: "1 1 0", minHeight: 0 }}>
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
								panelFlex={FILE_TREE_PANEL_FLEX}
							/>
						)}
					</>
				)}
			</div>
		</div>
	);
}
