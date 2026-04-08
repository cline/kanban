import { ArrowDown, ArrowUp, Cloud, GitBranch, Locate } from "lucide-react";
import { useMemo, useRef } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { Virtuoso } from "react-virtuoso";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeGitCommit, RuntimeGitRef } from "@/runtime/types";

function formatRelativeDate(isoDate: string): string {
	const date = new Date(isoDate);
	const now = Date.now();
	const diffMs = now - date.getTime();
	const seconds = Math.floor(diffMs / 1000);
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	if (months < 12) return `${months}mo ago`;
	return `${Math.floor(months / 12)}y ago`;
}

function getInitials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 0 || !parts[0]) return "?";
	if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
	const last = parts[parts.length - 1];
	return (parts[0].charAt(0) + (last?.charAt(0) ?? "")).toUpperCase();
}

function hashToColor(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		hash = str.charCodeAt(i) + ((hash << 5) - hash);
	}
	const hue = Math.abs(hash) % 360;
	return `oklch(0.65 0.12 ${hue})`;
}

const GRAPH_LANE_COLORS = [
	"var(--color-status-blue)",
	"var(--color-status-green)",
	"var(--color-status-orange)",
	"var(--color-status-violet)",
	"var(--color-status-rose)",
	"var(--color-status-cyan)",
	"var(--color-status-lime)",
	"var(--color-status-gold)",
];
const REMOTE_LANE_COLOR = "color-mix(in srgb, var(--color-status-blue) 75%, white 10%)";

const REF_BADGE_BACKGROUND_SELECTED = "color-mix(in srgb, white 20%, transparent)";
const REF_BADGE_BACKGROUND_HEAD = "color-mix(in srgb, var(--color-status-blue) 15%, transparent)";
const REF_BADGE_BACKGROUND_REMOTE = "color-mix(in srgb, var(--color-status-blue) 12%, transparent)";
const REF_BADGE_BACKGROUND_DEFAULT = "color-mix(in srgb, white 6%, transparent)";

interface GraphLane {
	hash: string;
	color: string;
}

interface GraphRow {
	commit: RuntimeGitCommit;
	commitLane: number;
	lanes: GraphLane[];
	mergeFromLanes: number[];
	convergingLanes: number[];
	splitFromLane: number | null;
	commitStartsLane: boolean;
	isFirst: boolean;
}

function buildGraph(commits: RuntimeGitCommit[]): GraphRow[] {
	const rows: GraphRow[] = [];
	let lanes: GraphLane[] = [];
	let colorIndex = 0;

	function nextColor(): string {
		const color = GRAPH_LANE_COLORS[colorIndex % GRAPH_LANE_COLORS.length] ?? GRAPH_LANE_COLORS[0]!;
		colorIndex++;
		return color;
	}

	for (let ci = 0; ci < commits.length; ci++) {
		const commit = commits[ci]!;
		let commitStartsLane = false;
		let commitLane = lanes.findIndex((l) => l.hash === commit.hash);
		if (commitLane === -1) {
			commitStartsLane = true;
			commitLane = lanes.length;
			lanes.push({
				hash: commit.hash,
				color: commit.relation === "upstream" ? REMOTE_LANE_COLOR : nextColor(),
			});
		}

		const currentLanes = lanes.map((l) => ({ ...l }));
		const mergeFromLanes: number[] = [];
		const convergingLanes = currentLanes
			.map((lane, laneIndex) => (lane.hash === commit.hash && laneIndex !== commitLane ? laneIndex : -1))
			.filter((laneIndex) => laneIndex !== -1);
		let splitFromLane: number | null = null;

		const firstParent = commit.parentHashes[0];
		const otherParents = commit.parentHashes.slice(1);
		const firstParentLane = firstParent ? currentLanes.findIndex((lane) => lane.hash === firstParent) : -1;
		if (commitLane === currentLanes.length - 1 && firstParentLane !== -1 && firstParentLane !== commitLane) {
			splitFromLane = firstParentLane;
		}

		if (firstParent) {
			lanes[commitLane] = { hash: firstParent, color: currentLanes[commitLane]?.color ?? nextColor() };
		} else {
			lanes = lanes.filter((_, i) => i !== commitLane);
		}

		for (const parentHash of otherParents) {
			const existingLane = lanes.findIndex((l) => l.hash === parentHash);
			if (existingLane !== -1) {
				mergeFromLanes.push(existingLane);
			} else {
				const newLane = lanes.length;
				lanes.push({ hash: parentHash, color: nextColor() });
				mergeFromLanes.push(newLane);
			}
		}

		lanes = lanes.filter((lane, laneIndex, currentLanesAfterUpdate) => {
			return currentLanesAfterUpdate.findIndex((candidate) => candidate.hash === lane.hash) === laneIndex;
		});

		rows.push({
			commit,
			commitLane,
			lanes: currentLanes,
			mergeFromLanes,
			convergingLanes,
			splitFromLane,
			commitStartsLane,
			isFirst: ci === 0,
		});
	}

	return rows;
}

