import { diffLines, diffWordsWithSpace } from "diff";
import { ChevronDown, ChevronsUpDown, ChevronUp } from "lucide-react";
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
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

export const CONTEXT_RADIUS = 3;
export const MIN_COLLAPSE_LINES = 8;
export const INCREMENTAL_EXPAND_STEP = 20;
export const INCREMENTAL_EXPAND_THRESHOLD = 40;

export interface InlineDiffSegment {
	key: string;
	text: string;
	tone: "added" | "removed" | "context";
}

export interface UnifiedDiffRow {
	key: string;
	lineNumber: number | null;
	variant: "context" | "added" | "removed";
	text: string;
	segments?: InlineDiffSegment[];
}

export interface CollapsedContextBlock {
	id: string;
	count: number;
	rows: UnifiedDiffRow[];
	expanded: boolean;
}

export type ExpandedBlockState = Record<string, boolean | { top: number; bottom: number }>;

export type DiffDisplayItem =
	| { type: "row"; row: UnifiedDiffRow }
	| { type: "collapsed"; block: CollapsedContextBlock };

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

function getPathBasename(path: string): string {
	const separatorIndex = path.lastIndexOf("/");
	return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export function resolvePrismLanguage(path: string): string | null {
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

export function resolvePrismGrammar(language: string | null): Prism.Grammar | null {
	if (!language) {
		return null;
	}
	return Prism.languages[language] ?? null;
}

function toLines(text: string): string[] {
	const rawLines = text.split("\n");
	return text.endsWith("\n") ? rawLines.slice(0, -1) : rawLines;
}

export function getHighlightedLineHtml(
	line: string,
	grammar: Prism.Grammar | null,
	language: string | null,
): string | null {
	if (!grammar || !language) {
		return null;
	}
	return Prism.highlight(line.length > 0 ? line : " ", grammar, language);
}

export function buildHighlightedLineMap(
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

function buildModifiedSegments(
	oldText: string,
	newText: string,
): {
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
			oldSegments.push({ key: `o-${index}`, text: part.value, tone: "removed" });
			continue;
		}
		if (part.added) {
			newSegments.push({ key: `n-${index}`, text: part.value, tone: "added" });
			continue;
		}
		oldSegments.push({ key: `oc-${index}`, text: part.value, tone: "context" });
		newSegments.push({ key: `nc-${index}`, text: part.value, tone: "context" });
	}
	return { oldSegments, newSegments };
}

export function buildUnifiedDiffRows(oldText: string | null | undefined, newText: string): UnifiedDiffRow[] {
	const rows: UnifiedDiffRow[] = [];
	let oldLine = 1;
	let newLine = 1;
	const changes = diffLines(oldText ?? "", newText, {
		ignoreWhitespace: false,
		stripTrailingCr: true,
		ignoreNewlineAtEof: true,
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

			const removedRows: UnifiedDiffRow[] = [];
			const addedRows: UnifiedDiffRow[] = [];
			let localOldLine = oldLine;
			let localNewLine = newLine;

			for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
				const removedLine = removedLines[pairIndex];
				const addedLine = addedLines[pairIndex];

				if (removedLine != null && addedLine != null) {
					const { oldSegments, newSegments } = buildModifiedSegments(removedLine, addedLine);
					removedRows.push({
						key: `m-old-${localOldLine}-${localNewLine}`,
						lineNumber: localOldLine,
						variant: "removed",
						text: removedLine,
						segments: oldSegments,
					});
					addedRows.push({
						key: `m-new-${localOldLine}-${localNewLine}`,
						lineNumber: localNewLine,
						variant: "added",
						text: addedLine,
						segments: newSegments,
					});
					localOldLine += 1;
					localNewLine += 1;
				} else if (removedLine != null) {
					removedRows.push({
						key: `o-${localOldLine}`,
						lineNumber: localOldLine,
						variant: "removed",
						text: removedLine,
					});
					localOldLine += 1;
				} else if (addedLine != null) {
					addedRows.push({
						key: `n-${localNewLine}`,
						lineNumber: localNewLine,
						variant: "added",
						text: addedLine,
					});
					localNewLine += 1;
				}
			}

			rows.push(...removedRows, ...addedRows);
			oldLine = localOldLine;
			newLine = localNewLine;
			index += 1;
			continue;
		}

		const lines = toLines(change.value);
		for (const line of lines) {
			if (change.added) {
				rows.push({ key: `n-${newLine}`, lineNumber: newLine, variant: "added", text: line });
				newLine += 1;
				continue;
			}
			if (change.removed) {
				rows.push({ key: `o-${oldLine}`, lineNumber: oldLine, variant: "removed", text: line });
				oldLine += 1;
				continue;
			}
			rows.push({ key: `c-${oldLine}-${newLine}`, lineNumber: newLine, variant: "context", text: line });
			oldLine += 1;
			newLine += 1;
		}
	}
	return rows;
}

