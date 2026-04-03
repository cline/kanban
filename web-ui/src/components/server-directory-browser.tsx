import { ChevronDown, ChevronRight, Folder, FolderOpen, Home } from "lucide-react";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeListDirectoriesDirectoryEntry } from "@/runtime/types";

interface DirectoryNode {
	entry: RuntimeListDirectoriesDirectoryEntry;
	children: DirectoryNode[] | null;
	isExpanded: boolean;
	isLoading: boolean;
	error: string | null;
}

function updateNodesAtPath(
	nodes: DirectoryNode[],
	path: string,
	updater: (node: DirectoryNode) => DirectoryNode,
): DirectoryNode[] {
	return nodes.map((node) => {
		if (node.entry.path === path) {
			return updater(node);
		}
		if (node.children) {
			return { ...node, children: updateNodesAtPath(node.children, path, updater) };
		}
		return node;
	});
}

function findNodeAtPath(nodes: DirectoryNode[], path: string): DirectoryNode | null {
	for (const node of nodes) {
		if (node.entry.path === path) {
			return node;
		}
		if (node.children) {
			const found = findNodeAtPath(node.children, path);
			if (found) {
				return found;
			}
		}
	}
	return null;
}

export function ServerDirectoryBrowser({
	open,
	onOpenChange,
	workspaceId,
	onSelect,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	workspaceId: string | null;
	onSelect: (path: string) => void;
}): ReactElement {
	const [rootPath, setRootPath] = useState<string | null>(null);
	const [rootChildren, setRootChildren] = useState<DirectoryNode[]>([]);
	const [isLoadingRoot, setIsLoadingRoot] = useState(false);
	const [rootError, setRootError] = useState<string | null>(null);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [pathInput, setPathInput] = useState("");
	const inputRef = useRef<HTMLInputElement>(null) as React.RefObject<HTMLInputElement>;

	const fetchDirectories = useCallback(
		async (path: string): Promise<DirectoryNode[]> => {
			const trpcClient = getRuntimeTrpcClient(workspaceId);
			const response = await trpcClient.runtime.listDirectories.query({ path });
			return response.directories.map((entry) => ({
				entry,
				children: null,
				isExpanded: false,
				isLoading: false,
				error: null,
			}));
		},
		[workspaceId],
	);

	const loadRoot = useCallback(
		async (path: string) => {
			setIsLoadingRoot(true);
			setRootError(null);
			setSelectedPath(path);
			setRootPath(path);
			setPathInput(path);
			try {
				const children = await fetchDirectories(path);
				setRootChildren(children);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setRootError(message);
				setRootChildren([]);
			} finally {
				setIsLoadingRoot(false);
			}
		},
		[fetchDirectories],
	);

	useEffect(() => {
		if (!open) {
			return;
		}
		setSelectedPath(null);
		setPathInput("");
		setRootPath(null);
		setRootChildren([]);
		setRootError(null);
		void loadRoot("/");
	}, [open, loadRoot]);

	const toggleNode = useCallback(
		async (path: string) => {
			const targetNode = findNodeAtPath(rootChildren, path);
			if (!targetNode) {
				return;
			}
			if (targetNode.isExpanded) {
				setRootChildren((prev) => updateNodesAtPath(prev, path, (n) => ({ ...n, isExpanded: false })));
				return;
			}
			setRootChildren((prev) =>
				updateNodesAtPath(prev, path, (n) => ({
					...n,
					isExpanded: true,
					isLoading: n.children === null,
				})),
			);
			if (targetNode.children === null) {
				try {
					const children = await fetchDirectories(path);
					setRootChildren((prev) =>
						updateNodesAtPath(prev, path, (n) => ({ ...n, children, isLoading: false, error: null })),
					);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					setRootChildren((prev) =>
						updateNodesAtPath(prev, path, (n) => ({ ...n, isLoading: false, error: message, children: [] })),
					);
				}
			}
		},
		[fetchDirectories, rootChildren],
	);

	const handleSelect = useCallback(() => {
		if (selectedPath) {
			onSelect(selectedPath);
			onOpenChange(false);
		}
	}, [onOpenChange, onSelect, selectedPath]);

	const handleNavigateToPath = useCallback(() => {
		const trimmed = pathInput.trim();
		if (trimmed) {
			void loadRoot(trimmed);
		}
	}, [loadRoot, pathInput]);

	const handlePathInputKeyDown = useCallback(
		(e: React.KeyboardEvent<HTMLInputElement>) => {
			if (e.key === "Enter") {
				e.preventDefault();
				handleNavigateToPath();
			}
		},
		[handleNavigateToPath],
	);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			contentClassName="max-w-lg"
			contentAriaDescribedBy="server-directory-browser-description"
		>
			<DialogHeader title="Select Project Directory" icon={<FolderOpen size={16} />} />
			<DialogBody className="p-0 flex flex-col gap-0">
				<p id="server-directory-browser-description" className="sr-only">
					Browse server directories and select a project folder.
				</p>
				<DirectoryBrowserAddressBar
					inputRef={inputRef}
					pathInput={pathInput}
					rootPath={rootPath}
					onPathInputChange={setPathInput}
					onNavigate={handleNavigateToPath}
					onGoRoot={() => void loadRoot("/")}
					onKeyDown={handlePathInputKeyDown}
				/>
				<DirectoryBrowserTree
					isLoadingRoot={isLoadingRoot}
					rootError={rootError}
					rootPath={rootPath}
					rootChildren={rootChildren}
					selectedPath={selectedPath}
					onSelectPath={setSelectedPath}
					onToggleNode={toggleNode}
					onRetryRoot={loadRoot}
				/>
				{selectedPath ? (
					<div className="px-3 py-2 border-t border-border bg-surface-2">
						<div className="text-xs text-text-secondary font-mono truncate" title={selectedPath}>
							{selectedPath}
						</div>
					</div>
				) : null}
			</DialogBody>
			<DialogFooter>
				<Button variant="default" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
				<Button variant="primary" disabled={!selectedPath} onClick={handleSelect}>
					Select
				</Button>
			</DialogFooter>
		</Dialog>
	);
}

