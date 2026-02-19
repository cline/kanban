import { diffLines, diffWordsWithSpace } from "diff";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildFileTree, extractDiffEntries, extractReferencedPaths } from "@/kanban/chat/utils/session-artifacts";
import type { ChatTimelineEntry } from "@/kanban/chat/types";
import type { RuntimeWorkspaceFileChange } from "@/kanban/runtime/types";

const CONTEXT_RADIUS = 3;
const MIN_COLLAPSE_LINES = 8;

interface InlineDiffSegment {
	key: string;
	text: string;
	tone: "added" | "removed" | "context";
}

interface UnifiedDiffRow {
	key: string;
	lineNumber: number | null;
	variant: "context" | "added" | "removed";
	text: string;
	segments?: InlineDiffSegment[];
}

interface CollapsedContextBlock {
	id: string;
	count: number;
	rows: UnifiedDiffRow[];
	expanded: boolean;
}

type DiffDisplayItem =
	| {
			type: "row";
			row: UnifiedDiffRow;
	  }
	| {
			type: "collapsed";
			block: CollapsedContextBlock;
	  };

interface FileDiffGroup {
	path: string;
	entries: Array<{
		id: string;
		oldText: string | null;
		newText: string;
	}>;
	added: number;
	removed: number;
}

function flattenFilePathsForDisplay(paths: string[]): string[] {
	const tree = buildFileTree(paths);
	const ordered: string[] = [];

	function walk(nodes: ReturnType<typeof buildFileTree>): void {
		for (const node of nodes) {
			if (node.type === "file") {
				ordered.push(node.path);
				continue;
			}
			walk(node.children);
		}
	}

	walk(tree);
	return ordered;
}

function truncatePathMiddle(path: string, maxLength = 64): string {
	if (path.length <= maxLength) {
		return path;
	}
	const separator = "...";
	const keep = Math.max(8, maxLength - separator.length);
	const head = Math.ceil(keep / 2);
	const tail = Math.floor(keep / 2);
	return `${path.slice(0, head)}${separator}${path.slice(path.length - tail)}`;
}

function toLines(text: string): string[] {
	const rawLines = text.split("\n");
	return text.endsWith("\n") ? rawLines.slice(0, -1) : rawLines;
}

function countAddedRemoved(oldText: string | null | undefined, newText: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	const changes = diffLines(oldText ?? "", newText, {
		ignoreWhitespace: false,
	});
	for (const change of changes) {
		if (!change) {
			continue;
		}
		const lineCount = toLines(change.value).length;
		if (change.added) {
			added += lineCount;
			continue;
		}
		if (change.removed) {
			removed += lineCount;
		}
	}
	return { added, removed };
}

function buildModifiedSegments(oldText: string, newText: string): {
	oldSegments: InlineDiffSegment[];
	newSegments: InlineDiffSegment[];
} {
	const oldSegments: InlineDiffSegment[] = [];
	const newSegments: InlineDiffSegment[] = [];
	const parts = diffWordsWithSpace(oldText, newText);

	for (let index = 0; index < parts.length; index += 1) {
		const part = parts[index];
		if (!part) {
			continue;
		}

		if (part.removed) {
			oldSegments.push({
				key: `o-${index}`,
				text: part.value,
				tone: "removed",
			});
			continue;
		}

		if (part.added) {
			newSegments.push({
				key: `n-${index}`,
				text: part.value,
				tone: "added",
			});
			continue;
		}

		oldSegments.push({
			key: `oc-${index}`,
			text: part.value,
			tone: "context",
		});
		newSegments.push({
			key: `nc-${index}`,
			text: part.value,
			tone: "context",
		});
	}

	return { oldSegments, newSegments };
}