export function parsePatchToRows(patch: string): UnifiedDiffRow[] {
	if (!patch) {
		return [];
	}
	const rawLines = patch.split("\n");
	if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") {
		rawLines.pop();
	}
	const rows: UnifiedDiffRow[] = [];
	let oldLine = 0;
	let newLine = 0;
	let inHunk = false;

	for (const raw of rawLines) {
		if (raw.startsWith("@@")) {
			inHunk = true;
			const match = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
			if (match) {
				oldLine = Number.parseInt(match[1] ?? "0", 10);
				newLine = Number.parseInt(match[2] ?? "0", 10);
			}
			continue;
		}
		if (!inHunk) {
			continue;
		}
		if (raw.startsWith("+")) {
			rows.push({ key: `n-${newLine}`, lineNumber: newLine, variant: "added", text: raw.slice(1) });
			newLine++;
		} else if (raw.startsWith("-")) {
			rows.push({ key: `o-${oldLine}`, lineNumber: oldLine, variant: "removed", text: raw.slice(1) });
			oldLine++;
		} else if (raw.startsWith(" ")) {
			rows.push({ key: `c-${oldLine}-${newLine}`, lineNumber: newLine, variant: "context", text: raw.slice(1) });
			oldLine++;
			newLine++;
		}
	}
	return enrichRowsWithInlineSegments(rows);
}

/**
 * Post-process rows to add word-level inline diff segments for adjacent
 * removed/added blocks (e.g. rows parsed from a git patch which lack them).
 */
function enrichRowsWithInlineSegments(rows: UnifiedDiffRow[]): UnifiedDiffRow[] {
	const result: UnifiedDiffRow[] = [];
	let index = 0;

	while (index < rows.length) {
		const row = rows[index]!;
		if (row.variant !== "removed") {
			result.push(row);
			index += 1;
			continue;
		}

		// Collect contiguous removed rows
		const removedStart = index;
		while (index < rows.length && rows[index]!.variant === "removed") {
			index += 1;
		}
		const removedBlock = rows.slice(removedStart, index);

		// Collect contiguous added rows immediately following
		const addedStart = index;
		while (index < rows.length && rows[index]!.variant === "added") {
			index += 1;
		}
		const addedBlock = rows.slice(addedStart, index);

		if (addedBlock.length === 0) {
			// Pure deletion — no pairing possible
			result.push(...removedBlock);
			continue;
		}

		// Pair positionally and compute inline segments
		const pairCount = Math.min(removedBlock.length, addedBlock.length);
		for (let pi = 0; pi < pairCount; pi += 1) {
			const removedRow = removedBlock[pi]!;
			const addedRow = addedBlock[pi]!;
			if (!removedRow.segments && !addedRow.segments) {
				const { oldSegments, newSegments } = buildModifiedSegments(removedRow.text, addedRow.text);
				removedBlock[pi] = { ...removedRow, segments: oldSegments };
				addedBlock[pi] = { ...addedRow, segments: newSegments };
			}
		}

		result.push(...removedBlock, ...addedBlock);
	}

	return result;
}