function DirectoryBrowserAddressBar({
	inputRef,
	pathInput,
	rootPath,
	onPathInputChange,
	onNavigate,
	onGoRoot,
	onKeyDown,
}: {
	inputRef: React.RefObject<HTMLInputElement>;
	pathInput: string;
	rootPath: string | null;
	onPathInputChange: (value: string) => void;
	onNavigate: () => void;
	onGoRoot: () => void;
	onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}): ReactElement {
	return (
		<div className="flex items-center gap-1 px-3 py-2 border-b border-border bg-surface-2">
			<button
				type="button"
				className="p-1 border-0 bg-transparent cursor-pointer text-text-secondary hover:text-text-primary rounded-sm hover:bg-surface-3"
				title="Go to root"
				onClick={onGoRoot}
			>
				<Home size={14} />
			</button>
			<input
				ref={inputRef}
				type="text"
				className="flex-1 min-w-0 bg-surface-1 border border-border rounded-sm px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent"
				placeholder="Enter path..."
				value={pathInput || rootPath || ""}
				onChange={(e) => onPathInputChange(e.target.value)}
				onKeyDown={onKeyDown}
			/>
			<Button variant="ghost" size="sm" onClick={onNavigate}>
				Go
			</Button>
		</div>
	);
}

function DirectoryNodeRow({
	node,
	depth,
	selectedPath,
	onSelectPath,
	onToggleNode,
}: {
	node: DirectoryNode;
	depth: number;
	selectedPath: string | null;
	onSelectPath: (path: string) => void;
	onToggleNode: (path: string) => Promise<void>;
}): ReactElement {
	const isSelected = selectedPath === node.entry.path;
	return (
		<div>
			<div
				role="button"
				tabIndex={0}
				className={`flex items-center gap-1 py-1 px-2 cursor-pointer rounded-sm text-[13px] hover:bg-surface-3 ${isSelected ? "bg-accent/15 text-accent" : "text-text-primary"}`}
				style={{ paddingLeft: `${depth * 16 + 8}px` }}
				onClick={() => onSelectPath(node.entry.path)}
				onDoubleClick={() => void onToggleNode(node.entry.path)}
				onKeyDown={(e) => {
					if (e.key === "Enter") {
						onSelectPath(node.entry.path);
					} else if (e.key === "ArrowRight" && !node.isExpanded) {
						void onToggleNode(node.entry.path);
					} else if (e.key === "ArrowLeft" && node.isExpanded) {
						void onToggleNode(node.entry.path);
					}
				}}
			>
				<button
					type="button"
					className="p-0 border-0 bg-transparent cursor-pointer text-text-tertiary hover:text-text-secondary shrink-0"
					onClick={(e) => {
						e.stopPropagation();
						void onToggleNode(node.entry.path);
					}}
				>
					{node.isLoading ? (
						<Spinner size={12} />
					) : node.isExpanded ? (
						<ChevronDown size={12} />
					) : (
						<ChevronRight size={12} />
					)}
				</button>
				{node.isExpanded ? (
					<FolderOpen size={14} className="shrink-0 text-text-secondary" />
				) : (
					<Folder size={14} className="shrink-0 text-text-secondary" />
				)}
				<span className="truncate">{node.entry.name}</span>
			</div>
			{node.isExpanded && node.children ? (
				<div>
					{node.error ? (
						<div
							className="text-xs text-status-red px-2 py-1"
							style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
						>
							{node.error}
						</div>
					) : node.children.length === 0 && !node.isLoading ? (
						<div
							className="text-xs text-text-tertiary px-2 py-1 italic"
							style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
						>
							Empty
						</div>
					) : (
						node.children.map((child) => (
							<DirectoryNodeRow
								key={child.entry.path}
								node={child}
								depth={depth + 1}
								selectedPath={selectedPath}
								onSelectPath={onSelectPath}
								onToggleNode={onToggleNode}
							/>
						))
					)}
				</div>
			) : null}
		</div>
	);
}