const ROW_HEIGHT = 50;
const LANE_WIDTH = 12;
const NODE_RADIUS = 4;
const GRAPH_LEFT_PAD = 8;

function laneX(lane: number): number {
	return GRAPH_LEFT_PAD + lane * LANE_WIDTH + LANE_WIDTH / 2;
}

function graphContentLeft(row: GraphRow): number {
	let rightmostLane = row.commitLane;
	for (let i = 0; i < row.lanes.length; i++) {
		if (i > rightmostLane) rightmostLane = i;
	}
	for (const ml of row.mergeFromLanes) {
		if (ml > rightmostLane) rightmostLane = ml;
	}
	return GRAPH_LEFT_PAD + (rightmostLane + 1) * LANE_WIDTH + 4;
}

function GraphSvg({ row, maxLanes }: { row: GraphRow; maxLanes: number }): React.ReactElement {
	const width = GRAPH_LEFT_PAD + maxLanes * LANE_WIDTH + LANE_WIDTH;
	const centerY = ROW_HEIGHT / 2;
	const commitX = laneX(row.commitLane);
	const commitColor = row.lanes[row.commitLane]?.color ?? GRAPH_LANE_COLORS[0]!;
	const isUpstreamCommit = row.commit.relation === "upstream";

	return (
		<svg width={width} height={ROW_HEIGHT} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
			{row.lanes.map((lane, i) => {
				const x = laneX(i);
				const isConvergingLane = row.convergingLanes.includes(i);
				const isSplitCommitLane = row.splitFromLane !== null && i === row.commitLane;
				const isCommitStartLane = row.commitStartsLane && i === row.commitLane;
				const y1 = row.isFirst || (isCommitStartLane && !isSplitCommitLane) ? centerY : 0;
				const y2 = isConvergingLane || isSplitCommitLane ? centerY : ROW_HEIGHT;
				return <line key={`pass-${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke={lane.color} strokeWidth={2.5} />;
			})}
			{row.splitFromLane !== null ? (
				<path
					key={`split-${row.splitFromLane}`}
					d={`M ${laneX(row.splitFromLane)} ${ROW_HEIGHT} C ${laneX(row.splitFromLane)} ${ROW_HEIGHT - 10}, ${commitX} ${centerY + 10}, ${commitX} ${centerY}`}
					fill="none"
					stroke={row.lanes[row.splitFromLane]?.color ?? commitColor}
					strokeWidth={2.5}
				/>
			) : null}
			{row.mergeFromLanes.map((fromLane) => (
				<path
					key={`merge-${fromLane}`}
					d={`M ${commitX} ${centerY} C ${commitX} ${centerY + 14}, ${laneX(fromLane)} ${centerY + 6}, ${laneX(fromLane)} ${ROW_HEIGHT}`}
					fill="none"
					stroke={row.lanes[fromLane]?.color ?? commitColor}
					strokeWidth={2.5}
				/>
			))}
			{row.convergingLanes.map((fromLane) => (
				<path
					key={`converge-${fromLane}`}
					d={`M ${laneX(fromLane)} ${centerY} C ${laneX(fromLane)} ${centerY + 8}, ${commitX} ${centerY + 8}, ${commitX} ${centerY}`}
					fill="none"
					stroke={row.lanes[fromLane]?.color ?? commitColor}
					strokeWidth={2.5}
				/>
			))}
			<circle
				cx={commitX}
				cy={centerY}
				r={isUpstreamCommit ? NODE_RADIUS + 0.5 : NODE_RADIUS}
				fill={isUpstreamCommit ? "var(--color-surface-0)" : commitColor}
				stroke={commitColor}
				strokeWidth={isUpstreamCommit ? 2 : 0}
			/>
		</svg>
	);
}

function getRefDisplayOrder(ref: RuntimeGitRef): number {
	if (ref.isHead) {
		return 0;
	}
	if (ref.type === "detached") {
		return 1;
	}
	if (ref.type === "branch") {
		return 2;
	}
	return 3;
}

function getRefBadgeBackground(ref: RuntimeGitRef, isSelected: boolean): string {
	if (isSelected) {
		return REF_BADGE_BACKGROUND_SELECTED;
	}
	if (ref.isHead) {
		return REF_BADGE_BACKGROUND_HEAD;
	}
	if (ref.type === "remote") {
		return REF_BADGE_BACKGROUND_REMOTE;
	}
	return REF_BADGE_BACKGROUND_DEFAULT;
}

function getRefBadgeColor(ref: RuntimeGitRef, isSelected: boolean): string {
	if (isSelected) {
		return "var(--color-text-primary)";
	}
	if (ref.isHead) {
		return "var(--color-status-blue)";
	}
	return "var(--color-text-secondary)";
}

export function GitCommitListPanel({
	commits,
	totalCount,
	selectedCommitHash,
	isLoading,
	isLoadingMore,
	canLoadMore,
	errorMessage,
	refs,
	panelWidth,
	onSelectCommit,
	onLoadMore,
}: {
	commits: RuntimeGitCommit[];
	totalCount: number;
	selectedCommitHash: string | null;
	isLoading: boolean;
	isLoadingMore: boolean;
	canLoadMore: boolean;
	errorMessage?: string | null;
	refs: RuntimeGitRef[];
	panelWidth: number;
	onSelectCommit: (commit: RuntimeGitCommit) => void;
	onLoadMore?: () => void;
}): React.ReactElement {
	const refsByHash = useMemo(() => {
		const map = new Map<string, RuntimeGitRef[]>();
		for (const ref of refs) {
			const existing = map.get(ref.hash) ?? [];
			existing.push(ref);
			map.set(ref.hash, existing);
		}
		return map;
	}, [refs]);

	const graphRows = useMemo(() => buildGraph(commits), [commits]);
	const maxLanes = useMemo(() => {
		let max = 0;
		for (const row of graphRows) {
			if (row.lanes.length > max) max = row.lanes.length;
			for (const ml of row.mergeFromLanes) {
				if (ml + 1 > max) max = ml + 1;
			}
		}
		return Math.max(max, 1);
	}, [graphRows]);

	const commitListRef = useRef<HTMLDivElement | null>(null);

	useHotkeys(
		"up,down",
		(event) => {
			const currentIndex = commits.findIndex((c) => c.hash === selectedCommitHash);
			if (currentIndex === -1) {
				return;
			}
			const nextIndex =
				event.key === "ArrowUp" ? Math.max(0, currentIndex - 1) : Math.min(commits.length - 1, currentIndex + 1);
			const nextCommit = commits[nextIndex];
			if (nextCommit) {
				onSelectCommit(nextCommit);
			}
		},
		{
			ignoreEventWhen: (event) => {
				const currentTarget = commitListRef.current;
				if (!currentTarget || !(event.target instanceof Node)) {
					return true;
				}
				return !currentTarget.contains(event.target);
			},
			preventDefault: true,
		},
		[commits, onSelectCommit, selectedCommitHash],
	);

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				width: panelWidth,
				minWidth: 260,
				flexShrink: 0,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "10px 12px 6px",
					fontSize: 10,
					fontWeight: 600,
					textTransform: "uppercase",
					letterSpacing: "0.05em",
					color: "var(--color-text-tertiary)",
				}}
			>
				Commits
				{totalCount > 0 ? (
					<span style={{ fontWeight: 400, marginLeft: 6, textTransform: "none", letterSpacing: 0 }}>
						({commits.length}
						{totalCount > commits.length ? ` of ${totalCount}` : ""})
					</span>
				) : null}
			</div>

			<div
				ref={commitListRef}
				tabIndex={0}
				style={{
					flex: "1 1 0",
					overflowY: "auto",
					overscrollBehavior: "contain",
					outline: "none",
				}}
			>
				{isLoading ? (
					<div style={{ padding: "8px 12px" }}>
						{Array.from({ length: 8 }, (_, i) => (
							<div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
								<div className="animate-pulse rounded-full bg-surface-3" style={{ width: 28, height: 28 }} />
								<div style={{ flex: 1 }}>
									<div
										className="animate-pulse rounded bg-surface-3"
										style={{ height: 13, width: `${65 + (i % 3) * 10}%`, marginBottom: 4 }}
									/>
									<div className="animate-pulse rounded bg-surface-3" style={{ height: 11, width: "40%" }} />
								</div>
							</div>
						))}
					</div>
				) : errorMessage ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							height: "100%",
							padding: 16,
						}}
					>
						<div
							style={{
								textAlign: "center",
								color: "var(--color-text-tertiary)",
								fontSize: 12,
							}}
						>
							<div style={{ color: "var(--color-status-red)", marginBottom: 6 }}>Could not load commits</div>
							<div>{errorMessage}</div>
						</div>
					</div>
				) : commits.length === 0 ? (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							height: "100%",
							color: "var(--color-text-tertiary)",
							fontSize: 12,
						}}
					>
						No commits
					</div>
				) : (
					<Virtuoso
						style={{ height: "100%" }}
						data={commits}
						endReached={() => {
							if (canLoadMore) {
								onLoadMore?.();
							}
						}}
						computeItemKey={(_, commit) => commit.hash}
						itemContent={(index, commit) => {
							const isSelected = commit.hash === selectedCommitHash;
							const commitRefs = refsByHash.get(commit.hash);
							const graphRow = graphRows[index];
							const sortedCommitRefs = commitRefs
								? [...commitRefs].sort((left, right) => {
										const orderDifference = getRefDisplayOrder(left) - getRefDisplayOrder(right);
										return orderDifference !== 0 ? orderDifference : left.name.localeCompare(right.name);
									})
								: null;
							const isUpstreamCommit = commit.relation === "upstream";

							return (
								<button
									key={commit.hash}
									type="button"
									onClick={() => onSelectCommit(commit)}
									className={isSelected ? "kb-git-commit-row kb-git-commit-row-selected" : "kb-git-commit-row"}
									style={{
										position: "relative",
										display: "flex",
										alignItems: "center",
										width: "100%",
										height: ROW_HEIGHT,
										padding: 0,
										paddingLeft: graphRow ? graphContentLeft(graphRow) : GRAPH_LEFT_PAD,
										border: "none",
										color: "inherit",
										textAlign: "left",
										fontFamily: "inherit",
										fontSize: 12,
										cursor: "pointer",
										gap: 6,
										borderBottom: "1px solid var(--color-border)",
										opacity: isSelected || !isUpstreamCommit ? 1 : 0.82,
									}}
								>
									{graphRow ? <GraphSvg row={graphRow} maxLanes={maxLanes} /> : null}
									<div
										style={{
											width: 28,
											height: 28,
											borderRadius: "50%",
											background: hashToColor(commit.authorEmail || commit.authorName),
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											flexShrink: 0,
											fontSize: 10,
											fontWeight: 600,
											color: "white",
										}}
									>
										{getInitials(commit.authorName)}
									</div>
									<div
										style={{
											flex: 1,
											minWidth: 0,
											display: "flex",
											flexDirection: "column",
											justifyContent: "center",
											paddingLeft: 6,
											paddingRight: 10,
											gap: 2,
										}}
									>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: 6,
												fontSize: 12,
											}}
										>
											<span
												className="kb-line-clamp-1 kb-git-commit-row-meta"
												style={{ color: "var(--color-text-tertiary)" }}
											>
												{commit.authorName}
											</span>
											{commit.relation === "selected" ? (
												<span
													className="inline-flex items-center shrink-0"
													style={{
														color: isSelected
															? "var(--color-text-primary)"
															: "var(--color-text-tertiary)",
													}}
												>
													<ArrowUp size={12} />
												</span>
											) : commit.relation === "upstream" ? (
												<span
													className="inline-flex items-center shrink-0"
													style={{
														color: isSelected
															? "var(--color-text-primary)"
															: "var(--color-text-tertiary)",
													}}
												>
													<ArrowDown size={12} />
												</span>
											) : null}
											{sortedCommitRefs && sortedCommitRefs.length > 0
												? sortedCommitRefs.map((ref) => (
														<span
															key={ref.name}
															className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs shrink-0"
															style={{
																fontSize: 9,
																backgroundColor: getRefBadgeBackground(ref, isSelected),
																color: getRefBadgeColor(ref, isSelected),
															}}
														>
															{ref.type === "detached" ? (
																<Locate size={10} />
															) : ref.type === "remote" ? (
																<Cloud size={10} />
															) : (
																<GitBranch size={10} />
															)}
															{ref.type === "detached" ? "HEAD" : ref.name}
														</span>
													))
												: null}
											<span
												className="kb-git-commit-row-meta"
												style={{
													display: "inline-flex",
													alignItems: "center",
													flexShrink: 0,
													marginLeft: "auto",
													color: "var(--color-text-tertiary)",
												}}
											>
												{formatRelativeDate(commit.date)}
											</span>
										</div>
										<div
											style={{
												display: "flex",
												alignItems: "center",
												gap: 6,
												fontSize: 12,
												color: "var(--color-text-tertiary)",
											}}
										>
											<code
												className="kb-git-commit-row-meta font-mono"
												style={{
													flexShrink: 0,
												}}
											>
												{commit.shortHash}
											</code>
											<span
												className="kb-line-clamp-1 kb-git-commit-row-message"
												style={{
													color: isSelected
														? "var(--color-text-primary)"
														: isUpstreamCommit
															? "var(--color-text-secondary)"
															: "var(--color-text-primary)",
												}}
											>
												{commit.message}
											</span>
										</div>
									</div>
								</button>
							);
						}}
						components={{
							Footer: () => {
								if (isLoadingMore) {
									return (
										<div
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
												gap: 8,
												padding: "10px 12px",
												color: "var(--color-text-tertiary)",
											}}
										>
											<Spinner size={16} />
											<span style={{ fontSize: 12 }}>Loading more commits...</span>
										</div>
									);
								}
								if (errorMessage && commits.length > 0) {
									return (
										<div
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent: "space-between",
												gap: 8,
												padding: "10px 12px",
												color: "var(--color-text-tertiary)",
											}}
										>
											<span
												style={{
													fontSize: 12,
													color: "var(--color-status-red)",
												}}
											>
												{errorMessage}
											</span>
											{canLoadMore ? (
												<Button size="sm" variant="ghost" onClick={() => onLoadMore?.()}>
													Retry
												</Button>
											) : null}
										</div>
									);
								}
								if (!canLoadMore) {
									return (
										<div
											style={{
												padding: "10px 12px",
												textAlign: "center",
												color: "var(--color-text-tertiary)",
												fontSize: 12,
											}}
										>
											End of history
										</div>
									);
								}
								return null;
							},
						}}
					/>
				)}
			</div>
		</div>
	);
}
