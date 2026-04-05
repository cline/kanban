import { Ellipsis, Search, X } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";

import { CodeViewer, type EditorSettings } from "@/components/code-browser/code-viewer";
import { FileTypeIcon } from "@/components/code-browser/file-icons";
import { FileSearchDialog } from "@/components/code-browser/file-search-dialog";
import { FileTree } from "@/components/code-browser/file-tree";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 180;
const MAX_SIDEBAR_WIDTH = 480;
const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
	fontSize: 12,
	wordWrap: false,
};

interface OpenTab {
	path: string;
	isDirty: boolean;
}

export interface CodeBrowserOpenFileRequest {
	path: string;
	nonce: number;
}

function getFileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function useResizableSidebar(initialWidth: number): {
	width: number;
	startDrag: (event: ReactMouseEvent<HTMLDivElement>) => void;
} {
	const [width, setWidth] = useState(initialWidth);
	const [isDragging, setIsDragging] = useState(false);
	const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

	useEffect(() => {
		if (!isDragging) {
			return;
		}

		const handleMouseMove = (event: MouseEvent) => {
			const dragState = dragStateRef.current;
			if (!dragState) {
				return;
			}
			const nextWidth = dragState.startWidth + (event.clientX - dragState.startX);
			setWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, nextWidth)));
		};
		const handleMouseUp = () => {
			setIsDragging(false);
			dragStateRef.current = null;
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [isDragging]);

	const startDrag = useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			event.preventDefault();
			dragStateRef.current = {
				startX: event.clientX,
				startWidth: width,
			};
			setIsDragging(true);
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[width],
	);

	return { width, startDrag };
}

function EditorSettingsPopover({
	settings,
	onChange,
}: {
	settings: EditorSettings;
	onChange: (settings: EditorSettings) => void;
}): React.ReactElement {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<div className="relative">
			<button
				type="button"
				className="rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-secondary"
				onClick={() => setIsOpen((current) => !current)}
				title="Editor settings"
			>
				<Ellipsis size={14} />
			</button>
			{isOpen ? (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
					<div className="absolute right-0 top-7 z-50 w-[200px] rounded-lg border border-border bg-surface-2 p-3 shadow-xl">
						<div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
							Editor
						</div>
						<label className="mb-2 flex items-center justify-between text-xs text-text-secondary">
							<span>Font size</span>
							<input
								type="number"
								min={10}
								max={24}
								value={settings.fontSize}
								onChange={(event) =>
									onChange({
										...settings,
										fontSize: Math.max(10, Math.min(24, Number(event.target.value))),
									})
								}
								className="h-7 w-14 rounded border border-border bg-surface-0 px-2 text-center text-xs text-text-primary outline-none"
							/>
						</label>
						<label className="flex items-center justify-between text-xs text-text-secondary">
							<span>Word wrap</span>
							<input
								type="checkbox"
								checked={settings.wordWrap}
								onChange={() =>
									onChange({
										...settings,
										wordWrap: !settings.wordWrap,
									})
								}
							/>
						</label>
					</div>
				</>
			) : null}
		</div>
	);
}

function TabBar({
	tabs,
	activeTabPath,
	onSelectTab,
	onCloseTab,
	onOpenSearch,
	editorSettings,
	onEditorSettingsChange,
}: {
	tabs: OpenTab[];
	activeTabPath: string | null;
	onSelectTab: (path: string) => void;
	onCloseTab: (path: string) => void;
	onOpenSearch: () => void;
	editorSettings: EditorSettings;
	onEditorSettingsChange: (settings: EditorSettings) => void;
}): React.ReactElement {
	return (
		<div className="flex h-[34px] min-h-[34px] items-stretch overflow-hidden border-b border-border bg-surface-1">
			<div className="flex flex-1 items-stretch overflow-x-auto overflow-y-hidden">
				{tabs.map((tab) => {
					const isActive = tab.path === activeTabPath;
					const name = getFileName(tab.path);

					return (
						<div
							key={tab.path}
							onMouseDown={(event) => {
								if (event.button === 1) {
									event.preventDefault();
									onCloseTab(tab.path);
								}
							}}
							onClick={() => onSelectTab(tab.path)}
							className={[
								"flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-2.5 text-[12px]",
								isActive ? "bg-surface-0 text-text-primary" : "text-text-tertiary hover:text-text-secondary",
							].join(" ")}
						>
							<FileTypeIcon name={name} size={14} />
							<span className="max-w-[200px] overflow-hidden text-ellipsis whitespace-nowrap">
								{tab.isDirty ? "* " : ""}
								{name}
							</span>
							<button
								type="button"
								className="ml-0.5 bg-transparent p-0 text-text-tertiary hover:text-text-primary"
								onClick={(event) => {
									event.stopPropagation();
									onCloseTab(tab.path);
								}}
							>
								<X size={12} />
							</button>
						</div>
					);
				})}
			</div>
			<div className="flex shrink-0 items-center gap-0.5 px-1.5">
				<Tooltip side="bottom" content="Search files (Cmd/Ctrl+Shift+P)">
					<Button variant="ghost" size="sm" icon={<Search size={14} />} onClick={onOpenSearch} />
				</Tooltip>
				<EditorSettingsPopover settings={editorSettings} onChange={onEditorSettingsChange} />
			</div>
		</div>
	);
}