function DirectoryBrowserTree({
	isLoadingRoot,
	rootError,
	rootPath,
	rootChildren,
	selectedPath,
	onSelectPath,
	onToggleNode,
	onRetryRoot,
}: {
	isLoadingRoot: boolean;
	rootError: string | null;
	rootPath: string | null;
	rootChildren: DirectoryNode[];
	selectedPath: string | null;
	onSelectPath: (path: string) => void;
	onToggleNode: (path: string) => Promise<void>;
	onRetryRoot: (path: string) => Promise<void>;
}): ReactElement {
	if (isLoadingRoot) {
		return (
			<div className="flex items-center justify-center py-8" style={{ minHeight: 200 }}>
				<Spinner size={24} />
			</div>
		);
	}
	if (rootError) {
		return (
			<div
				className="flex flex-col items-center justify-center gap-2 py-8 px-4 text-center"
				style={{ minHeight: 200 }}
			>
				<p className="text-sm text-status-red">{rootError}</p>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => {
						if (rootPath) {
							void onRetryRoot(rootPath);
						}
					}}
				>
					Retry
				</Button>
			</div>
		);
	}
	if (rootChildren.length === 0) {
		return (
			<div className="flex items-center justify-center py-8 text-sm text-text-tertiary" style={{ minHeight: 200 }}>
				No directories found
			</div>
		);
	}
	return (
		<div className="flex-1 min-h-0 overflow-y-auto py-1" style={{ minHeight: 200, maxHeight: 400 }}>
			{rootChildren.map((node) => (
				<DirectoryNodeRow
					key={node.entry.path}
					node={node}
					depth={0}
					selectedPath={selectedPath}
					onSelectPath={onSelectPath}
					onToggleNode={onToggleNode}
				/>
			))}
		</div>
	);
}
