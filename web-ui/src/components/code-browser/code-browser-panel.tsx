import { Search, Settings, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { CodeViewer, type EditorSettings } from "./code-viewer";
import { FileTypeIcon } from "./file-icons";
import { FileTree } from "./file-tree";

const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 500;

interface TabInfo { path: string; isDirty: boolean; }

const DEFAULT_EDITOR_SETTINGS: EditorSettings = { fontSize: 10, wordWrap: false, minimap: true, lineNumbers: true };

function getFileName(path: string): string { return path.slice(path.lastIndexOf("/") + 1) || path; }

function useResizableSidebar(initialWidth: number) {
	const [width, setWidth] = useState(initialWidth);
	const [isDragging, setIsDragging] = useState(false);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const startDrag = useCallback((e: ReactMouseEvent) => {
		e.preventDefault();
		dragRef.current = { startX: e.clientX, startWidth: width };
		setIsDragging(true);
		document.body.style.userSelect = "none";
		document.body.style.cursor = "ew-resize";
	}, [width]);
	useEffect(() => {
		if (!isDragging) return;
		const onMouseMove = (e: MouseEvent) => { if (!dragRef.current) return; const delta = e.clientX - dragRef.current.startX; setWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dragRef.current.startWidth + delta))); };
		const onMouseUp = () => { setIsDragging(false); document.body.style.userSelect = ""; document.body.style.cursor = ""; dragRef.current = null; };
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => { window.removeEventListener("mousemove", onMouseMove); window.removeEventListener("mouseup", onMouseUp); };
	}, [isDragging]);
	return { width, startDrag };
}

function FileSearchDialog({ isOpen, onClose, workspaceId, onSelectFile }: { isOpen: boolean; onClose: () => void; workspaceId: string | null; onSelectFile: (path: string) => void; }) {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<{ path: string; name: string }[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => { if (!isOpen) { setQuery(""); setResults([]); setSelectedIndex(0); } else { setTimeout(() => inputRef.current?.focus(), 50); } }, [isOpen]);

	useEffect(() => {
		if (!workspaceId || !isOpen) return;
		if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
		searchTimerRef.current = setTimeout(async () => {
			setIsSearching(true);
			try { const client = getRuntimeTrpcClient(workspaceId); const result = await client.workspace.searchFiles.query({ query, limit: 50 }); setResults(result.files.map((f) => ({ path: f.path, name: f.name }))); setSelectedIndex(0); } catch { setResults([]); } finally { setIsSearching(false); }
		}, 100);
		return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
	}, [query, workspaceId, isOpen]);

	const handleConfirm = useCallback(() => { const selected = results[selectedIndex]; if (selected) { onSelectFile(selected.path); onClose(); } }, [results, selectedIndex, onSelectFile, onClose]);
	const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1)); }
		else if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIndex((prev) => Math.max(prev - 1, 0)); }
		else if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
		else if (e.key === "Escape") { onClose(); }
	}, [results.length, handleConfirm, onClose]);

	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
			<div className="w-[520px] bg-surface-2 border border-border rounded-lg shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center border-b border-border px-3 gap-2">
					<Search size={14} className="text-text-tertiary shrink-0" />
					<input ref={inputRef} type="text" className="flex-1 bg-transparent border-0 outline-none text-sm text-text-primary py-2.5 placeholder:text-text-tertiary" placeholder="Search files by name…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} />
				</div>
				<div className="max-h-[360px] overflow-y-auto">
					{results.length > 0 ? results.map((result, index) => (
						<button key={result.path} type="button" className={`flex flex-col w-full text-left px-3 py-1.5 text-sm cursor-pointer border-0 ${index === selectedIndex ? "bg-accent/15" : "hover:bg-surface-3"}`} onClick={() => { onSelectFile(result.path); onClose(); }}>
							<span className="flex items-center gap-1.5 text-text-primary"><FileTypeIcon name={result.name} size={14} />{result.name}</span>
							<span className="text-[11px] text-text-tertiary font-mono ml-5 truncate">{result.path}</span>
						</button>
					)) : query && !isSearching ? <div className="p-4 text-center text-text-tertiary text-sm">No files found</div> : !query ? <div className="p-4 text-center text-text-tertiary text-sm">Type to search…</div> : null}
				</div>
			</div>
		</div>
	);
}

function EditorSettingsPopover({ settings, onChange }: { settings: EditorSettings; onChange: (s: EditorSettings) => void; }) {
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const [pos, setPos] = useState({ top: 0, right: 0 });
	const handleOpen = useCallback(() => {
		if (!open && btnRef.current) {
			const rect = btnRef.current.getBoundingClientRect();
			setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
		}
		setOpen(!open);
	}, [open]);
	return (
		<div className="relative">
			<button ref={btnRef} type="button" className="p-1 rounded hover:bg-surface-2 text-text-tertiary hover:text-text-secondary" onClick={handleOpen} title="Editor settings"><Settings size={14} /></button>
			{open && (<>
				<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
				<div className="fixed z-50 bg-surface-2 border border-border rounded-lg shadow-xl p-3 w-[200px]" style={{ top: pos.top, right: pos.right }}>
					<div className="text-[11px] font-semibold text-text-tertiary mb-2 uppercase">Editor</div>
					<label className="flex items-center justify-between text-xs text-text-secondary mb-2">Font Size<input type="number" min={8} max={28} value={settings.fontSize} onChange={(e) => onChange({ ...settings, fontSize: Math.max(8, Math.min(28, Number(e.target.value))) })} className="w-12 bg-surface-0 border border-border rounded px-1.5 py-0.5 text-xs text-text-primary text-center" /></label>
					<label className="flex items-center justify-between text-xs text-text-secondary mb-1.5 cursor-pointer">Word Wrap<input type="checkbox" checked={settings.wordWrap} onChange={() => onChange({ ...settings, wordWrap: !settings.wordWrap })} /></label>
					<label className="flex items-center justify-between text-xs text-text-secondary mb-1.5 cursor-pointer">Minimap<input type="checkbox" checked={settings.minimap} onChange={() => onChange({ ...settings, minimap: !settings.minimap })} /></label>
					<label className="flex items-center justify-between text-xs text-text-secondary cursor-pointer">Line Numbers<input type="checkbox" checked={settings.lineNumbers} onChange={() => onChange({ ...settings, lineNumbers: !settings.lineNumbers })} /></label>
				</div>
			</>)}
		</div>
	);
}

