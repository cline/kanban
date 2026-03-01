import { Classes, Colors, Icon, NonIdealState } from "@blueprintjs/core";
import { useMemo } from "react";

import {
	buildFileTree,
	type FileTreeNode,
} from "@/kanban/utils/file-tree";
import type { RuntimeWorkspaceFileChange } from "@/kanban/runtime/types";

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
				<Icon icon={isDirectory ? "folder-close" : "document"} size={14} />
				<span className={Classes.TEXT_OVERFLOW_ELLIPSIS}>{node.name}</span>
				{fileStats ? (
					<span className={Classes.MONOSPACE_TEXT} style={{ marginLeft: "auto", fontSize: 10, display: "flex", gap: 4 }}>
						{fileStats.added > 0 ? <span style={{ color: Colors.GREEN5 }}>+{fileStats.added}</span> : null}
						{fileStats.removed > 0 ? <span style={{ color: Colors.RED5 }}>-{fileStats.removed}</span> : null}
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
}: {
	workspaceFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	onSelectPath: (path: string) => void;
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
		<div style={{ display: "flex", flex: "0.6 1 0", flexDirection: "column", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1 }}>
			<div style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 8 }}>
				{tree.length === 0 ? (
					<div className="kb-empty-state-center">
						<NonIdealState icon="folder-open" />
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
