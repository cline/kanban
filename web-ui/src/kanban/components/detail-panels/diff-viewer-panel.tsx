import { Button, Card, Classes, Colors, Icon, NonIdealState, TextArea } from "@blueprintjs/core";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { panelSeparatorColor } from "@/kanban/data/column-colors";
import { buildFileTree } from "@/kanban/utils/file-tree";
import type { RuntimeWorkspaceFileChange } from "@/kanban/runtime/types";
import {
	type UnifiedDiffRow,
	buildUnifiedDiffRows,
	buildDisplayItems,
	buildHighlightedLineMap,
	countAddedRemoved,
	DiffRowText,
	resolvePrismLanguage,
	resolvePrismGrammar,
	truncatePathMiddle,
} from "@/kanban/components/shared/diff-renderer";

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

export interface DiffLineComment {
	filePath: string;
	lineNumber: number;
	lineText: string;
	variant: "added" | "removed" | "context";
	comment: string;
}

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
			<TextArea
				inputRef={textAreaRef}
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
				autoResize
				rows={1}
				fill
				style={{ fontSize: "var(--bp-typography-size-body-small)" }}
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
					? highlightedOldByLine.get(row.lineNumber) ?? null
					: highlightedNewByLine.get(row.lineNumber) ?? null;

		const handleRowClick = row.lineNumber != null && !hasComment ? () => {
			onAddComment(row.lineNumber!, row.text, row.variant);
		} : undefined;

		return (
			<div key={row.key}>
				<div className={rowClass} style={canClickRow ? undefined : { cursor: "default" }} onClick={handleRowClick}>
					<span className="kb-diff-line-number" style={{ color: Colors.GRAY2 }}>
						<span className="kb-diff-line-number-text">{row.lineNumber ?? ""}</span>
						{row.lineNumber != null ? (
							<span
								className="kb-diff-comment-gutter"
								onClick={hasComment ? (event) => { event.stopPropagation(); onDeleteComment(row.lineNumber!, row.variant); } : undefined}
								style={hasComment ? { cursor: "pointer" } : undefined}
							>
								<span className="kb-diff-gutter-icon-comment"><Icon icon="comment" size={12} /></span>
								<span className="kb-diff-gutter-icon-delete"><Icon icon="cross" size={12} color={Colors.RED5} /></span>
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
	onAddToTerminal,
	onSendToTerminal,
	comments,
	onCommentsChange,
}: {
	workspaceFiles: RuntimeWorkspaceFileChange[] | null;
	selectedPath: string | null;
	onSelectedPathChange: (path: string) => void;
	onAddToTerminal?: (formatted: string) => void;
	onSendToTerminal?: (formatted: string) => void;
	comments: Map<string, DiffLineComment>;
	onCommentsChange: (comments: Map<string, DiffLineComment>) => void;
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

	const handleAddComment = useCallback((filePath: string, lineNumber: number, lineText: string, variant: "added" | "removed" | "context") => {
		const key = commentKey(filePath, lineNumber, variant);
		if (comments.has(key)) {
			return;
		}
		const next = new Map(comments);
		next.set(key, {
			filePath,
			lineNumber,
			lineText,
			variant,
			comment: "",
		});
		onCommentsChange(next);
	}, [comments, onCommentsChange]);

	const handleUpdateComment = useCallback((filePath: string, lineNumber: number, variant: "added" | "removed" | "context", text: string) => {
		const key = commentKey(filePath, lineNumber, variant);
		const existing = comments.get(key);
		if (!existing) {
			return;
		}
		const next = new Map(comments);
		next.set(key, { ...existing, comment: text });
		onCommentsChange(next);
	}, [comments, onCommentsChange]);

	const handleDeleteComment = useCallback((filePath: string, lineNumber: number, variant: "added" | "removed" | "context") => {
		const next = new Map(comments);
		next.delete(commentKey(filePath, lineNumber, variant));
		onCommentsChange(next);
	}, [comments, onCommentsChange]);

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

	return (
		<div style={{ display: "flex", flex: "1 1 0", flexDirection: "column", minWidth: 0, minHeight: 0, background: Colors.DARK_GRAY1, borderRight: `1px solid ${panelSeparatorColor}` }}>
			{groupedByPath.length === 0 ? (
				<div className="kb-empty-state-center" style={{ flex: 1 }}>
					<NonIdealState icon="comparison" />
				</div>
			) : (
				<>
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
																comments={comments}
																onAddComment={(lineNumber, lineText, variant) =>
																	handleAddComment(group.path, lineNumber, lineText, variant)
																}
																onUpdateComment={(lineNumber, variant, text) => handleUpdateComment(group.path, lineNumber, variant, text)}
																onDeleteComment={(lineNumber, variant) => handleDeleteComment(group.path, lineNumber, variant)}
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
					{hasAnyComments && (onAddToTerminal || onSendToTerminal) ? (
						<div className="kb-diff-comments-footer">
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<span className={Classes.TEXT_MUTED}>{nonEmptyCount} {nonEmptyCount === 1 ? "comment" : "comments"}</span>
								<Button text="Clear All" variant="minimal" size="small" intent="danger" onClick={handleClearAllComments} />
							</div>
							<div style={{ display: "flex", gap: 4 }}>
								{onAddToTerminal ? <Button text="Add" variant="outlined" size="small" disabled={nonEmptyCount === 0} onClick={handleAddComments} /> : null}
								{onSendToTerminal ? <Button text="Send" intent="primary" variant="solid" size="small" disabled={nonEmptyCount === 0} onClick={handleSendComments} /> : null}
							</div>
						</div>
					) : null}
				</>
			)}
		</div>
	);
}
