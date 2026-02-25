import { Icon } from "@blueprintjs/core";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";

import type { DependencyLinkDraft } from "@/kanban/components/dependencies/use-dependency-linking";
import type { BoardColumnId, BoardDependency } from "@/kanban/types";

interface TaskAnchor {
	left: number;
	right: number;
	top: number;
	bottom: number;
	centerX: number;
	centerY: number;
	columnId: BoardColumnId | null;
}

interface DependencyLayout {
	width: number;
	height: number;
	anchors: Record<string, TaskAnchor>;
}

interface RenderedDependency {
	dependency: BoardDependency;
	path: string;
	midpointX: number;
	midpointY: number;
}

type AnchorSide = "left" | "right" | "top" | "bottom";

interface AnchorPoint {
	x: number;
	y: number;
	side: AnchorSide;
}

const SOURCE_CONNECTOR_PADDING = 2;
const TARGET_CONNECTOR_PADDING = 8;
const COLUMN_ORDER: BoardColumnId[] = ["backlog", "in_progress", "review", "trash"];
const SIDE_NORMALS: Record<AnchorSide, { x: number; y: number }> = {
	left: { x: -1, y: 0 },
	right: { x: 1, y: 0 },
	top: { x: 0, y: -1 },
	bottom: { x: 0, y: 1 },
};

function getColumnOrder(columnId: BoardColumnId | null): number | null {
	if (!columnId) {
		return null;
	}
	const index = COLUMN_ORDER.indexOf(columnId);
	return index >= 0 ? index : null;
}