export function buildDisplayItems(rows: UnifiedDiffRow[], expandedBlocks: ExpandedBlockState): DiffDisplayItem[] {
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
				items.push({ type: "row", row });
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
				items.push({ type: "row", row });
			}
			continue;
		}

		const blockId = `ctx-${start}-${index - 1}`;
		const blockState = expandedBlocks[blockId];

		if (blockState === true) {
			// Fully expanded (legacy boolean toggle)
			items.push({
				type: "collapsed",
				block: { id: blockId, count: blockRows.length, rows: blockRows, expanded: true },
			});
			continue;
		}

		if (typeof blockState === "object" && blockState !== null) {
			const topReveal = Math.min(blockState.top, blockRows.length);
			const bottomReveal = Math.min(blockState.bottom, blockRows.length - topReveal);

			// Rows revealed from the top
			for (let ri = 0; ri < topReveal; ri += 1) {
				const row = blockRows[ri];
				if (row) {
					items.push({ type: "row", row });
				}
			}

			// Remaining collapsed middle
			const remainingStart = topReveal;
			const remainingEnd = blockRows.length - bottomReveal;
			if (remainingEnd > remainingStart) {
				const remainingRows = blockRows.slice(remainingStart, remainingEnd);
				items.push({
					type: "collapsed",
					block: { id: blockId, count: remainingRows.length, rows: remainingRows, expanded: false },
				});
			}

			// Rows revealed from the bottom
			for (let ri = blockRows.length - bottomReveal; ri < blockRows.length; ri += 1) {
				const row = blockRows[ri];
				if (row) {
					items.push({ type: "row", row });
				}
			}
			continue;
		}

		// Not expanded at all
		items.push({
			type: "collapsed",
			block: { id: blockId, count: blockRows.length, rows: blockRows, expanded: false },
		});
	}
	return items;
}

export function truncatePathMiddle(path: string, maxLength = 64): string {
	if (path.length <= maxLength) {
		return path;
	}
	const separator = "...";
	const keep = Math.max(8, maxLength - separator.length);
	const head = Math.ceil(keep / 2);
	const tail = Math.floor(keep / 2);
	return `${path.slice(0, head)}${separator}${path.slice(path.length - tail)}`;
}

