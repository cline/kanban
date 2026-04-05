import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { FileTypeIcon, isHiddenName } from "@/components/code-browser/file-icons";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

interface FileTreeEntry {
	name: string;
	path: string;
	type: "file" | "directory";
}

interface ExpandedDirectoryState {
	entries: FileTreeEntry[] | null;
	isLoading: boolean;
}

function TreeItem({
	entry,
	depth,
	isSelected,
	isExpanded,
	isLoading,
	onClickFile,
	onToggleDirectory,
}: {
	entry: FileTreeEntry;
	depth: number;
	isSelected: boolean;
	isExpanded: boolean;
	isLoading: boolean;
	onClickFile: (path: string) => void;
	onToggleDirectory: (path: string) => void;
}): React.ReactElement {
	const isDirectory = entry.type === "directory";
	const isHidden = isHiddenName(entry.name);

	return (
		<button
			type="button"
			className={[
				"flex w-full items-center py-[3px] pr-2 text-left text-[12px] transition-colors",
				isSelected ? "bg-accent/15 text-text-primary" : "text-text-secondary hover:bg-surface-2",
				isHidden ? "opacity-50" : "",
			].join(" ")}
			style={{ paddingLeft: 8 + depth * 16 }}
			onClick={() => {
				if (isDirectory) {
					onToggleDirectory(entry.path);
					return;
				}
				onClickFile(entry.path);
			}}
		>
			{isDirectory ? (
				<ChevronRight
					size={14}
					className={["mr-0.5 shrink-0 transition-transform", isExpanded ? "rotate-90" : ""].join(" ")}
				/>
			) : (
				<span className="mr-0.5 w-[14px] shrink-0" />
			)}
			{!isDirectory ? <FileTypeIcon name={entry.name} size={15} style={{ marginRight: 4 }} /> : null}
			<span className="truncate">{entry.name}</span>
			{isLoading ? <Spinner size={10} className="ml-1" /> : null}
		</button>
	);
}

export function FileTree({
	workspaceId,
	selectedFilePath,
	onSelectFile,
}: {
	workspaceId: string | null;
	selectedFilePath: string | null;
	onSelectFile: (path: string) => void;
}): React.ReactElement {
	const [rootEntries, setRootEntries] = useState<FileTreeEntry[] | null>(null);
	const [isRootLoading, setIsRootLoading] = useState(false);
	const [expandedDirectories, setExpandedDirectories] = useState<Record<string, ExpandedDirectoryState>>({});
	const loadedWorkspaceIdRef = useRef<string | null>(null);

	const loadDirectory = useCallback(
		async (path: string): Promise<FileTreeEntry[]> => {
			if (!workspaceId) {
				return [];
			}
			const client = getRuntimeTrpcClient(workspaceId);
			const response = await client.workspace.listDirectory.query({ path });
			return response.entries;
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!workspaceId) {
			loadedWorkspaceIdRef.current = null;
			setRootEntries(null);
			setExpandedDirectories({});
			return;
		}
		if (loadedWorkspaceIdRef.current === workspaceId) {
			return;
		}

		loadedWorkspaceIdRef.current = workspaceId;
		setIsRootLoading(true);
		setExpandedDirectories({});

		void loadDirectory("")
			.then((entries) => {
				setRootEntries(entries);
			})
			.catch(() => {
				setRootEntries([]);
			})
			.finally(() => {
				setIsRootLoading(false);
			});
	}, [loadDirectory, workspaceId]);

	const handleToggleDirectory = useCallback(
		(path: string) => {
			if (expandedDirectories[path]) {
				setExpandedDirectories((current) => {
					const next = { ...current };
					delete next[path];
					return next;
				});
				return;
			}

			setExpandedDirectories((current) => ({
				...current,
				[path]: { entries: null, isLoading: true },
			}));

			void loadDirectory(path)
				.then((entries) => {
					setExpandedDirectories((current) => ({
						...current,
						[path]: { entries, isLoading: false },
					}));
				})
				.catch(() => {
					setExpandedDirectories((current) => ({
						...current,
						[path]: { entries: [], isLoading: false },
					}));
				});
		},
		[expandedDirectories, loadDirectory],
	);

	const renderEntries = useCallback(
		(entries: FileTreeEntry[], depth: number): React.ReactElement[] =>
			entries.map((entry) => {
				const expandedState = expandedDirectories[entry.path];
				const isExpanded = expandedState !== undefined;
				return (
					<div key={entry.path}>
						<TreeItem
							entry={entry}
							depth={depth}
							isSelected={selectedFilePath === entry.path}
							isExpanded={isExpanded}
							isLoading={expandedState?.isLoading ?? false}
							onClickFile={onSelectFile}
							onToggleDirectory={handleToggleDirectory}
						/>
						{isExpanded && expandedState?.entries ? renderEntries(expandedState.entries, depth + 1) : null}
					</div>
				);
			}),
		[expandedDirectories, handleToggleDirectory, onSelectFile, selectedFilePath],
	);

	const treeContent = useMemo(() => {
		if (!rootEntries) {
			return null;
		}
		return renderEntries(rootEntries, 0);
	}, [renderEntries, rootEntries]);

	if (isRootLoading) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<Spinner size={20} />
			</div>
		);
	}

	if (!rootEntries || rootEntries.length === 0) {
		return <div className="p-3 text-xs text-text-tertiary">No files found</div>;
	}

	return <div className="min-h-0 flex-1 overflow-auto">{treeContent}</div>;
}
