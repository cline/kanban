import { ChevronDown, ChevronRight, Command, CornerDownLeft, MessageSquare, X } from "lucide-react";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import {
	buildDisplayItems,
	buildHighlightedLineMap,
	buildUnifiedDiffRows,
	DiffRowText,
	getHighlightedLineHtml,
	resolvePrismGrammar,
	resolvePrismLanguage,
	truncatePathMiddle,
	type UnifiedDiffRow,
} from "@/components/shared/diff-renderer";
import { Button } from "@/components/ui/button";
import type { RuntimeWorkspaceFileChange } from "@/runtime/types";
import { buildFileTree } from "@/utils/file-tree";
import { isBinaryFilePath } from "@/utils/is-binary-file-path";
import { isMacPlatform } from "@/utils/platform";

interface FileDiffGroup {
	path: string;
	entries: Array<{
		id: string;
		isBinary: boolean;
		oldText: string | null;
		newText: string;
	}>;
	added: number;
	removed: number;
}

export interface DiffLineComment {
	filePath: string;
	lineNumber: number;
	lineText: string;
	variant: "added" | "removed" | "context";
	comment: string;
}

export type DiffViewMode = "unified" | "split";

function commentKey(filePath: string, lineNumber: number, variant: DiffLineComment["variant"]): string {
	return `${filePath}:${variant}:${lineNumber}`;
}