export function DiffRowText({
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
			return <span className="font-mono kb-diff-text" dangerouslySetInnerHTML={{ __html: highlightedLineHtml }} />;
		}
		return <span className="font-mono kb-diff-text">{row.text || " "}</span>;
	}

	return (
		<span className="font-mono kb-diff-text">
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
							dangerouslySetInnerHTML={{ __html: highlightedSegmentHtml }}
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

export function CollapsedBlockControls({
	block,
	onExpandTop,
	onExpandBottom,
	onExpandAll,
}: {
	block: CollapsedContextBlock;
	onExpandTop: (id: string, count: number) => void;
	onExpandBottom: (id: string, count: number) => void;
	onExpandAll: (id: string) => void;
}): React.ReactElement {
	const count = block.count;

	if (block.expanded) {
		return (
			<Button
				variant="ghost"
				size="sm"
				fill
				icon={<ChevronDown size={12} />}
				className="justify-start text-xs rounded-none my-0.5 !bg-surface-0"
				onClick={() => onExpandAll(block.id)}
			>
				{`Hide ${count} unmodified lines`}
			</Button>
		);
	}

	if (count < INCREMENTAL_EXPAND_THRESHOLD) {
		return (
			<Button
				variant="ghost"
				size="sm"
				fill
				icon={<ChevronsUpDown size={12} />}
				className="justify-start text-xs rounded-none my-0.5 !bg-surface-0"
				onClick={() => onExpandAll(block.id)}
			>
				{`Show ${count} unmodified lines`}
			</Button>
		);
	}

	const step = INCREMENTAL_EXPAND_STEP;

	return (
		<div className="flex items-center gap-0.5 my-0.5">
			<Button
				variant="ghost"
				size="sm"
				icon={<ChevronDown size={12} />}
				className="justify-start text-xs rounded-none !bg-surface-0"
				onClick={() => onExpandTop(block.id, step)}
			>
				{`↓ ${step} lines`}
			</Button>
			<Button
				variant="ghost"
				size="sm"
				icon={<ChevronsUpDown size={12} />}
				className="justify-start text-xs rounded-none !bg-surface-0 flex-1"
				onClick={() => onExpandAll(block.id)}
			>
				{`Show all ${count} lines`}
			</Button>
			<Button
				variant="ghost"
				size="sm"
				icon={<ChevronUp size={12} />}
				className="justify-start text-xs rounded-none !bg-surface-0"
				onClick={() => onExpandBottom(block.id, step)}
			>
				{`↑ ${step} lines`}
			</Button>
		</div>
	);
}

export function useIncrementalExpand(): {
	expandedBlocks: ExpandedBlockState;
	expandTop: (id: string, count: number) => void;
	expandBottom: (id: string, count: number) => void;
	expandAll: (id: string) => void;
} {
	const [expandedBlocks, setExpandedBlocks] = useState<ExpandedBlockState>({});

	const expandTop = useCallback((id: string, count: number) => {
		setExpandedBlocks((prev) => {
			const current = prev[id];
			if (typeof current === "object" && current !== null) {
				return { ...prev, [id]: { top: current.top + count, bottom: current.bottom } };
			}
			return { ...prev, [id]: { top: count, bottom: 0 } };
		});
	}, []);

	const expandBottom = useCallback((id: string, count: number) => {
		setExpandedBlocks((prev) => {
			const current = prev[id];
			if (typeof current === "object" && current !== null) {
				return { ...prev, [id]: { top: current.top, bottom: current.bottom + count } };
			}
			return { ...prev, [id]: { top: 0, bottom: count } };
		});
	}, []);

	const expandAll = useCallback((id: string) => {
		setExpandedBlocks((prev) => {
			const current = prev[id];
			// If it's already fully expanded (true), toggle it off
			if (current === true) {
				const next = { ...prev };
				delete next[id];
				return next;
			}
			return { ...prev, [id]: true };
		});
	}, []);

	return { expandedBlocks, expandTop, expandBottom, expandAll };
}

export function ReadOnlyUnifiedDiff({ rows, path }: { rows: UnifiedDiffRow[]; path: string }): React.ReactElement {
	const { expandedBlocks, expandTop, expandBottom, expandAll } = useIncrementalExpand();
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

	const renderRow = (row: UnifiedDiffRow): React.ReactElement => {
		const baseClass =
			row.variant === "added"
				? "kb-diff-row kb-diff-row-added"
				: row.variant === "removed"
					? "kb-diff-row kb-diff-row-removed"
					: "kb-diff-row kb-diff-row-context";
		const highlightedLineHtml = getHighlightedLineHtml(row.text, prismGrammar, prismLanguage);

		return (
			<div key={row.key} className={baseClass} style={{ cursor: "default" }}>
				<span className="kb-diff-line-number" style={{ color: "var(--color-text-tertiary)" }}>
					<span className="kb-diff-line-number-text">{row.lineNumber ?? ""}</span>
				</span>
				<DiffRowText
					row={row}
					highlightedLineHtml={highlightedLineHtml}
					grammar={prismGrammar}
					language={prismLanguage}
				/>
			</div>
		);
	};

	return (
		<div className="kb-diff-readonly">
			{displayItems.map((item) => {
				if (item.type === "row") {
					return renderRow(item.row);
				}
				return (
					<div key={item.block.id}>
						<CollapsedBlockControls
							block={item.block}
							onExpandTop={expandTop}
							onExpandBottom={expandBottom}
							onExpandAll={expandAll}
						/>
						{item.block.expanded ? item.block.rows.map((row) => renderRow(row)) : null}
					</div>
				);
			})}
		</div>
	);
}