function TabBar({ tabs, activeTabPath, onSelectTab, onCloseTab, onOpenSearch, editorSettings, onEditorSettingsChange }: { tabs: TabInfo[]; activeTabPath: string | null; onSelectTab: (path: string) => void; onCloseTab: (path: string) => void; onOpenSearch: () => void; editorSettings: EditorSettings; onEditorSettingsChange: (s: EditorSettings) => void; }) {
	return (
		<div className="flex items-stretch h-[34px] min-h-[34px] bg-surface-1 border-b border-border overflow-hidden shrink-0">
			<div className="flex flex-1 overflow-x-auto overflow-y-hidden items-stretch">
				{tabs.map((tab) => {
					const isActive = tab.path === activeTabPath;
					const name = getFileName(tab.path);
					return (
						<div key={tab.path} onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onCloseTab(tab.path); } }} onClick={() => onSelectTab(tab.path)} className={`flex items-center gap-1.5 px-2.5 cursor-pointer whitespace-nowrap text-[12px] border-r border-border select-none shrink-0 ${isActive ? "bg-surface-0 text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}>
							<FileTypeIcon name={name} size={14} />
							<span className="overflow-hidden text-ellipsis">{tab.isDirty ? "● " : ""}{name}</span>
							<button type="button" className="ml-0.5 p-0 border-0 bg-transparent text-text-tertiary hover:text-text-primary cursor-pointer" onClick={(e) => { e.stopPropagation(); onCloseTab(tab.path); }}><X size={12} /></button>
						</div>
					);
				})}
			</div>
			<div className="flex items-center gap-0.5 px-1.5 shrink-0">
				<Tooltip side="bottom" content="Search files (⇧⌘P)"><Button variant="ghost" size="sm" icon={<Search size={14} />} onClick={onOpenSearch} /></Tooltip>
				<EditorSettingsPopover settings={editorSettings} onChange={onEditorSettingsChange} />
			</div>
		</div>
	);
}

export function CodeBrowserPanel({ workspaceId }: { workspaceId: string | null }): React.ReactElement {
	const [tabs, setTabs] = useState<TabInfo[]>([]);
	const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
	const { width: sidebarWidth, startDrag } = useResizableSidebar(DEFAULT_SIDEBAR_WIDTH);

	const handleSelectFile = useCallback((path: string) => {
		setTabs((prev) => { if (prev.some((tab) => tab.path === path)) return prev; return [...prev, { path, isDirty: false }]; });
		setActiveTabPath(path);
	}, []);

	const handleCloseTab = useCallback((path: string) => {
		setTabs((prev) => {
			const next = prev.filter((tab) => tab.path !== path);
			if (activeTabPath === path) { const closedIndex = prev.findIndex((tab) => tab.path === path); const newActive = next[Math.min(closedIndex, next.length - 1)]?.path ?? null; setActiveTabPath(newActive); }
			return next;
		});
	}, [activeTabPath]);

	const handleDirtyChange = useCallback((path: string, isDirty: boolean) => {
		setTabs((prev) => prev.map((tab) => (tab.path === path ? { ...tab, isDirty } : tab)));
	}, []);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); setIsSearchOpen(true); } };
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	return (
		<div className="flex flex-1 min-h-0 min-w-0 bg-surface-0">
			<div className="flex flex-col border-r border-border bg-surface-0 overflow-hidden shrink-0 relative" style={{ width: sidebarWidth, minWidth: MIN_SIDEBAR_WIDTH, maxWidth: MAX_SIDEBAR_WIDTH }}>
				<div className="flex items-center px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border shrink-0">Explorer</div>
				<FileTree workspaceId={workspaceId} selectedFilePath={activeTabPath} onSelectFile={handleSelectFile} />
				<div onMouseDown={startDrag} className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10" />
			</div>
			<div className="flex flex-1 min-w-0 min-h-0 flex-col">
				<TabBar tabs={tabs} activeTabPath={activeTabPath} onSelectTab={setActiveTabPath} onCloseTab={handleCloseTab} onOpenSearch={() => setIsSearchOpen(true)} editorSettings={editorSettings} onEditorSettingsChange={setEditorSettings} />
				<CodeViewer workspaceId={workspaceId} filePath={activeTabPath} onDirtyChange={handleDirtyChange} editorSettings={editorSettings} />
			</div>
			<FileSearchDialog isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} workspaceId={workspaceId} onSelectFile={handleSelectFile} />
		</div>
	);
}