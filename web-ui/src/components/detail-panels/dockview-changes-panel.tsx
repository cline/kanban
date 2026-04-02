// ── Dockview panel: Changes (DiffToolbar + DiffViewer + FileTree) ──

import { ChevronLeft, ChevronRight, GitCompareArrows } from "lucide-react";
import { type DiffLineComment, DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { Button } from "@/components/ui/button";
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
		<div className="flex items-center gap-1 px-2 py-1" style={{ borderBottom: "1px solid var(--color-divider)" }}>
			<div className="inline-flex items-center gap-0.5 rounded-md p-0.5">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onModeChange("working_copy")}
					className="h-5 rounded-sm text-xs"
					style={
						mode === "working_copy"
							? { backgroundColor: "var(--color-surface-3)", color: "var(--color-text-primary)" }
							: undefined
					}
				>
					All Changes
				</Button>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => onModeChange("last_turn")}
					className="h-5 rounded-sm text-xs"
					style={
						mode === "last_turn"
							? { backgroundColor: "var(--color-surface-3)", color: "var(--color-text-primary)" }
							: undefined
					}
				>
					Last Turn
				</Button>
			</div>
			<Button
				variant="ghost"
				size="sm"
				icon={isFileTreeVisible ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
				onClick={onToggleFileTree}
				className="ml-auto h-5"
				aria-label={isFileTreeVisible ? "Hide file tree" : "Show file tree"}
			/>
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
