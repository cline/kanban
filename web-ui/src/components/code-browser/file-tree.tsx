import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { FileTypeIcon, isHiddenName } from "./file-icons";

interface FileTreeEntry {
	name: string;
	path: string;
	type: "file" | "directory";
}

interface ExpandedState {
	entries: FileTreeEntry[] | null;
	isLoading: boolean;
}

function TreeItem({
	entry, depth, isSelected, isExpanded, isLoading, onClickFile, onToggleDir,
}: {
	entry: FileTreeEntry;
	depth: number;
	isSelected?: boolean;
	isExpanded?: boolean;
	isLoading?: boolean;
	onClickFile: (path: string) => void;
	onToggleDir: (path: string) => void;
}): React.ReactElement {
	const hidden = isHiddenName(entry.name);
	const isDir = entry.type === "directory";
	const paddingLeft = 8 + depth * 16;

	return (
		<button
			type="button"
			className={`flex items-center w-full text-left text-[12px] py-[3px] pr-2 hover:bg-surface-2 cursor-pointer border-0 bg-transparent ${
				isSelected ? "bg-accent/15 text-text-primary" : "text-text-secondary"
			} ${hidden ? "opacity-50" : ""}`}
			style={{ paddingLeft }}
			onClick={() => (isDir ? onToggleDir(entry.path) : onClickFile(entry.path))}
		>
			{isDir ? (
				<ChevronRight size={14} className={`shrink-0 mr-0.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
			) : (
				<span className="w-[14px] shrink-0 mr-0.5" />
			)}
			{!isDir && <FileTypeIcon name={entry.name} size={15} style={{ marginRight: 4 }} />}
			<span className="truncate">{entry.name}</span>
			{isLoading && <Spinner size={10} className="ml-1" />}
		</button>
	);
}

export function FileTree({
	workspaceId, selectedFilePath, onSelectFile,
}: {
	workspaceId: string | null;
	selectedFilePath: string | null;
	onSelectFile: (path: string) => void;
}): React.ReactElement {
	const [rootEntries, setRootEntries] = useState<FileTreeEntry[] | null>(null);
	const [isRootLoading, setIsRootLoading] = useState(false);
	const [expandedDirs, setExpandedDirs] = useState<Record<string, ExpandedState>>({});
	const loadedRef = useRef<string | null>(null);

	const loadDirectory = useCallback(async (dirPath: string): Promise<FileTreeEntry[]> => {
		if (!workspaceId) return [];
		const client = getRuntimeTrpcClient(workspaceId);
		const result = await client.workspace.listDirectory.query({ path: dirPath });
		return result.entries as FileTreeEntry[];
	}, [workspaceId]);

	useEffect(() => {
		if (!workspaceId) { setRootEntries(null); setExpandedDirs({}); return; }
		if (loadedRef.current === workspaceId) return;
		loadedRef.current = workspaceId;
		setIsRootLoading(true);
		setExpandedDirs({});
		void loadDirectory("").then((entries) => { setRootEntries(entries); setIsRootLoading(false); }).catch(() => { setRootEntries([]); setIsRootLoading(false); });
	}, [workspaceId, loadDirectory]);

	const handleToggleDir = useCallback((dirPath: string) => {
		if (expandedDirs[dirPath]) {
			setExpandedDirs((prev) => { const next = { ...prev }; delete next[dirPath]; return next; });
		} else {
			setExpandedDirs((prev) => ({ ...prev, [dirPath]: { entries: null, isLoading: true } }));
			void loadDirectory(dirPath)
				.then((entries) => setExpandedDirs((prev) => ({ ...prev, [dirPath]: { entries, isLoading: false } })))
				.catch(() => setExpandedDirs((prev) => ({ ...prev, [dirPath]: { entries: [], isLoading: false } })));
		}
	}, [expandedDirs, loadDirectory]);

	const renderEntries = useCallback((entries: FileTreeEntry[], depth: number): React.ReactElement[] => {
		return entries.map((entry) => {
			const expanded = expandedDirs[entry.path];
			const isExpanded = expanded !== undefined;
			return (
				<div key={entry.path}>
					<TreeItem entry={entry} depth={depth} isSelected={selectedFilePath === entry.path} isExpanded={isExpanded} isLoading={expanded?.isLoading} onClickFile={onSelectFile} onToggleDir={handleToggleDir} />
					{isExpanded && expanded?.entries ? renderEntries(expanded.entries, depth + 1) : null}
				</div>
			);
		});
	}, [expandedDirs, selectedFilePath, onSelectFile, handleToggleDir]);

	const treeContent = useMemo(() => {
		if (!rootEntries) return null;
		return renderEntries(rootEntries, 0);
	}, [rootEntries, renderEntries]);

	if (isRootLoading) return <div className="flex items-center justify-center p-6"><Spinner size={20} /></div>;
	if (!rootEntries || rootEntries.length === 0) return <div className="p-3 text-text-tertiary text-xs">No files found</div>;
	return <div className="overflow-auto flex-1 min-h-0">{treeContent}</div>;
}