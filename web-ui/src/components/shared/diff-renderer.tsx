import { diffLines, diffWordsWithSpace } from "diff";
import { ChevronDown, ChevronRight } from "lucide-react";
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

const CONTEXT_RADIUS = 3;
const MIN_COLLAPSE_LINES = 8;

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
	const changes = diffLines(oldText ?? "", newText, { ignoreWhitespace: false });

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
					rows.push({ key: `o-${oldLine}`, lineNumber: oldLine, variant: "removed", text: removedLine });
					oldLine += 1;
					continue;
				}
				if (addedLine != null) {
					rows.push({ key: `n-${newLine}`, lineNumber: newLine, variant: "added", text: addedLine });
					newLine += 1;
				}
			}
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
	return rows;
}

export function buildDisplayItems(rows: UnifiedDiffRow[], expandedBlocks: Record<string, boolean>): DiffDisplayItem[] {
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
		items.push({
			type: "collapsed",
			block: { id: blockId, count: blockRows.length, rows: blockRows, expanded: expandedBlocks[blockId] === true },
		});
	}
	return items;
}

export function countAddedRemoved(
	oldText: string | null | undefined,
	newText: string,
): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	const changes = diffLines(oldText ?? "", newText, { ignoreWhitespace: false });
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
			return (
				<span
					className="font-mono kb-diff-text"
					dangerouslySetInnerHTML={{ __html: highlightedLineHtml }}
				/>
			);
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

export function ReadOnlyUnifiedDiff({ rows, path }: { rows: UnifiedDiffRow[]; path: string }): React.ReactElement {
	const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

	const toggleBlock = useCallback((id: string) => {
		setExpandedBlocks((prev) => ({ ...prev, [id]: !prev[id] }));
	}, []);

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
						<Button
							variant="ghost"
							size="sm"
							fill
							icon={item.block.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
							className="justify-start text-xs rounded-none mt-0.5 mb-0.5"
							onClick={() => toggleBlock(item.block.id)}
						>
							{`${item.block.expanded ? "Hide" : "Show"} ${item.block.count} unmodified lines`}
						</Button>
						{item.block.expanded ? item.block.rows.map((row) => renderRow(row)) : null}
					</div>
				);
			})}
		</div>
	);
}
