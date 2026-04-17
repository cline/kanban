import { FileText, Folder, FolderOpen } from "lucide-react";
import { useMemo } from "react";
import type { RuntimeWorkspaceFileChange } from "@/runtime/types";
import { buildFileTree, type FileTreeNode } from "@/utils/file-tree";

interface FileDiffStats {
	added: number;
	removed: number;
}

function FileTreeRow({
	node,
	depth,
	selectedPath,
	onSelectPath,
	diffStatsByPath,
}: {
	node: FileTreeNode;
	depth: number;
	selectedPath: string | null;
	onSelectPath: (path: string) => void;
	diffStatsByPath: Record<string, FileDiffStats>;
}): React.ReactElement {
	const isDirectory = node.type === "directory";
	const isSelected = !isDirectory && node.path === selectedPath;
	const fileStats = !isDirectory ? diffStatsByPath[node.path] : undefined;
	const rowClassName = `kb-file-tree-row${isDirectory ? " kb-file-tree-row-directory" : ""}${isSelected ? " kb-file-tree-row-selected" : ""}`;
	const addedStatClassName = isSelected ? "text-accent-fg" : "text-status-green";
	const removedStatClassName = isSelected ? "text-accent-fg" : "text-status-red";

	return (
		<div>
			<button
				type="button"
				className={rowClassName}
				style={{ paddingLeft: depth * 12 + 8 }}
				onClick={() => {
					if (!isDirectory) {
						onSelectPath(node.path);
					}
				}}
			>
				{isDirectory ? <Folder size={14} /> : <FileText size={14} />}
				<span className="truncate">{node.name}</span>
				{fileStats ? (
					<span className="font-mono" style={{ marginLeft: "auto", fontSize: 10, display: "flex", gap: 4 }}>
						{fileStats.added > 0 ? <span className={addedStatClassName}>+{fileStats.added}</span> : null}
						{fileStats.removed > 0 ? <span className={removedStatClassName}>-{fileStats.removed}</span> : null}
					</span>
				) : null}
			</button>
			{node.children.length > 0 ? (
				<div>
					{node.children.map((child) => (
						<FileTreeRow
							key={child.path}
							node={child}
							depth={depth + 1}
							selectedPath={selectedPath}
							onSelectPath={onSelectPath}
							diffStatsByPath={diffStatsByPath}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

export function FileTreePanel({
	workspaceFiles,
	selectedPath,
	onSelectPath,
	panelFlex,
}: {
	workspaceFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	onSelectPath: (path: string) => void;
	panelFlex?: string;
}): React.ReactElement {
	const referencedPaths = useMemo(() => {
		return workspaceFiles?.map((file) => file.path) ?? [];
	}, [workspaceFiles]);
	const tree = useMemo(() => buildFileTree(referencedPaths), [referencedPaths]);
	const diffStatsByPath = useMemo(() => {
		const stats: Record<string, FileDiffStats> = {};
		for (const file of workspaceFiles ?? []) {
			stats[file.path] = {
				added: file.additions,
				removed: file.deletions,
			};
		}
		return stats;
	}, [workspaceFiles]);

	return (
		<div
			style={{
				display: "flex",
				flex: panelFlex ?? "0.6 1 0",
				flexDirection: "column",
				minWidth: 0,
				minHeight: 0,
				background: "var(--color-surface-0)",
			}}
		>
			<div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 8 }}>
				{tree.length === 0 ? (
					<div className="kb-empty-state-center">
						<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
							<FolderOpen size={40} />
						</div>
					</div>
				) : (
					<div>
						{tree.map((node) => (
							<FileTreeRow
								key={node.path}
								node={node}
								depth={0}
								selectedPath={selectedPath}
								onSelectPath={onSelectPath}
								diffStatsByPath={diffStatsByPath}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
