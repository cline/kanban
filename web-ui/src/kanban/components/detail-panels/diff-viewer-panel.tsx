import { diffLines, diffWordsWithSpace } from "diff";
import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-python";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";
import { Button, Card, Classes, Colors, Icon, NonIdealState } from "@blueprintjs/core";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { panelSeparatorColor } from "@/kanban/data/column-colors";
import { buildFileTree } from "@/kanban/utils/file-tree";
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

const PRISM_LANGUAGE_BY_EXTENSION: Record<string, string> = {
	bash: "bash",
	c: "c",
	cc: "cpp",
	cjs: "javascript",
	cpp: "cpp",
	cs: "csharp",
	css: "css",
	cxx: "cpp",
	go: "go",
	h: "c",
	hh: "cpp",
	hpp: "cpp",
	htm: "markup",
	html: "markup",
	java: "java",
	js: "javascript",
	json: "json",
	jsx: "jsx",
	md: "markdown",
	mdx: "markdown",
	mjs: "javascript",
	php: "php",
	py: "python",
	rb: "ruby",
	rs: "rust",
	scss: "css",
	sh: "bash",
	sql: "sql",
	svg: "markup",
	swift: "swift",
	ts: "typescript",
	tsx: "tsx",
	xml: "markup",
	yaml: "yaml",
	yml: "yaml",
	zsh: "bash",
};

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