function buildUnifiedDiffRows(oldText: string | null | undefined, newText: string): UnifiedDiffRow[] {
	const rows: UnifiedDiffRow[] = [];
	let oldLine = 1;
	let newLine = 1;
	const changes = diffLines(oldText ?? "", newText, {
		ignoreWhitespace: false,
	});

	for (let index = 0; index < changes.length; index += 1) {
		const change = changes[index];
		const nextChange = changes[index + 1];
		if (!change) {
			continue;
		}

		if (change.removed && nextChange?.added) {
			const removedLines = toLines(change.value);
			const addedLines = toLines(nextChange.value);
			const pairCount = Math.max(removedLines.length, addedLines.length);

			for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
				const removedLine = removedLines[pairIndex];
				const addedLine = addedLines[pairIndex];

				if (removedLine != null && addedLine != null) {
					const { oldSegments, newSegments } = buildModifiedSegments(removedLine, addedLine);
					rows.push({
						key: `m-old-${oldLine}-${newLine}`,
						lineNumber: oldLine,
						variant: "removed",
						text: removedLine,
						segments: oldSegments,
					});
					rows.push({
						key: `m-new-${oldLine}-${newLine}`,
						lineNumber: newLine,
						variant: "added",
						text: addedLine,
						segments: newSegments,
					});
					oldLine += 1;
					newLine += 1;
					continue;
				}

				if (removedLine != null) {
					rows.push({
						key: `o-${oldLine}`,
						lineNumber: oldLine,
						variant: "removed",
						text: removedLine,
					});
					oldLine += 1;
					continue;
				}

				if (addedLine != null) {
					rows.push({
						key: `n-${newLine}`,
						lineNumber: newLine,
						variant: "added",
						text: addedLine,
					});
					newLine += 1;
				}
			}

			index += 1;
			continue;
		}

		const lines = toLines(change.value);
		for (const line of lines) {
			if (change.added) {
				rows.push({
					key: `n-${newLine}`,
					lineNumber: newLine,
					variant: "added",
					text: line,
				});
				newLine += 1;
				continue;
			}

			if (change.removed) {
				rows.push({
					key: `o-${oldLine}`,
					lineNumber: oldLine,
					variant: "removed",
					text: line,
				});
				oldLine += 1;
				continue;
			}

			rows.push({
				key: `c-${oldLine}-${newLine}`,
				lineNumber: newLine,
				variant: "context",
				text: line,
			});
			oldLine += 1;
			newLine += 1;
		}
	}

	return rows;
}

function buildDisplayItems(rows: UnifiedDiffRow[], expandedBlocks: Record<string, boolean>): DiffDisplayItem[] {
	const changedIndices: number[] = [];
	for (let index = 0; index < rows.length; index += 1) {
		if (rows[index]?.variant !== "context") {
			changedIndices.push(index);
		}
	}

	const nearbyContext = new Set<number>();
	for (const changedIndex of changedIndices) {
		const start = Math.max(0, changedIndex - CONTEXT_RADIUS);
		const end = Math.min(rows.length - 1, changedIndex + CONTEXT_RADIUS);
		for (let index = start; index <= end; index += 1) {
			nearbyContext.add(index);
		}
	}

	const shouldHideContextAt = (index: number): boolean => {
		const row = rows[index];
		if (!row || row.variant !== "context") {
			return false;
		}
		if (changedIndices.length === 0) {
			return rows.length >= MIN_COLLAPSE_LINES;
		}
		return !nearbyContext.has(index);
	};

	const items: DiffDisplayItem[] = [];
	let index = 0;
	while (index < rows.length) {
		if (!shouldHideContextAt(index)) {
			const row = rows[index];
			if (row) {
				items.push({
					type: "row",
					row,
				});
			}
			index += 1;
			continue;
		}

		const start = index;
		while (index < rows.length && shouldHideContextAt(index)) {
			index += 1;
		}
		const blockRows = rows.slice(start, index);
		if (blockRows.length < MIN_COLLAPSE_LINES) {
			for (const row of blockRows) {
				items.push({
					type: "row",
					row,
				});
			}
			continue;
		}

		const blockId = `ctx-${start}-${index - 1}`;
		items.push({
			type: "collapsed",
			block: {
				id: blockId,
				count: blockRows.length,
				rows: blockRows,
				expanded: expandedBlocks[blockId] === true,
			},
		});
	}

	return items;
}

function DiffRowText({ row }: { row: UnifiedDiffRow }): React.ReactElement {
	if (!row.segments) {
		return <span className="min-w-0 whitespace-pre-wrap break-words">{row.text || " "}</span>;
	}

	return (
		<span className="min-w-0 whitespace-pre-wrap break-words">
			{row.segments.map((segment) => (
				<span
					key={segment.key}
					className={
						segment.tone === "added"
							? "rounded bg-emerald-500/25 px-0.5 text-emerald-100"
							: segment.tone === "removed"
								? "rounded bg-red-500/25 px-0.5 text-red-100"
								: undefined
					}
				>
					{segment.text}
				</span>
			))}
		</span>
	);
}