function cubicPoint(
	t: number,
	p0x: number,
	p0y: number,
	p1x: number,
	p1y: number,
	p2x: number,
	p2y: number,
	p3x: number,
	p3y: number,
): { x: number; y: number } {
	const inverse = 1 - t;
	const inverseSquared = inverse * inverse;
	const inverseCubed = inverseSquared * inverse;
	const tSquared = t * t;
	const tCubed = tSquared * t;
	return {
		x:
			inverseCubed * p0x +
			3 * inverseSquared * t * p1x +
			3 * inverse * tSquared * p2x +
			tCubed * p3x,
		y:
			inverseCubed * p0y +
			3 * inverseSquared * t * p1y +
			3 * inverse * tSquared * p2y +
			tCubed * p3y,
	};
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalizeColumnId(value: string | undefined): BoardColumnId | null {
	if (value === "backlog" || value === "in_progress" || value === "review" || value === "trash") {
		return value;
	}
	return null;
}

function dot(a: { x: number; y: number }, b: { x: number; y: number }): number {
	return a.x * b.x + a.y * b.y;
}

function getAnchorPoint(
	anchor: TaskAnchor,
	side: AnchorSide,
	laneOffset: number,
	padding: number,
): AnchorPoint {
	if (side === "left") {
		return {
			x: anchor.left - padding,
			y: anchor.centerY + laneOffset,
			side,
		};
	}
	if (side === "right") {
		return {
			x: anchor.right + padding,
			y: anchor.centerY + laneOffset,
			side,
		};
	}
	if (side === "top") {
		return {
			x: anchor.centerX + laneOffset,
			y: anchor.top - padding,
			side,
		};
	}
	return {
		x: anchor.centerX + laneOffset,
		y: anchor.bottom + padding,
		side,
	};
}

function chooseShortestDirectionalConnection(
	source: TaskAnchor,
	target: TaskAnchor,
	sourceLaneOffset: number,
	targetLaneOffset: number,
	sourcePadding: number,
	targetPadding: number,
): { start: AnchorPoint; end: AnchorPoint } {
	let sourceSides: AnchorSide[] = ["left", "right", "top", "bottom"];
	let targetSides: AnchorSide[] = ["left", "right", "top", "bottom"];

	const sourceColumnOrder = getColumnOrder(source.columnId);
	const targetColumnOrder = getColumnOrder(target.columnId);
	const isForwardAcrossColumns =
		sourceColumnOrder !== null &&
		targetColumnOrder !== null &&
		sourceColumnOrder < targetColumnOrder;
	const isSameColumn =
		source.columnId !== null &&
		target.columnId !== null &&
		source.columnId === target.columnId;

	if (isSameColumn) {
		sourceSides = ["right"];
		targetSides = ["right"];
	} else if (isForwardAcrossColumns) {
		sourceSides = ["right"];
		targetSides = ["bottom"];
	} else if (source.columnId === "backlog") {
		sourceSides = ["right"];
	}

	let best:
		| {
				cost: number;
				start: AnchorPoint;
				end: AnchorPoint;
		  }
		| null = null;
	for (const sourceSide of sourceSides) {
		for (const targetSide of targetSides) {
			const start = getAnchorPoint(source, sourceSide, sourceLaneOffset, sourcePadding);
			const end = getAnchorPoint(target, targetSide, targetLaneOffset, targetPadding);
			const vector = { x: end.x - start.x, y: end.y - start.y };
			const distance = Math.hypot(vector.x, vector.y);
			const sourceFacing = dot(SIDE_NORMALS[sourceSide], vector);
			const targetFacing = dot(SIDE_NORMALS[targetSide], { x: -vector.x, y: -vector.y });
			const sourceFacingPenalty = sourceFacing < 0 ? 140 + Math.abs(sourceFacing) * 0.6 : 0;
			const targetFacingPenalty = targetFacing < 0 ? 140 + Math.abs(targetFacing) * 0.6 : 0;
			const cost = distance + sourceFacingPenalty + targetFacingPenalty;
			if (!best || cost < best.cost) {
				best = {
					cost,
					start,
					end,
				};
			}
		}
	}
	if (best) {
		return {
			start: best.start,
			end: best.end,
		};
	}
	return {
		start: getAnchorPoint(source, "right", sourceLaneOffset, sourcePadding),
		end: getAnchorPoint(target, "left", targetLaneOffset, targetPadding),
	};
}

function computePath(
	source: TaskAnchor,
	target: TaskAnchor,
	sourceLaneOffset: number,
	targetLaneOffset: number,
	bounds?: { width: number; height: number },
): { path: string; midpointX: number; midpointY: number } {
	const sourcePadding = SOURCE_CONNECTOR_PADDING;
	const targetPadding = TARGET_CONNECTOR_PADDING;
	const connection = chooseShortestDirectionalConnection(
		source,
		target,
		sourceLaneOffset,
		targetLaneOffset,
		sourcePadding,
		targetPadding,
	);
	const minX = bounds ? 2 : Number.NEGATIVE_INFINITY;
	const maxX = bounds ? bounds.width - 2 : Number.POSITIVE_INFINITY;
	const minY = bounds ? 2 : Number.NEGATIVE_INFINITY;
	const maxY = bounds ? bounds.height - 2 : Number.POSITIVE_INFINITY;
	const startX = clamp(connection.start.x, minX, maxX);
	const startY = clamp(connection.start.y, minY, maxY);
	const endX = clamp(connection.end.x, minX, maxX);
	const endY = clamp(connection.end.y, minY, maxY);
	const delta = { x: endX - startX, y: endY - startY };
	const distance = Math.hypot(delta.x, delta.y);
	const curvePull = clamp(distance * 0.35, 42, 220);
	const sourceNormal = SIDE_NORMALS[connection.start.side];
	const targetNormal = SIDE_NORMALS[connection.end.side];
	const controlPoint1X = clamp(startX + sourceNormal.x * curvePull, minX, maxX);
	const controlPoint1Y = clamp(startY + sourceNormal.y * curvePull, minY, maxY);
	const controlPoint2X = clamp(endX + targetNormal.x * curvePull, minX, maxX);
	const controlPoint2Y = clamp(endY + targetNormal.y * curvePull, minY, maxY);

	const midpoint = cubicPoint(
		0.5,
		startX,
		startY,
		controlPoint1X,
		controlPoint1Y,
		controlPoint2X,
		controlPoint2Y,
		endX,
		endY,
	);

	return {
		path: `M ${startX} ${startY} C ${controlPoint1X} ${controlPoint1Y} ${controlPoint2X} ${controlPoint2Y} ${endX} ${endY}`,
		midpointX: midpoint.x,
		midpointY: midpoint.y,
	};
}

function hasComparableValueDifference(a: number, b: number): boolean {
	return Math.abs(a - b) > 0.5;
}

function areLayoutsEqual(a: DependencyLayout, b: DependencyLayout): boolean {
	if (
		hasComparableValueDifference(a.width, b.width) ||
		hasComparableValueDifference(a.height, b.height)
	) {
		return false;
	}
	const aKeys = Object.keys(a.anchors);
	const bKeys = Object.keys(b.anchors);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	for (const key of aKeys) {
		const aAnchor = a.anchors[key];
		const bAnchor = b.anchors[key];
		if (!aAnchor || !bAnchor) {
			return false;
		}
		if (
			hasComparableValueDifference(aAnchor.left, bAnchor.left) ||
			hasComparableValueDifference(aAnchor.right, bAnchor.right) ||
			hasComparableValueDifference(aAnchor.top, bAnchor.top) ||
			hasComparableValueDifference(aAnchor.bottom, bAnchor.bottom)
		) {
			return false;
		}
	}
	return true;
}

function createEmptyLayout(): DependencyLayout {
	return {
		width: 0,
		height: 0,
		anchors: {},
	};
}

export function DependencyOverlay({
	containerRef,
	dependencies,
	draft,
	onDeleteDependency,
}: {
	containerRef: RefObject<HTMLElement>;
	dependencies: BoardDependency[];
	draft: DependencyLinkDraft | null;
	onDeleteDependency?: (dependencyId: string) => void;
}): React.ReactElement | null {
	const [layout, setLayout] = useState<DependencyLayout>(() => createEmptyLayout());
	const [hoveredDependencyId, setHoveredDependencyId] = useState<string | null>(null);
	const markerId = useId().replaceAll(":", "");
	const hoverClearTimeoutRef = useRef<number | null>(null);

	const refreshLayout = useCallback(() => {
		const container = containerRef.current;
		if (!container) {
			setLayout((current) => {
				const empty = createEmptyLayout();
				return areLayoutsEqual(current, empty) ? current : empty;
			});
			return;
		}

		const containerRect = container.getBoundingClientRect();
		const anchors: Record<string, TaskAnchor> = {};
		for (const cardElement of container.querySelectorAll<HTMLElement>("[data-task-id]")) {
			const taskId = cardElement.dataset.taskId;
			if (!taskId) {
				continue;
			}
			const rect = cardElement.getBoundingClientRect();
			const left = rect.left - containerRect.left;
			const right = rect.right - containerRect.left;
			const top = rect.top - containerRect.top;
			const bottom = rect.bottom - containerRect.top;
			anchors[taskId] = {
				left,
				right,
				top,
				bottom,
				centerX: (left + right) / 2,
				centerY: (top + bottom) / 2,
				columnId: normalizeColumnId(cardElement.closest<HTMLElement>("[data-column-id]")?.dataset.columnId),
			};
		}

		const nextLayout: DependencyLayout = {
			width: containerRect.width,
			height: containerRect.height,
			anchors,
		};
		setLayout((current) => (areLayoutsEqual(current, nextLayout) ? current : nextLayout));
	}, [containerRef]);

	useEffect(() => {
		refreshLayout();
	}, [dependencies, draft, refreshLayout]);

	useEffect(() => {
		setHoveredDependencyId((current) => {
			if (!current) {
				return null;
			}
			return dependencies.some((dependency) => dependency.id === current)
				? current
				: null;
		});
	}, [dependencies]);

	const clearPendingHoverClear = useCallback(() => {
		if (hoverClearTimeoutRef.current !== null) {
			window.clearTimeout(hoverClearTimeoutRef.current);
			hoverClearTimeoutRef.current = null;
		}
	}, []);

	const scheduleHoverClear = useCallback(
		(dependencyId: string) => {
			clearPendingHoverClear();
			hoverClearTimeoutRef.current = window.setTimeout(() => {
				setHoveredDependencyId((current) => (current === dependencyId ? null : current));
				hoverClearTimeoutRef.current = null;
			}, 80);
		},
		[clearPendingHoverClear],
	);

	useEffect(
		() => () => {
			clearPendingHoverClear();
		},
		[clearPendingHoverClear],
	);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}
		let animationFrameId = 0;
		const scheduleRefresh = () => {
			window.cancelAnimationFrame(animationFrameId);
			animationFrameId = window.requestAnimationFrame(() => {
				animationFrameId = 0;
				refreshLayout();
			});
		};
		scheduleRefresh();
		window.addEventListener("resize", scheduleRefresh);
		container.addEventListener("scroll", scheduleRefresh, true);
		const resizeObserver =
			typeof ResizeObserver !== "undefined"
				? new ResizeObserver(() => {
					scheduleRefresh();
				})
				: null;
		if (resizeObserver) {
			resizeObserver.observe(container);
		}
		const mutationObserver = new MutationObserver(() => {
			scheduleRefresh();
		});
		mutationObserver.observe(container, {
			subtree: true,
			childList: true,
			attributes: true,
		});
		return () => {
			window.removeEventListener("resize", scheduleRefresh);
			container.removeEventListener("scroll", scheduleRefresh, true);
			mutationObserver.disconnect();
			resizeObserver?.disconnect();
			window.cancelAnimationFrame(animationFrameId);
		};
	}, [containerRef, refreshLayout]);

	useEffect(() => {
		let animationFrameId = 0;
		if (!draft) {
			return;
		}
		const tick = () => {
			refreshLayout();
			animationFrameId = window.requestAnimationFrame(tick);
		};
		animationFrameId = window.requestAnimationFrame(tick);
		return () => {
			window.cancelAnimationFrame(animationFrameId);
		};
	}, [draft, refreshLayout]);

	const renderedDependencies = useMemo((): RenderedDependency[] => {
		const candidates = dependencies
			.map((dependency) => {
				const sourceAnchor = layout.anchors[dependency.fromTaskId];
				const targetAnchor = layout.anchors[dependency.toTaskId];
				if (!sourceAnchor || !targetAnchor) {
					return null;
				}
				return {
					dependency,
					sourceAnchor,
					targetAnchor,
				};
			})
			.filter((candidate): candidate is { dependency: BoardDependency; sourceAnchor: TaskAnchor; targetAnchor: TaskAnchor } => candidate !== null);

		const sourceOrder = new Map<string, string[]>();
		const targetOrder = new Map<string, string[]>();
		for (const candidate of candidates) {
			const existingSource = sourceOrder.get(candidate.dependency.fromTaskId);
			if (existingSource) {
				existingSource.push(candidate.dependency.id);
			} else {
				sourceOrder.set(candidate.dependency.fromTaskId, [candidate.dependency.id]);
			}
			const existingTarget = targetOrder.get(candidate.dependency.toTaskId);
			if (existingTarget) {
				existingTarget.push(candidate.dependency.id);
			} else {
				targetOrder.set(candidate.dependency.toTaskId, [candidate.dependency.id]);
			}
		}

		for (const [taskId, dependencyIds] of sourceOrder.entries()) {
			dependencyIds.sort((first, second) => {
				const firstCandidate = candidates.find((candidate) => candidate.dependency.id === first);
				const secondCandidate = candidates.find((candidate) => candidate.dependency.id === second);
				if (!firstCandidate || !secondCandidate) {
					return 0;
				}
				return firstCandidate.targetAnchor.centerY - secondCandidate.targetAnchor.centerY;
			});
			sourceOrder.set(taskId, dependencyIds);
		}
		for (const [taskId, dependencyIds] of targetOrder.entries()) {
			dependencyIds.sort((first, second) => {
				const firstCandidate = candidates.find((candidate) => candidate.dependency.id === first);
				const secondCandidate = candidates.find((candidate) => candidate.dependency.id === second);
				if (!firstCandidate || !secondCandidate) {
					return 0;
				}
				return firstCandidate.sourceAnchor.centerY - secondCandidate.sourceAnchor.centerY;
			});
			targetOrder.set(taskId, dependencyIds);
		}

		return candidates.map((candidate) => {
			const sourceIds = sourceOrder.get(candidate.dependency.fromTaskId) ?? [candidate.dependency.id];
			const targetIds = targetOrder.get(candidate.dependency.toTaskId) ?? [candidate.dependency.id];
			const sourceLaneIndex = sourceIds.indexOf(candidate.dependency.id);
			const targetLaneIndex = targetIds.indexOf(candidate.dependency.id);
			const sourceLaneOffset = (sourceLaneIndex - (sourceIds.length - 1) / 2) * 9;
			const targetLaneOffset = (targetLaneIndex - (targetIds.length - 1) / 2) * 9;
			const geometry = computePath(
				candidate.sourceAnchor,
				candidate.targetAnchor,
				sourceLaneOffset,
				targetLaneOffset,
				{ width: layout.width, height: layout.height },
			);
			return {
				dependency: candidate.dependency,
				path: geometry.path,
				midpointX: geometry.midpointX,
				midpointY: geometry.midpointY,
			};
		});
	}, [dependencies, layout.anchors]);

	const draftPath = useMemo(() => {
		if (!draft) {
			return null;
		}
		const sourceAnchor = layout.anchors[draft.sourceTaskId];
		if (!sourceAnchor) {
			return null;
		}
		const targetAnchor = draft.targetTaskId ? layout.anchors[draft.targetTaskId] : null;
		const container = containerRef.current;
		if (!container) {
			return null;
		}
		const containerRect = container.getBoundingClientRect();
		const pointerTarget: TaskAnchor = {
			left: draft.pointerClientX - containerRect.left,
			right: draft.pointerClientX - containerRect.left,
			top: draft.pointerClientY - containerRect.top,
			bottom: draft.pointerClientY - containerRect.top,
			centerX: draft.pointerClientX - containerRect.left,
			centerY: draft.pointerClientY - containerRect.top,
			columnId: null,
		};
		const geometry = computePath(sourceAnchor, targetAnchor ?? pointerTarget, 0, 0, {
			width: layout.width,
			height: layout.height,
		});
		return geometry.path;
	}, [containerRef, draft, layout.anchors, layout.height, layout.width]);

	const hoveredDependency = useMemo(
		() =>
			hoveredDependencyId
				? renderedDependencies.find((rendered) => rendered.dependency.id === hoveredDependencyId) ?? null
				: null,
		[hoveredDependencyId, renderedDependencies],
	);

	if (layout.width <= 0 || layout.height <= 0) {
		return null;
	}

	return (
		<>
			<svg
				className="kb-dependency-overlay"
				width={layout.width}
				height={layout.height}
				viewBox={`0 0 ${layout.width} ${layout.height}`}
			>
				<defs>
					<marker
						id={`${markerId}-dependency-arrow`}
						viewBox="0 0 10 10"
						refX="7"
						refY="5"
						markerWidth="5"
						markerHeight="5"
						orient="auto-start-reverse"
					>
						<path
							d="M 0 0 L 10 5 L 0 10 z"
							fill="var(--bp-palette-indigo-4)"
							stroke="var(--bp-palette-indigo-4)"
							strokeWidth="1.2"
							strokeLinejoin="round"
						/>
					</marker>
					<marker
							id={`${markerId}-dependency-arrow-hover`}
							viewBox="0 0 10 10"
							refX="7"
							refY="5"
							markerWidth="5"
							markerHeight="5"
							orient="auto-start-reverse"
						>
							<path
								d="M 0 0 L 10 5 L 0 10 z"
								fill="var(--bp-intent-danger-rest)"
								stroke="var(--bp-intent-danger-rest)"
								strokeWidth="1.2"
								strokeLinejoin="round"
							/>
						</marker>
					</defs>
				{renderedDependencies.map((rendered) => (
					<g key={rendered.dependency.id}>
						<path
							d={rendered.path}
							className={`kb-dependency-path${hoveredDependencyId === rendered.dependency.id ? " kb-dependency-path-hover" : ""}`}
							markerEnd={`url(#${hoveredDependencyId === rendered.dependency.id ? `${markerId}-dependency-arrow-hover` : `${markerId}-dependency-arrow`})`}
						/>
						{onDeleteDependency ? (
							<path
								d={rendered.path}
								className="kb-dependency-hit-path"
								onMouseEnter={() => {
									clearPendingHoverClear();
									setHoveredDependencyId(rendered.dependency.id);
								}}
								onMouseMove={() => {
									clearPendingHoverClear();
									setHoveredDependencyId((current) =>
										current === rendered.dependency.id ? current : rendered.dependency.id,
									);
								}}
								onMouseLeave={() => {
									scheduleHoverClear(rendered.dependency.id);
								}}
								onMouseDown={(event) => {
									event.preventDefault();
									event.stopPropagation();
								}}
								onClick={(event) => {
									event.preventDefault();
									event.stopPropagation();
									onDeleteDependency(rendered.dependency.id);
									clearPendingHoverClear();
									setHoveredDependencyId(null);
								}}
							/>
						) : null}
					</g>
				))}
			</svg>
			{draftPath ? (
				<svg
					className="kb-dependency-draft-overlay"
					width={layout.width}
					height={layout.height}
					viewBox={`0 0 ${layout.width} ${layout.height}`}
				>
					<defs>
						<marker
							id={`${markerId}-draft-arrow`}
							viewBox="0 0 10 10"
							refX="7"
							refY="5"
							markerWidth="5"
							markerHeight="5"
							orient="auto-start-reverse"
						>
							<path
								d="M 0 0 L 10 5 L 0 10 z"
								fill="var(--bp-palette-indigo-4)"
								stroke="var(--bp-palette-indigo-4)"
								strokeWidth="1.2"
								strokeLinejoin="round"
							/>
						</marker>
					</defs>
					<path
						d={draftPath}
						className="kb-dependency-draft-path"
						markerEnd={`url(#${markerId}-draft-arrow)`}
					/>
				</svg>
			) : null}
			{onDeleteDependency && hoveredDependency ? (
				<div
					key={`${hoveredDependency.dependency.id}-delete`}
					className="kb-dependency-delete-control"
					style={{ left: hoveredDependency.midpointX, top: hoveredDependency.midpointY }}
				>
					<Icon
						icon="cross"
						size={10}
						color="var(--bp-palette-light-gray-5)"
					/>
				</div>
			) : null}
		</>
	);
}
