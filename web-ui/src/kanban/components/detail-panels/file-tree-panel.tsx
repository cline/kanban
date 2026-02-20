import { File, Folder } from "lucide-react";
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

	return (
		<div>
			<button
				type="button"
				onClick={() => {
					if (!isDirectory) {
						onSelectPath(node.path);
					}
				}}
				className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
					isSelected
						? "cursor-pointer bg-card text-foreground"
						: isDirectory
							? "cursor-default text-muted-foreground"
							: "cursor-pointer text-muted-foreground hover:bg-card hover:text-foreground"
				}`}
				style={{ paddingLeft: `${depth * 0.75 + 0.5}rem` }}
			>
				{isDirectory ? <Folder className="size-3.5 shrink-0" /> : <File className="size-3.5 shrink-0" />}
				<span className="truncate">{node.name}</span>
				{fileStats ? (
					<span className="ml-auto flex items-center gap-1 font-mono text-[10px]">
						{fileStats.added > 0 ? <span className="text-emerald-400">+{fileStats.added}</span> : null}
						{fileStats.removed > 0 ? <span className="text-red-400">-{fileStats.removed}</span> : null}
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
		<div className="flex min-h-0 min-w-0 flex-[0.6] flex-col bg-background">
			<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
				{tree.length === 0 ? (
					<div className="flex h-full items-center justify-center px-3 text-center">
						<p className="text-sm text-muted-foreground/80">Changed files will appear here.</p>
					</div>
				) : (
					<div className="space-y-0.5">
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