function UnifiedDiff({
	oldText,
	newText,
}: {
	oldText: string | null | undefined;
	newText: string;
}): React.ReactElement {
	const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
	const rows = useMemo(() => buildUnifiedDiffRows(oldText, newText), [oldText, newText]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

	const toggleBlock = useCallback((id: string) => {
		setExpandedBlocks((prev) => ({
			...prev,
			[id]: !prev[id],
		}));
	}, []);

	const renderRow = useCallback((row: UnifiedDiffRow): React.ReactElement => {
		const rowToneClass =
			row.variant === "added"
				? "bg-emerald-500/10 text-emerald-200"
				: row.variant === "removed"
					? "bg-red-500/10 text-red-200"
					: "text-zinc-400";

		return (
			<div key={row.key} className={`grid grid-cols-[2rem_minmax(0,1fr)] gap-1 rounded-none px-0 py-0.5 font-mono text-xs ${rowToneClass}`}>
				<span className="select-none pr-1 text-right text-zinc-600">{row.lineNumber ?? ""}</span>
				<DiffRowText row={row} />
			</div>
		);
	}, []);

	return (
		<>
			{displayItems.map((item) => {
				if (item.type === "row") {
					return renderRow(item.row);
				}

				const Chevron = item.block.expanded ? ChevronDown : ChevronRight;
				return (
					<div key={item.block.id} className="space-y-1">
						<button
							type="button"
							onClick={() => toggleBlock(item.block.id)}
							className="grid w-full cursor-pointer grid-cols-[2rem_minmax(0,1fr)] gap-1 rounded border border-zinc-700 bg-zinc-800/85 px-0.5 py-1 text-left text-xs text-zinc-300 hover:bg-zinc-700/80 hover:text-zinc-100"
						>
							<span />
							<span className="flex items-center gap-1.5">
								<Chevron className="size-3" />
								{item.block.expanded ? "Hide" : "Show"} {item.block.count} unmodified lines
							</span>
						</button>
						{item.block.expanded ? item.block.rows.map((row) => renderRow(row)) : null}
					</div>
				);
			})}
		</>
	);
}

export function DiffViewerPanel({
	timeline,
	workspaceFiles,
	selectedPath,
	onSelectedPathChange,
}: {
	timeline: ChatTimelineEntry[];
	workspaceFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	onSelectedPathChange: (path: string) => void;
}): React.ReactElement {
	const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const sectionElementsRef = useRef<Record<string, HTMLElement | null>>({});
	const scrollSyncSelectionRef = useRef<{ path: string; at: number } | null>(null);
	const suppressScrollSyncUntilRef = useRef(0);
	const programmaticScrollUntilRef = useRef(0);
	const programmaticScrollClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const diffEntries = useMemo(() => {
		if (workspaceFiles && workspaceFiles.length > 0) {
			return workspaceFiles.map((file, index) => ({
				id: `workspace-${file.path}-${index}`,
				path: file.path,
				oldText: file.oldText,
				newText: file.newText ?? "",
				timestamp: 0,
				toolTitle: `${file.status} (${file.additions}+/${file.deletions}-)`,
			}));
		}
		return extractDiffEntries(timeline);
	}, [workspaceFiles, timeline]);

	const groupedByPath = useMemo((): FileDiffGroup[] => {
		const sourcePaths =
			workspaceFiles && workspaceFiles.length > 0
				? workspaceFiles.map((file) => file.path)
				: extractReferencedPaths(timeline);
		const orderedPaths = flattenFilePathsForDisplay(sourcePaths);
		const orderIndex = new Map(orderedPaths.map((path, index) => [path, index]));
		const map = new Map<string, FileDiffGroup>();
		for (const entry of diffEntries) {
			let group = map.get(entry.path);
			if (!group) {
				group = {
					path: entry.path,
					entries: [],
					added: 0,
					removed: 0,
				};
				map.set(entry.path, group);
			}
			group.entries.push({
				id: entry.id,
				oldText: entry.oldText,
				newText: entry.newText,
			});
			const counts = countAddedRemoved(entry.oldText, entry.newText);
			group.added += counts.added;
			group.removed += counts.removed;
		}
		return Array.from(map.values()).sort((a, b) => {
			const aIndex = orderIndex.get(a.path) ?? Number.MAX_SAFE_INTEGER;
			const bIndex = orderIndex.get(b.path) ?? Number.MAX_SAFE_INTEGER;
			if (aIndex !== bIndex) {
				return aIndex - bIndex;
			}
			return a.path.localeCompare(b.path);
		});
	}, [diffEntries, timeline, workspaceFiles]);

	const resolveActivePath = useCallback((): string | null => {
		const container = scrollContainerRef.current;
		if (!container || groupedByPath.length === 0) {
			return null;
		}

		const probeOffset = container.scrollTop + 80;
		let activePath = groupedByPath[0]?.path ?? null;
		for (const group of groupedByPath) {
			const section = sectionElementsRef.current[group.path];
			if (!section) {
				continue;
			}
			if (section.offsetTop <= probeOffset) {
				activePath = group.path;
				continue;
			}
			break;
		}

		return activePath;
	}, [groupedByPath]);

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

		scrollSyncSelectionRef.current = {
			path: activePath,
			at: Date.now(),
		};
		onSelectedPathChange(activePath);
	}, [onSelectedPathChange, resolveActivePath, selectedPath]);

	const scrollToPath = useCallback((path: string) => {
		const container = scrollContainerRef.current;
		const section = sectionElementsRef.current[path];
		if (!container || !section) {
			return;
		}
		programmaticScrollUntilRef.current = Date.now() + 320;
		if (programmaticScrollClearTimerRef.current) {
			clearTimeout(programmaticScrollClearTimerRef.current);
		}
		programmaticScrollClearTimerRef.current = setTimeout(() => {
			programmaticScrollUntilRef.current = 0;
			programmaticScrollClearTimerRef.current = null;
		}, 320);

		const containerRect = container.getBoundingClientRect();
		const sectionRect = section.getBoundingClientRect();
		const viewportPadding = 6;
		const delta = sectionRect.top - containerRect.top - viewportPadding;
		container.scrollTop = Math.max(0, container.scrollTop + delta);
	}, []);

	useEffect(() => {
		return () => {
			if (programmaticScrollClearTimerRef.current) {
				clearTimeout(programmaticScrollClearTimerRef.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!selectedPath) {
			return;
		}

		const syncSelection = scrollSyncSelectionRef.current;
		if (
			syncSelection &&
			syncSelection.path === selectedPath &&
			Date.now() - syncSelection.at < 150
		) {
			scrollSyncSelectionRef.current = null;
			return;
		}
		scrollSyncSelectionRef.current = null;
		scrollToPath(selectedPath);
	}, [scrollToPath, selectedPath]);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-zinc-800">
			{groupedByPath.length === 0 ? (
				<div className="flex flex-1 items-center justify-center px-4 text-center">
					<p className="text-sm text-zinc-600">No diff yet. Move this task out of Backlog to kick off agent work.</p>
				</div>
			) : (
				<div
					ref={scrollContainerRef}
					onScroll={handleDiffScroll}
					className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
				>
					{groupedByPath.map((group) => {
						const isExpanded = expandedPaths[group.path] ?? true;
						const Chevron = isExpanded ? ChevronDown : ChevronRight;
						return (
							<section
								key={group.path}
								ref={(node) => {
									sectionElementsRef.current[group.path] = node;
								}}
								className="rounded-lg border border-zinc-800 bg-zinc-900/80"
							>
								<button
									type="button"
									onClick={() => {
										const container = scrollContainerRef.current;
										const section = sectionElementsRef.current[group.path];
										const previousTop = section?.getBoundingClientRect().top ?? null;
										const nextExpanded = !(expandedPaths[group.path] ?? true);
										suppressScrollSyncUntilRef.current = Date.now() + 250;
										setExpandedPaths((prev) => ({
											...prev,
											[group.path]: nextExpanded,
										}));
										requestAnimationFrame(() => {
											if (previousTop == null || !container || !section) {
												return;
											}
											const nextTop = section.getBoundingClientRect().top;
											container.scrollTop += nextTop - previousTop;
										});
									}}
									aria-expanded={isExpanded}
									aria-current={selectedPath === group.path ? "true" : undefined}
									className={`flex w-full min-w-0 cursor-pointer items-center justify-between gap-2 bg-amber-500/15 px-2 py-1.5 text-left hover:bg-amber-500/20 ${
										isExpanded
											? "rounded-t border border-amber-500/25"
											: "rounded border border-amber-500/25"
									}`}
								>
									<div className="flex min-w-0 items-center gap-1.5">
										<Chevron className="size-3 text-amber-300/80" />
										<span
											title={group.path}
											className={`min-w-0 truncate font-mono text-xs ${selectedPath === group.path ? "text-amber-100" : "text-amber-200/90"}`}
										>
											{truncatePathMiddle(group.path)}
										</span>
									</div>
									<div className="shrink-0 space-x-2 font-mono text-[11px]">
										<span className="text-emerald-400">+{group.added}</span>
										<span className="text-red-400">-{group.removed}</span>
									</div>
								</button>
								{isExpanded ? (
									<div className="space-y-0">
										{group.entries.map((entry, index) => (
											<div
												key={entry.id}
												className={index === 0 ? "overflow-x-auto" : "overflow-x-auto border-t border-zinc-800"}
											>
												<UnifiedDiff oldText={entry.oldText} newText={entry.newText} />
											</div>
										))}
									</div>
								) : null}
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}