function formatCommentsForTerminal(comments: DiffLineComment[]): string {
	const lines: string[] = [];
	for (const comment of comments) {
		lines.push(`${comment.filePath}:${comment.lineNumber} | ${comment.lineText}`);
		for (const commentLine of comment.comment.split("\n")) {
			lines.push(`> ${commentLine}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
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

function getSectionTopWithinScrollContainer(container: HTMLElement, section: HTMLElement): number {
	const containerRect = container.getBoundingClientRect();
	const sectionRect = section.getBoundingClientRect();
	return container.scrollTop + sectionRect.top - (containerRect.top + container.clientTop);
}

function InlineComment({
	comment,
	onChange,
	onDelete,
}: {
	comment: DiffLineComment;
	onChange: (text: string) => void;
	onDelete: () => void;
}): React.ReactElement {
	const textAreaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		textAreaRef.current?.focus();
	}, []);

	return (
		<div className="kb-diff-inline-comment">
			<textarea
				ref={textAreaRef}
				value={comment.comment}
				onChange={(event) => onChange(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.preventDefault();
						onDelete();
					}
				}}
				onClick={(event) => event.stopPropagation()}
				placeholder="Add a comment..."
				rows={1}
				className="w-full rounded-md border border-border bg-surface-2 p-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none resize-none"
				style={{ fontSize: 12 }}
			/>
		</div>
	);
}

function UnifiedDiff({
	path,
	oldText,
	newText,
	comments,
	onAddComment,
	onUpdateComment,
	onDeleteComment,
}: {
	path: string;
	oldText: string | null | undefined;
	newText: string;
	comments: Map<string, DiffLineComment>;
	onAddComment: (lineNumber: number, lineText: string, variant: "added" | "removed" | "context") => void;
	onUpdateComment: (lineNumber: number, variant: "added" | "removed" | "context", text: string) => void;
	onDeleteComment: (lineNumber: number, variant: "added" | "removed" | "context") => void;
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

	const renderRow = (row: UnifiedDiffRow): React.ReactElement => {
		const rowKey = row.lineNumber != null ? commentKey(path, row.lineNumber, row.variant) : null;
		const existingComment = rowKey ? comments.get(rowKey) : null;
		const hasComment = existingComment != null;
		const baseClass =
			row.variant === "added"
				? "kb-diff-row kb-diff-row-added"
				: row.variant === "removed"
					? "kb-diff-row kb-diff-row-removed"
					: "kb-diff-row kb-diff-row-context";
		const rowClass = hasComment ? `${baseClass} kb-diff-row-commented` : baseClass;
		const canClickRow = row.lineNumber != null && !hasComment;
		const highlightedLineHtml =
			row.lineNumber == null
				? null
				: row.variant === "removed"
					? (highlightedOldByLine.get(row.lineNumber) ?? null)
					: (highlightedNewByLine.get(row.lineNumber) ?? null);

		const handleRowClick =
			row.lineNumber != null && !hasComment
				? () => {
						onAddComment(row.lineNumber!, row.text, row.variant);
					}
				: undefined;

		return (
			<div key={row.key}>
				<div className={rowClass} style={canClickRow ? undefined : { cursor: "default" }} onClick={handleRowClick}>
					<span className="kb-diff-line-number" style={{ color: "var(--color-text-tertiary)" }}>
						<span className="kb-diff-line-number-text">{row.lineNumber ?? ""}</span>
						{row.lineNumber != null ? (
							<span
								className="kb-diff-comment-gutter"
								onClick={
									hasComment
										? (event) => {
												event.stopPropagation();
												onDeleteComment(row.lineNumber!, row.variant);
											}
										: undefined
								}
								style={hasComment ? { cursor: "pointer" } : undefined}
							>
								<span className="kb-diff-gutter-icon-comment">
									<MessageSquare size={12} />
								</span>
								<span className="kb-diff-gutter-icon-delete">
									<X size={12} className="text-status-red" />
								</span>
							</span>
						) : null}
					</span>
					<DiffRowText
						row={row}
						highlightedLineHtml={highlightedLineHtml}
						grammar={prismGrammar}
						language={prismLanguage}
					/>
				</div>
				{existingComment ? (
					<InlineComment
						comment={existingComment}
						onChange={(text) => onUpdateComment(row.lineNumber!, row.variant, text)}
						onDelete={() => onDeleteComment(row.lineNumber!, row.variant)}
					/>
				) : null}
			</div>
		);
	};

	return (
		<>
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
							onClick={() => toggleBlock(item.block.id)}
							className="!bg-surface-0"
							style={{
								fontSize: 12,
								marginTop: 2,
								marginBottom: 2,
								borderRadius: 0,
								justifyContent: "flex-start",
							}}
						>
							{`${item.block.expanded ? "Hide" : "Show"} ${item.block.count} unmodified lines`}
						</Button>
						{item.block.expanded ? item.block.rows.map((row) => renderRow(row)) : null}
					</div>
				);
			})}
		</>
	);
}

interface SplitDiffRowPair {
	key: string;
	left: UnifiedDiffRow | null;
	right: UnifiedDiffRow | null;
}

function pairRowsForSplit(rows: UnifiedDiffRow[]): SplitDiffRowPair[] {
	const pairs: SplitDiffRowPair[] = [];
	let index = 0;
	while (index < rows.length) {
		const row = rows[index];
		if (!row) {
			index += 1;
			continue;
		}

		if (row.variant === "removed") {
			// Collect contiguous removed block
			const removedStart = index;
			while (index < rows.length && rows[index]!.variant === "removed") {
				index += 1;
			}
			const removedBlock = rows.slice(removedStart, index);

			// Collect contiguous added block immediately following
			const addedStart = index;
			while (index < rows.length && rows[index]!.variant === "added") {
				index += 1;
			}
			const addedBlock = rows.slice(addedStart, index);

			// Pair positionally
			const pairCount = Math.max(removedBlock.length, addedBlock.length);
			for (let pi = 0; pi < pairCount; pi += 1) {
				const left = removedBlock[pi] ?? null;
				const right = addedBlock[pi] ?? null;
				const key =
					left && right
						? `pair-${left.key}-${right.key}`
						: left
							? `pair-left-${left.key}`
							: `pair-right-${right!.key}`;
				pairs.push({ key, left, right });
			}
			continue;
		}

		if (row.variant === "added") {
			pairs.push({
				key: `pair-right-${row.key}`,
				left: null,
				right: row,
			});
			index += 1;
			continue;
		}

		pairs.push({
			key: `pair-context-${row.key}`,
			left: row,
			right: row,
		});
		index += 1;
	}

	return pairs;
}

function isCommentableOnSplitSide(row: UnifiedDiffRow, side: "left" | "right"): boolean {
	if (row.variant === "removed") {
		return side === "left";
	}
	if (row.variant === "added") {
		return side === "right";
	}
	return side === "right";
}

function SplitDiff({
	path,
	oldText,
	newText,
	comments,
	onAddComment,
	onUpdateComment,
	onDeleteComment,
}: {
	path: string;
	oldText: string | null | undefined;
	newText: string;
	comments: Map<string, DiffLineComment>;
	onAddComment: (lineNumber: number, lineText: string, variant: "added" | "removed" | "context") => void;
	onUpdateComment: (lineNumber: number, variant: "added" | "removed" | "context", text: string) => void;
	onDeleteComment: (lineNumber: number, variant: "added" | "removed" | "context") => void;
}): React.ReactElement {
	const [expandedBlocks, setExpandedBlocks] = useState<Record<string, boolean>>({});
	const prismLanguage = useMemo(() => resolvePrismLanguage(path), [path]);
	const prismGrammar = useMemo(() => resolvePrismGrammar(prismLanguage), [prismLanguage]);
	const rows = useMemo(() => buildUnifiedDiffRows(oldText, newText), [oldText, newText]);
	const displayItems = useMemo(() => buildDisplayItems(rows, expandedBlocks), [expandedBlocks, rows]);

	const toggleBlock = useCallback((id: string) => {
		setExpandedBlocks((prev) => ({
			...prev,
			[id]: !prev[id],
		}));
	}, []);

	const renderSide = (row: UnifiedDiffRow, side: "left" | "right"): React.ReactElement => {
		const rowLineNumber = row.lineNumber;
		if (rowLineNumber == null) {
			return <></>;
		}

		const canCommentOnSide = isCommentableOnSplitSide(row, side);
		const rowKey = canCommentOnSide ? commentKey(path, rowLineNumber, row.variant) : null;
		const existingComment = rowKey ? comments.get(rowKey) : null;
		const hasComment = existingComment != null;
		const baseClass =
			row.variant === "added"
				? "kb-diff-row kb-diff-row-added"
				: row.variant === "removed"
					? "kb-diff-row kb-diff-row-removed"
					: "kb-diff-row kb-diff-row-context";
		const rowClass = hasComment
			? `${baseClass} kb-diff-row-commented`
			: canCommentOnSide
				? baseClass
				: `${baseClass} kb-diff-row-noncommentable`;
		const canClickRow = canCommentOnSide && !hasComment;
		const highlightedLineHtml = getHighlightedLineHtml(row.text, prismGrammar, prismLanguage);

		return (
			<div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
				<div
					className={rowClass}
					style={canClickRow ? undefined : { cursor: "default" }}
					onClick={
						canClickRow
							? () => {
									onAddComment(rowLineNumber, row.text, row.variant);
								}
							: undefined
					}
				>
					<span className="kb-diff-line-number" style={{ color: "var(--color-text-tertiary)" }}>
						<span className="kb-diff-line-number-text">{rowLineNumber}</span>
						{canCommentOnSide ? (
							<span
								className="kb-diff-comment-gutter"
								onClick={
									hasComment
										? (event) => {
												event.stopPropagation();
												onDeleteComment(rowLineNumber, row.variant);
											}
										: undefined
								}
								style={hasComment ? { cursor: "pointer" } : undefined}
							>
								<span className="kb-diff-gutter-icon-comment">
									<MessageSquare size={12} />
								</span>
								<span className="kb-diff-gutter-icon-delete">
									<X size={12} className="text-status-red" />
								</span>
							</span>
						) : null}
					</span>
					<DiffRowText
						row={row}
						highlightedLineHtml={highlightedLineHtml}
						grammar={prismGrammar}
						language={prismLanguage}
					/>
				</div>
				{existingComment ? (
					<InlineComment
						comment={existingComment}
						onChange={(text) => onUpdateComment(rowLineNumber, row.variant, text)}
						onDelete={() => onDeleteComment(rowLineNumber, row.variant)}
					/>
				) : null}
			</div>
		);
	};

	const renderPairs = (sourceRows: UnifiedDiffRow[]): React.ReactElement[] => {
		const pairs = pairRowsForSplit(sourceRows);
		return pairs.map((pair) => (
			<div key={pair.key} className="kb-diff-split-grid-row">
				<div
					className={`kb-diff-split-cell ${pair.left ? "kb-diff-split-cell-filled" : "kb-diff-split-cell-placeholder"}`}
				>
					{pair.left ? renderSide(pair.left, "left") : null}
				</div>
				<div
					className={`kb-diff-split-cell kb-diff-split-cell-right ${pair.right ? "kb-diff-split-cell-filled" : "kb-diff-split-cell-placeholder"}`}
				>
					{pair.right ? renderSide(pair.right, "right") : null}
				</div>
			</div>
		));
	};

	const renderDisplayItems = (): React.ReactElement[] => {
		const renderedItems: React.ReactElement[] = [];
		let pendingRows: UnifiedDiffRow[] = [];

		const flushPendingRows = (): void => {
			if (pendingRows.length === 0) {
				return;
			}
			renderedItems.push(...renderPairs(pendingRows));
			pendingRows = [];
		};

		for (const item of displayItems) {
			if (item.type === "row") {
				pendingRows.push(item.row);
				continue;
			}

			flushPendingRows();
			renderedItems.push(
				<div key={item.block.id}>
					<div className="kb-diff-split-grid-row">
						<div className="kb-diff-split-cell kb-diff-split-cell-filled">
							<Button
								variant="ghost"
								size="sm"
								fill
								className="justify-start text-xs rounded-none my-0.5 !bg-surface-0"
								icon={item.block.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								onClick={() => toggleBlock(item.block.id)}
							>
								{`${item.block.expanded ? "Hide" : "Show"} ${item.block.count} unmodified lines`}
							</Button>
						</div>
						<div className="kb-diff-split-cell kb-diff-split-cell-filled kb-diff-split-cell-right">
							<Button
								variant="ghost"
								size="sm"
								fill
								className="justify-start text-xs rounded-none my-0.5 !bg-surface-0"
								icon={item.block.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
								onClick={() => toggleBlock(item.block.id)}
							>
								{`${item.block.expanded ? "Hide" : "Show"} ${item.block.count} unmodified lines`}
							</Button>
						</div>
					</div>
					{item.block.expanded ? renderPairs(item.block.rows) : null}
				</div>,
			);
		}

		flushPendingRows();
		return renderedItems;
	};

	return (
		<div className="kb-diff-split-grid-shell">
			<div className="kb-diff-split-grid-backgrounds" aria-hidden>
				<div className="kb-diff-split-grid-background-column" />
				<div className="kb-diff-split-grid-background-column kb-diff-split-grid-background-column-right" />
			</div>
			<div className="kb-diff-split-grid-content">{renderDisplayItems()}</div>
		</div>
	);
}

export function DiffViewerPanel({
	workspaceFiles,
	selectedPath,
	onSelectedPathChange,
	onAddToTerminal,
	onSendToTerminal,
	comments,
	onCommentsChange,
	viewMode = "unified",
}: {
	workspaceFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	onSelectedPathChange: (path: string) => void;
	onAddToTerminal?: (formatted: string) => void;
	onSendToTerminal?: (formatted: string) => void;
	comments: Map<string, DiffLineComment>;
	onCommentsChange: (comments: Map<string, DiffLineComment>) => void;
	viewMode?: DiffViewMode;
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
			isBinary: isBinaryFilePath(file.path),
			oldText: file.oldText,
			newText: file.newText ?? "",
			additions: file.additions,
			deletions: file.deletions,
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
				isBinary: entry.isBinary,
				oldText: entry.oldText,
				newText: entry.newText,
			});
			if (!entry.isBinary) {
				group.added += entry.additions;
				group.removed += entry.deletions;
			}
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
			if (getSectionTopWithinScrollContainer(container, section) <= probeOffset) {
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
		const sectionStyle = window.getComputedStyle(section);
		const marginTop = Number.parseFloat(sectionStyle.marginTop) || 0;
		const targetScrollTop = Math.max(0, getSectionTopWithinScrollContainer(container, section) - marginTop);
		container.scrollTop = targetScrollTop;
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
		if (syncSelection && syncSelection.path === selectedPath && Date.now() - syncSelection.at < 150) {
			scrollSyncSelectionRef.current = null;
			return;
		}
		scrollSyncSelectionRef.current = null;
		scrollToPath(selectedPath);
	}, [scrollToPath, selectedPath]);

	const handleAddComment = useCallback(
		(filePath: string, lineNumber: number, lineText: string, variant: "added" | "removed" | "context") => {
			const key = commentKey(filePath, lineNumber, variant);
			if (comments.has(key)) {
				return;
			}
			const next = new Map(comments);
			// Remove any existing empty comment boxes before opening a new one
			for (const [existingKey, existingComment] of next) {
				if (existingComment.comment.trim() === "") {
					next.delete(existingKey);
				}
			}
			next.set(key, {
				filePath,
				lineNumber,
				lineText,
				variant,
				comment: "",
			});
			onCommentsChange(next);
		},
		[comments, onCommentsChange],
	);

	const handleUpdateComment = useCallback(
		(filePath: string, lineNumber: number, variant: "added" | "removed" | "context", text: string) => {
			const key = commentKey(filePath, lineNumber, variant);
			const existing = comments.get(key);
			if (!existing) {
				return;
			}
			const next = new Map(comments);
			next.set(key, { ...existing, comment: text });
			onCommentsChange(next);
		},
		[comments, onCommentsChange],
	);

	const handleDeleteComment = useCallback(
		(filePath: string, lineNumber: number, variant: "added" | "removed" | "context") => {
			const next = new Map(comments);
			next.delete(commentKey(filePath, lineNumber, variant));
			onCommentsChange(next);
		},
		[comments, onCommentsChange],
	);

	const nonEmptyComments = useMemo(() => {
		return Array.from(comments.values()).filter((c) => c.comment.trim().length > 0);
	}, [comments]);

	const buildFormattedComments = useCallback((): string | null => {
		if (nonEmptyComments.length === 0) {
			return null;
		}
		const sorted = [...nonEmptyComments].sort((a, b) => {
			const pathCmp = a.filePath.localeCompare(b.filePath);
			if (pathCmp !== 0) {
				return pathCmp;
			}
			return a.lineNumber - b.lineNumber;
		});
		return formatCommentsForTerminal(sorted);
	}, [nonEmptyComments]);

	const handleAddComments = useCallback(() => {
		const formatted = buildFormattedComments();
		if (!formatted || !onAddToTerminal) {
			return;
		}
		onAddToTerminal(formatted);
		onCommentsChange(new Map());
	}, [buildFormattedComments, onAddToTerminal, onCommentsChange]);

	const handleSendComments = useCallback(() => {
		const formatted = buildFormattedComments();
		if (!formatted || !onSendToTerminal) {
			return;
		}
		onSendToTerminal(formatted);
		onCommentsChange(new Map());
	}, [buildFormattedComments, onCommentsChange, onSendToTerminal]);

	const handleClearAllComments = useCallback(() => {
		onCommentsChange(new Map());
	}, [onCommentsChange]);

	const hasAnyComments = comments.size > 0;
	const nonEmptyCount = nonEmptyComments.length;

	useHotkeys(
		"meta+enter,ctrl+enter",
		(event) => {
			if (!onAddToTerminal || nonEmptyCount === 0) {
				return;
			}
			event.preventDefault();
			handleAddComments();
		},
		{
			enabled: Boolean(onAddToTerminal),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[handleAddComments, nonEmptyCount, onAddToTerminal],
	);

	useHotkeys(
		"meta+shift+enter,ctrl+shift+enter",
		(event) => {
			if (!onSendToTerminal || nonEmptyCount === 0) {
				return;
			}
			event.preventDefault();
			handleSendComments();
		},
		{
			enabled: Boolean(onSendToTerminal),
			enableOnFormTags: true,
			enableOnContentEditable: true,
			ignoreEventWhen: (event) => event.defaultPrevented,
			preventDefault: true,
		},
		[handleSendComments, nonEmptyCount, onSendToTerminal],
	);

	return (
		<div
			style={{
				display: "flex",
				flex: "1 1 0",
				flexDirection: "column",
				minWidth: 0,
				minHeight: 0,
				background: "var(--color-surface-0)",
				borderRight: "1px solid var(--color-divider)",
			}}
		>
			{groupedByPath.length === 0 ? (
				<div className="kb-empty-state-center" style={{ flex: 1 }}>
					<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
						<svg
							width="40"
							height="40"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinecap="round"
							strokeLinejoin="round"
						>
							<rect x="3" y="3" width="8" height="18" rx="1" />
							<rect x="13" y="3" width="8" height="18" rx="1" />
						</svg>
					</div>
				</div>
			) : (
				<>
					<div
						ref={scrollContainerRef}
						onScroll={handleDiffScroll}
						style={{
							flex: "1 1 0",
							minHeight: 0,
							overflowY: "auto",
							overscrollBehavior: "contain",
							padding: "0 12px 12px",
						}}
					>
						{groupedByPath.map((group) => {
							const isExpanded = expandedPaths[group.path] ?? true;
							const hasBinaryEntry = group.entries.some((entry) => entry.isBinary);
							return (
								<section
									key={group.path}
									ref={(node) => {
										sectionElementsRef.current[group.path] = node;
									}}
									style={{ marginTop: 12 }}
								>
									<button
										type="button"
										className="kb-diff-file-header flex w-full items-center gap-2 rounded-t-md border border-border bg-surface-1 px-2 py-1.5 text-left text-[12px] text-text-primary hover:bg-surface-3 active:bg-surface-4 cursor-pointer"
										aria-expanded={isExpanded}
										aria-current={selectedPath === group.path ? "true" : undefined}
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
									>
										{isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
										<span className="truncate" title={group.path} style={{ flex: "1 1 auto", minWidth: 0 }}>
											{truncatePathMiddle(group.path)}
										</span>
										<span style={{ flexShrink: 0 }}>
											<span className="text-status-green">+{group.added}</span>{" "}
											<span className="text-status-red">-{group.removed}</span>
											{group.added === 0 && group.removed === 0 && hasBinaryEntry ? (
												<span className="ml-2 text-text-tertiary">Binary</span>
											) : null}
										</span>
									</button>
									{isExpanded ? (
										<div
											className="rounded-b-md border-x border-b border-border bg-surface-1"
											style={{ overflow: "hidden" }}
										>
											{group.entries.map((entry) => (
												<div key={entry.id} className="kb-diff-entry">
													{entry.isBinary ? null : viewMode === "split" ? (
														<SplitDiff
															path={group.path}
															oldText={entry.oldText}
															newText={entry.newText}
															comments={comments}
															onAddComment={(lineNumber, lineText, variant) =>
																handleAddComment(group.path, lineNumber, lineText, variant)
															}
															onUpdateComment={(lineNumber, variant, text) =>
																handleUpdateComment(group.path, lineNumber, variant, text)
															}
															onDeleteComment={(lineNumber, variant) =>
																handleDeleteComment(group.path, lineNumber, variant)
															}
														/>
													) : (
														<UnifiedDiff
															path={group.path}
															oldText={entry.oldText}
															newText={entry.newText}
															comments={comments}
															onAddComment={(lineNumber, lineText, variant) =>
																handleAddComment(group.path, lineNumber, lineText, variant)
															}
															onUpdateComment={(lineNumber, variant, text) =>
																handleUpdateComment(group.path, lineNumber, variant, text)
															}
															onDeleteComment={(lineNumber, variant) =>
																handleDeleteComment(group.path, lineNumber, variant)
															}
														/>
													)}
												</div>
											))}
										</div>
									) : null}
								</section>
							);
						})}
					</div>
					{hasAnyComments && (onAddToTerminal || onSendToTerminal) ? (
						<div className="kb-diff-comments-footer">
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<span className="kb-diff-comments-count text-text-secondary">
									{nonEmptyCount} {nonEmptyCount === 1 ? "comment" : "comments"}
								</span>
								<Button variant="danger" size="sm" onClick={handleClearAllComments}>
									Clear All
								</Button>
							</div>
							<div style={{ display: "flex", gap: 4 }}>
								{onAddToTerminal ? (
									<Button
										variant="default"
										size="sm"
										disabled={nonEmptyCount === 0}
										onClick={handleAddComments}
									>
										<span style={{ display: "inline-flex", alignItems: "center" }}>
											<span>Add</span>
											<span
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: 2,
													marginLeft: 6,
												}}
												aria-hidden
											>
												{isMacPlatform ? <Command size={12} /> : <span style={{ fontSize: 12 }}>Ctrl</span>}
												<CornerDownLeft size={12} />
											</span>
										</span>
									</Button>
								) : null}
								{onSendToTerminal ? (
									<Button
										variant="primary"
										size="sm"
										disabled={nonEmptyCount === 0}
										onClick={handleSendComments}
									>
										<span style={{ display: "inline-flex", alignItems: "center" }}>
											<span>Send</span>
											<span
												style={{
													display: "inline-flex",
													alignItems: "center",
													gap: 2,
													marginLeft: 6,
												}}
												aria-hidden
											>
												{isMacPlatform ? <Command size={12} /> : <span style={{ fontSize: 12 }}>Ctrl</span>}
												<span style={{ fontSize: 12 }}>Shift</span>
												<CornerDownLeft size={12} />
											</span>
										</span>
									</Button>
								) : null}
							</div>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