function getPathBasename(path: string): string {
	const separatorIndex = path.lastIndexOf("/");
	return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

function resolvePrismLanguage(path: string): string | null {
	const basename = getPathBasename(path).toLowerCase();
	if (basename === "dockerfile") {
		return "bash";
	}
	const dotIndex = basename.lastIndexOf(".");
	if (dotIndex < 0 || dotIndex === basename.length - 1) {
		return null;
	}
	const extension = basename.slice(dotIndex + 1);
	const language = PRISM_LANGUAGE_BY_EXTENSION[extension];
	if (!language) {
		return null;
	}
	return Prism.languages[language] ? language : null;
}

function resolvePrismGrammar(language: string | null): Prism.Grammar | null {
	if (!language) {
		return null;
	}
	return Prism.languages[language] ?? null;
}

function toLines(text: string): string[] {
	const rawLines = text.split("\n");
	return text.endsWith("\n") ? rawLines.slice(0, -1) : rawLines;
}

function getHighlightedLineHtml(
	line: string,
	grammar: Prism.Grammar | null,
	language: string | null,
): string | null {
	if (!grammar || !language) {
		return null;
	}
	return Prism.highlight(line.length > 0 ? line : " ", grammar, language);
}

function buildHighlightedLineMap(
	text: string | null | undefined,
	grammar: Prism.Grammar | null,
	language: string | null,
): Map<number, string> {
	const lines = toLines(text ?? "");
	const highlightedByLine = new Map<number, string>();
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const highlighted = getHighlightedLineHtml(line, grammar, language);
		if (highlighted != null) {
			highlightedByLine.set(index + 1, highlighted);
		}
	}
	return highlightedByLine;
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

function DiffRowText({
	row,
	highlightedLineHtml,
	grammar,
	language,
}: {
	row: UnifiedDiffRow;
	highlightedLineHtml: string | null;
	grammar: Prism.Grammar | null;
	language: string | null;
}): React.ReactElement {
	if (!row.segments) {
		if (highlightedLineHtml) {
			return (
				<span
					className={`${Classes.MONOSPACE_TEXT} kb-diff-text`}
					dangerouslySetInnerHTML={{ __html: highlightedLineHtml }}
				/>
			);
		}
		return <span className={`${Classes.MONOSPACE_TEXT} kb-diff-text`}>{row.text || " "}</span>;
	}

	return (
		<span className={`${Classes.MONOSPACE_TEXT} kb-diff-text`}>
			{row.segments.map((segment) => {
				const className =
					segment.tone === "added"
						? "kb-diff-segment-added"
						: segment.tone === "removed"
							? "kb-diff-segment-removed"
							: undefined;
				const highlightedSegmentHtml = getHighlightedLineHtml(segment.text, grammar, language);
				if (highlightedSegmentHtml) {
					return (
						<span
							key={segment.key}
							className={className}
							dangerouslySetInnerHTML={{
								__html: highlightedSegmentHtml,
							}}
						/>
					);
				}
				return (
					<span key={segment.key} className={className}>
						{segment.text || " "}
					</span>
				);
			})}
		</span>
	);
}

function UnifiedDiff({
	path,
	oldText,
	newText,
}: {
	path: string;
	oldText: string | null | undefined;
	newText: string;
}): React.ReactElement {
	const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);
	const highlightedOldByLine = useMemo(
		() => buildHighlightedLineMap(oldText, prismGrammar, prismLanguage),
		[oldText, prismGrammar, prismLanguage],
	);
	const highlightedNewByLine = useMemo(
		() => buildHighlightedLineMap(newText, prismGrammar, prismLanguage),
		[newText, prismGrammar, prismLanguage],
	);
	const rows = useMemo(() => buildUnifiedDiffRows(oldText, newText), [oldText, newText]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

	const toggleBlock = useCallback((id: string) => {
		setExpandedBlocks((prev) => ({
			...prev,
			[id]: !prev[id],
		}));
	}, []);

	const renderRow = useCallback((row: UnifiedDiffRow): React.ReactElement => {
			const rowClass =
				row.variant === "added"
				? "kb-diff-row kb-diff-row-added"
				: row.variant === "removed"
					? "kb-diff-row kb-diff-row-removed"
						: "kb-diff-row kb-diff-row-context";
			const highlightedLineHtml =
				row.lineNumber == null
					? null
					: row.variant === "removed"
						? highlightedOldByLine.get(row.lineNumber) ?? null
						: highlightedNewByLine.get(row.lineNumber) ?? null;

			return (
				<div key={row.key} className={rowClass}>
					<span style={{ color: Colors.GRAY2, textAlign: "right", userSelect: "none" }}>{row.lineNumber ?? ""}</span>
					<DiffRowText
						row={row}
						highlightedLineHtml={highlightedLineHtml}
						grammar={prismGrammar}
						language={prismLanguage}
					/>
				</div>
			);
		}, [highlightedNewByLine, highlightedOldByLine, prismGrammar, prismLanguage]);

	return (
		<>
			{displayItems.map((item) => {
				if (item.type === "row") {
					return renderRow(item.row);
				}

				return (
					<div key={item.block.id}>
						<Button
							variant="minimal"
							size="small"
							fill
							alignText="left"
							icon={<Icon icon={item.block.expanded ? "chevron-down" : "chevron-right"} size={12} />}
							text={`${item.block.expanded ? "Hide" : "Show"} ${item.block.count} unmodified lines`}
							onClick={() => toggleBlock(item.block.id)}
							style={{ fontSize: 12, marginTop: 2, marginBottom: 2, borderRadius: 0 }}
						/>
						{item.block.expanded ? item.block.rows.map((row) => renderRow(row)) : null}
					</div>
				);
			})}
		</>
	);
}

export function DiffViewerPanel({
	workspaceFiles,
	selectedPath,
	onSelectedPathChange,
}: {
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
		return (workspaceFiles ?? []).map((file, index) => ({
			id: `workspace-${file.path}-${index}`,
			path: file.path,
			oldText: file.oldText,
			newText: file.newText ?? "",
			timestamp: 0,
			toolTitle: `${file.status} (${file.additions}+/${file.deletions}-)`,
		}));
	}, [workspaceFiles]);

	const groupedByPath = useMemo((): FileDiffGroup[] => {
		const sourcePaths = workspaceFiles?.map((file) => file.path) ?? [];
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
	}, [diffEntries, workspaceFiles]);

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
		<div style={{ display: "flex", flex: "1 1 0", flexDirection: "column", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1, borderRight: `1px solid ${panelSeparatorColor}` }}>
			{groupedByPath.length === 0 ? (
				<div className="kb-empty-state-center" style={{ flex: 1 }}>
					<NonIdealState icon="comparison" />
				</div>
			) : (
				<div
					ref={scrollContainerRef}
					onScroll={handleDiffScroll}
					style={{ flex: "1 1 0", minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", padding: 12 }}
				>
					{groupedByPath.map((group) => {
						const isExpanded = expandedPaths[group.path] ?? true;
						return (
							<section
								key={group.path}
								ref={(node) => {
									sectionElementsRef.current[group.path] = node;
								}}
								style={{ marginBottom: 12 }}
							>
								<Card compact interactive={false} style={{ overflow: "hidden", padding: 0 }}>
									<Button
										variant="minimal"
										fill
										alignText="left"
										className="kb-diff-file-header"
										aria-expanded={isExpanded}
										aria-current={selectedPath === group.path ? "true" : undefined}
										icon={<Icon icon={isExpanded ? "chevron-down" : "chevron-right"} size={12} />}
										onClick={() => {
											const container = scrollContainerRef.current;
											const sectionEl = sectionElementsRef.current[group.path];
											const previousTop = sectionEl?.getBoundingClientRect().top ?? null;
											const nextExpanded = !(expandedPaths[group.path] ?? true);
											suppressScrollSyncUntilRef.current = Date.now() + 250;
											setExpandedPaths((prev) => ({
												...prev,
												[group.path]: nextExpanded,
											}));
											requestAnimationFrame(() => {
												if (previousTop == null || !container || !sectionEl) {
													return;
												}
												const nextTop = sectionEl.getBoundingClientRect().top;
												container.scrollTop += nextTop - previousTop;
											});
										}}
											text={
												<span className={Classes.TEXT_OVERFLOW_ELLIPSIS} title={group.path}>
													{truncatePathMiddle(group.path)}
												</span>
											}
											endIcon={
												<span>
													<span style={{ color: Colors.GREEN5 }}>+{group.added}</span>
													{" "}
													<span style={{ color: Colors.RED5 }}>-{group.removed}</span>
												</span>
											}
									/>
										{isExpanded ? (
											<div>
												{group.entries.map((entry) => (
												<div
													key={entry.id}
														className="kb-diff-entry"
													>
														<UnifiedDiff
															path={group.path}
															oldText={entry.oldText}
															newText={entry.newText}
														/>
													</div>
												))}
											</div>
									) : null}
								</Card>
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}