export function CodeBrowserPanel({
	workspaceId,
	externalOpenFileRequest,
}: {
	workspaceId: string | null;
	externalOpenFileRequest?: CodeBrowserOpenFileRequest | null;
}): React.ReactElement {
	const [tabs, setTabs] = useState<OpenTab[]>([]);
	const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
	const { width: sidebarWidth, startDrag } = useResizableSidebar(DEFAULT_SIDEBAR_WIDTH);

	const handleSelectFile = useCallback((path: string) => {
		setTabs((current) => {
			if (current.some((tab) => tab.path === path)) {
				return current;
			}
			return [...current, { path, isDirty: false }];
		});
		setActiveTabPath(path);
	}, []);

	const handleCloseTab = useCallback(
		(path: string) => {
			setTabs((current) => {
				const nextTabs = current.filter((tab) => tab.path !== path);
				if (activeTabPath === path) {
					const closedIndex = current.findIndex((tab) => tab.path === path);
					const nextActivePath = nextTabs[Math.min(closedIndex, nextTabs.length - 1)]?.path ?? null;
					setActiveTabPath(nextActivePath);
				}
				return nextTabs;
			});
		},
		[activeTabPath],
	);

	const handleDirtyChange = useCallback((path: string, isDirty: boolean) => {
		setTabs((current) => current.map((tab) => (tab.path === path ? { ...tab, isDirty } : tab)));
	}, []);

	useEffect(() => {
		if (!externalOpenFileRequest) {
			return;
		}
		handleSelectFile(externalOpenFileRequest.path);
	}, [externalOpenFileRequest, handleSelectFile]);

	useEffect(() => {
		if (!workspaceId) {
			setTabs([]);
			setActiveTabPath(null);
		}
	}, [workspaceId]);

	return (
		<div className="flex min-h-0 flex-1 gap-2 bg-surface-0 p-2">
			<div
				className="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-1"
				style={{ width: sidebarWidth, minWidth: MIN_SIDEBAR_WIDTH, maxWidth: MAX_SIDEBAR_WIDTH }}
			>
				<div className="shrink-0 border-b border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
					Explorer
				</div>
				<FileTree workspaceId={workspaceId} selectedFilePath={activeTabPath} onSelectFile={handleSelectFile} />
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize code browser sidebar"
					onMouseDown={startDrag}
					className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize"
				/>
			</div>
			<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border">
				<TabBar
					tabs={tabs}
					activeTabPath={activeTabPath}
					onSelectTab={setActiveTabPath}
					onCloseTab={handleCloseTab}
					onOpenSearch={() => setIsSearchOpen(true)}
					editorSettings={editorSettings}
					onEditorSettingsChange={setEditorSettings}
				/>
				<CodeViewer
					workspaceId={workspaceId}
					filePath={activeTabPath}
					onDirtyChange={handleDirtyChange}
					editorSettings={editorSettings}
				/>
			</div>
			<FileSearchDialog
				isOpen={isSearchOpen}
				onClose={() => setIsSearchOpen(false)}
				workspaceId={workspaceId}
				onSelectFile={handleSelectFile}
			/>
		</div>
	);
}
