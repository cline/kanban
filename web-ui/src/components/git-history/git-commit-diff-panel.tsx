import { ChevronDown, ChevronRight, GitCommit, GitCompare, AlertCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import {
	buildUnifiedDiffRows,
	parsePatchToRows,
	ReadOnlyUnifiedDiff,
	truncatePathMiddle,
	type UnifiedDiffRow,
} from "@/components/shared/diff-renderer";
import type { RuntimeGitCommitDiffFile, RuntimeWorkspaceFileChange } from "@/runtime/types";

export type GitCommitDiffSource =
	| { type: "commit"; files: RuntimeGitCommitDiffFile[] }
	| { type: "working-copy"; files: RuntimeWorkspaceFileChange[] };

function getFileRows(source: GitCommitDiffSource, path: string): UnifiedDiffRow[] {
	if (source.type === "commit") {
		const file = source.files.find((f) => f.path === path);
		if (!file) {
			return [];
		}
		return parsePatchToRows(file.patch);
	}
	const file = source.files.find((f) => f.path === path);
	if (!file) {
		return [];
	}
	return buildUnifiedDiffRows(file.oldText, file.newText ?? "");
}

function getFileStats(source: GitCommitDiffSource, path: string): { additions: number; deletions: number } {
	if (source.type === "commit") {
		const file = source.files.find((f) => f.path === path);
		return { additions: file?.additions ?? 0, deletions: file?.deletions ?? 0 };
	}
	const file = source.files.find((f) => f.path === path);
	return { additions: file?.additions ?? 0, deletions: file?.deletions ?? 0 };
}

function toWorkspaceFileChangeFormat(source: GitCommitDiffSource): RuntimeWorkspaceFileChange[] {
	if (source.type === "working-copy") {
		return source.files;
	}
	return source.files.map((f) => ({
		path: f.path,
		previousPath: f.previousPath,
		status: f.status === "renamed" ? "renamed" : f.status,
		additions: f.additions,
		deletions: f.deletions,
		oldText: null,
		newText: null,
	}));
}

function getCommitFile(source: GitCommitDiffSource | null, path: string): RuntimeGitCommitDiffFile | null {
	if (!source || source.type !== "commit") {
		return null;
	}
	return source.files.find((file) => file.path === path) ?? null;
}

export function GitCommitDiffPanel({
	diffSource,
	isLoading,
	errorMessage,
	selectedPath,
	onSelectPath,
	headerContent,
}: {
	diffSource: GitCommitDiffSource | null;
	isLoading: boolean;
	errorMessage?: string | null;
	selectedPath: string | null;
	onSelectPath: (path: string | null) => void;
	headerContent?: React.ReactNode;
}): React.ReactElement {
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const sectionElementsRef = useRef<Record<string, HTMLElement | null>>({});
	const programmaticScrollUntilRef = useRef(0);
	const suppressScrollSyncUntilRef = useRef(0);
	const scrollSyncSelectionRef = useRef<{ path: string; at: number } | null>(null);

	const files = diffSource?.files ?? [];
	const filePaths = useMemo(() => {
		if (!diffSource) {
			return [];
		}
		return diffSource.type === "commit" ? diffSource.files.map((f) => f.path) : diffSource.files.map((f) => f.path);
	}, [diffSource]);

	const workspaceFilesForTree = useMemo(() => {
		if (!diffSource) {
			return null;
		}
		return toWorkspaceFileChangeFormat(diffSource);
	}, [diffSource]);

	useEffect(() => {
		setExpandedPaths({});
	}, [diffSource]);

	useEffect(() => {
		if (selectedPath && filePaths.includes(selectedPath)) {
			return;
		}
		onSelectPath(filePaths[0] ?? null);
	}, [filePaths, selectedPath, onSelectPath]);

	const resolveActivePath = useCallback((): string | null => {
		const container = scrollContainerRef.current;
		if (!container || filePaths.length === 0) {
			return null;
		}
		const probeOffset = container.scrollTop + 80;
		let activePath = filePaths[0] ?? null;
		for (const path of filePaths) {
			const section = sectionElementsRef.current[path];
			if (!section) {
				continue;
			}
			if (section.offsetTop <= probeOffset) {
				activePath = path;
				continue;
			}
			break;
		}
		return activePath;
	}, [filePaths]);

	const handleDiffScroll = useCallback(() => {
		if (Date.now() < programmaticScrollUntilRef.current) {
			return;
		}
		if (Date.now() < suppressScrollSyncUntilRef.current) {
			return;
		}
		const activePath = resolveActivePath();
		if (!activePath || activePath === selectedPath) {
			return;
		}
		scrollSyncSelectionRef.current = { path: activePath, at: Date.now() };
		onSelectPath(activePath);
	}, [onSelectPath, resolveActivePath, selectedPath]);

	const scrollToPath = useCallback((path: string) => {
		const container = scrollContainerRef.current;
		const section = sectionElementsRef.current[path];
		if (!container || !section) {
			return;
		}
		programmaticScrollUntilRef.current = Date.now() + 320;
		const containerStyle = window.getComputedStyle(container);
		const paddingTop = Number.parseFloat(containerStyle.paddingTop) || 0;
		const targetScrollTop = Math.max(0, section.offsetTop - paddingTop);
		container.scrollTop = targetScrollTop;
	}, []);

	useEffect(() => {
		if (!selectedPath) {
			return;
		}
		const syncSelection = scrollSyncSelectionRef.current;
		if (syncSelection && syncSelection.path === selectedPath && Date.now() - syncSelection.at < 150) {
			scrollSyncSelectionRef.current = null;
			return;
		}
		scrollSyncSelectionRef.current = null;
		scrollToPath(selectedPath);
	}, [scrollToPath, selectedPath]);

	if (!diffSource && !isLoading) {
		return (
			<div style={{ display: "flex", flex: "1.6 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary" style={{ flex: 1 }}>
					{errorMessage ? <AlertCircle size={48} /> : <GitCommit size={48} />}
					<h3 className="font-semibold text-text-primary">
						{errorMessage ? "Could not load diff" : "Select a commit"}
					</h3>
					{errorMessage ? <p className="text-text-secondary">{errorMessage}</p> : null}
				</div>
			</div>
		);
	}

	if (isLoading) {
		return (
			<div style={{ display: "flex", flex: "1.6 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
				<div
					style={{
						display: "flex",
						flex: "1 1 0",
						flexDirection: "column",
						borderRight: "1px solid var(--color-divider)",
					}}
				>
					<div style={{ padding: "10px 10px 6px" }}>
						{Array.from({ length: 4 }, (_, i) => (
							<div key={i} style={{ marginBottom: 10 }}>
								<div
									className="animate-pulse rounded bg-surface-3"
									style={{ height: 14, width: `${50 + (i % 3) * 15}%`, marginBottom: 6 }}
								/>
								<div
									className="animate-pulse rounded bg-surface-3"
									style={{ height: 11, width: "90%", marginBottom: 3 }}
								/>
								<div className="animate-pulse rounded bg-surface-3" style={{ height: 11, width: "80%" }} />
							</div>
						))}
					</div>
				</div>
				<div style={{ display: "flex", flex: "0.6 1 0", flexDirection: "column", padding: "10px 8px" }}>
					{Array.from({ length: 3 }, (_, i) => (
						<div
							key={i}
							style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", marginBottom: 2 }}
						>
							<div className="animate-pulse rounded bg-surface-3" style={{ height: 12, width: 12 }} />
							<div
								className="animate-pulse rounded bg-surface-3"
								style={{ height: 13, width: `${55 + (i % 3) * 8}%` }}
							/>
						</div>
					))}
				</div>
			</div>
		);
	}

	if (files.length === 0) {
		return (
			<div style={{ display: "flex", flex: "1.6 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary" style={{ flex: 1 }}>
					<GitCompare size={48} />
					<h3 className="font-semibold text-text-primary">No changes</h3>
				</div>
			</div>
		);
	}

	return (
		<div style={{ display: "flex", flex: "1.6 1 0", minWidth: 0, minHeight: 0, background: "var(--color-surface-0)" }}>
			<div
				style={{
					display: "flex",
					flex: "1 1 0",
					flexDirection: "column",
					minWidth: 0,
					minHeight: 0,
					borderRight: "1px solid var(--color-divider)",
				}}
			>
				{headerContent ? headerContent : null}
				<div
					ref={scrollContainerRef}
					onScroll={handleDiffScroll}
					style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 12 }}
				>
					{filePaths.map((path) => {
						const isExpanded = expandedPaths[path] ?? true;
						const stats = diffSource ? getFileStats(diffSource, path) : { additions: 0, deletions: 0 };
						const rows = diffSource ? getFileRows(diffSource, path) : [];
						const commitFile = getCommitFile(diffSource, path);

						return (
							<section
								key={path}
								ref={(node) => {
									sectionElementsRef.current[path] = node;
								}}
								style={{ marginBottom: 12 }}
							>
								<div className="rounded-md border border-border bg-surface-2" style={{ overflow: "hidden", padding: 0 }}>
									<button
										type="button"
										className="kb-diff-file-header flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-primary hover:bg-surface-3"
										aria-expanded={isExpanded}
										aria-current={selectedPath === path ? "true" : undefined}
										onClick={() => {
											const container = scrollContainerRef.current;
											const sectionEl = sectionElementsRef.current[path];
											const previousTop = sectionEl?.getBoundingClientRect().top ?? null;
											const nextExpanded = !(expandedPaths[path] ?? true);
											suppressScrollSyncUntilRef.current = Date.now() + 250;
											setExpandedPaths((prev) => ({ ...prev, [path]: nextExpanded }));
											requestAnimationFrame(() => {
												if (previousTop == null || !container || !sectionEl) {
													return;
												}
												const nextTop = sectionEl.getBoundingClientRect().top;
												container.scrollTop += nextTop - previousTop;
											});
										}}
									>
										{isExpanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
										<span className="truncate flex-1" title={path}>
											{truncatePathMiddle(path)}
										</span>
										<span className="shrink-0 text-xs">
											{stats.additions > 0 ? (
											<span className="text-status-green">+{stats.additions}</span>
											) : null}
											{stats.additions > 0 && stats.deletions > 0 ? " " : null}
											{stats.deletions > 0 ? (
											<span className="text-status-red">-{stats.deletions}</span>
											) : null}
										</span>
									</button>
									{isExpanded && diffSource ? (
										<div className="kb-diff-entry">
											{commitFile?.status === "renamed" && commitFile.previousPath ? (
												<div
													style={{
														padding: "8px 12px 0",
														fontSize: 12,
												color: "var(--color-text-tertiary)",
													}}
												>
													Renamed from{" "}
													<code className="font-mono">
														{commitFile.previousPath}
													</code>
												</div>
											) : null}
											{rows.length > 0 ? (
												<ReadOnlyUnifiedDiff rows={rows} path={path} />
											) : (
												<div
													style={{
														padding: "12px",
														fontSize: 12,
												color: "var(--color-text-tertiary)",
													}}
												>
													No textual diff available.
												</div>
											)}
										</div>
									) : null}
								</div>
							</section>
						);
					})}
				</div>
			</div>
			<FileTreePanel
				workspaceFiles={workspaceFilesForTree}
				selectedPath={selectedPath}
				onSelectPath={onSelectPath}
			/>
		</div>
	);
}
