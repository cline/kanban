import { X } from "lucide-react";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { DependencyLinkDraft } from "@/components/dependencies/use-dependency-linking";
import type { BoardColumnId, BoardDependency } from "@/types";

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
	geometry: DependencyGeometry;
	path: string;
	midpointX: number;
	midpointY: number;
	startSide: AnchorSide;
	endSide: AnchorSide;
	isTransient: boolean;
}

interface DependencyGeometry {
	startX: number;
	startY: number;
	controlPoint1X: number;
	controlPoint1Y: number;
	controlPoint2X: number;
	controlPoint2Y: number;
	endX: number;
	endY: number;
	midpointX: number;
	midpointY: number;
	startSide: AnchorSide;
	endSide: AnchorSide;
}

type AnchorSide = "left" | "right" | "top" | "bottom";

interface AnchorPoint {
	x: number;
	y: number;
	side: AnchorSide;
}

const SOURCE_CONNECTOR_PADDING = 0;
const TARGET_CONNECTOR_PADDING = 0;
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
	return index === -1 ? null : index;
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
		x: inverseCubed * p0x + 3 * inverseSquared * t * p1x + 3 * inverse * tSquared * p2x + tCubed * p3x,
		y: inverseCubed * p0y + 3 * inverseSquared * t * p1y + 3 * inverse * tSquared * p2y + tCubed * p3y,
	};
}

function buildPathFromGeometry(geometry: DependencyGeometry): string {
	return `M ${geometry.startX} ${geometry.startY} C ${geometry.controlPoint1X} ${geometry.controlPoint1Y} ${geometry.controlPoint2X} ${geometry.controlPoint2Y} ${geometry.endX} ${geometry.endY}`;
}

function interpolateDependencyGeometry(
	from: DependencyGeometry,
	to: DependencyGeometry,
	progress: number,
): DependencyGeometry {
	const interpolate = (fromValue: number, toValue: number) => fromValue + (toValue - fromValue) * progress;
	const startX = interpolate(from.startX, to.startX);
	const startY = interpolate(from.startY, to.startY);
	const controlPoint1X = interpolate(from.controlPoint1X, to.controlPoint1X);
	const controlPoint1Y = interpolate(from.controlPoint1Y, to.controlPoint1Y);
	const controlPoint2X = interpolate(from.controlPoint2X, to.controlPoint2X);
	const controlPoint2Y = interpolate(from.controlPoint2Y, to.controlPoint2Y);
	const endX = interpolate(from.endX, to.endX);
	const endY = interpolate(from.endY, to.endY);
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
		startX,
		startY,
		controlPoint1X,
		controlPoint1Y,
		controlPoint2X,
		controlPoint2Y,
		endX,
		endY,
		midpointX: midpoint.x,
		midpointY: midpoint.y,
		startSide: to.startSide,
		endSide: to.endSide,
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

function getAnchorPoint(anchor: TaskAnchor, side: AnchorSide, laneOffset: number, padding: number): AnchorPoint {
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

function chooseConnection(
	firstAnchor: TaskAnchor,
	secondAnchor: TaskAnchor,
	firstLaneOffset: number,
	secondLaneOffset: number,
	firstPadding: number,
	secondPadding: number,
): { start: AnchorPoint; end: AnchorPoint } {
	// Rendered links currently only survive when at least one endpoint is in backlog.
	// Draft links may still target free pointer space while the user is dragging.
	// Routing rules:
	// 1) If both cards are in backlog, connect right -> right.
	// 2) If cards are in different columns, connect from the earlier column right -> the later column left.
	// 3) Otherwise fall back to the cheapest side-pairing based on geometry.
	const firstColumnId = firstAnchor.columnId;
	const secondColumnId = secondAnchor.columnId;
	const firstColumnOrder = getColumnOrder(firstColumnId);
	const secondColumnOrder = getColumnOrder(secondColumnId);

	if (secondColumnId === null) {
		const sourceSide: AnchorSide =
			firstColumnId === "backlog"
				? "right"
				: firstColumnId === "in_progress" || firstColumnId === "review"
					? "left"
					: "left";
		const targetSide: AnchorSide = sourceSide === "right" ? "left" : "right";
		return {
			start: getAnchorPoint(firstAnchor, sourceSide, firstLaneOffset, firstPadding),
			end: getAnchorPoint(secondAnchor, targetSide, secondLaneOffset, secondPadding),
		};
	}

	if (firstColumnId === null) {
		const targetSide: AnchorSide =
			secondColumnId === "backlog" || secondColumnId === "in_progress" || secondColumnId === "review"
				? "right"
				: "left";
		const sourceSide: AnchorSide = targetSide === "right" ? "left" : "right";
		return {
			start: getAnchorPoint(firstAnchor, sourceSide, firstLaneOffset, firstPadding),
			end: getAnchorPoint(secondAnchor, targetSide, secondLaneOffset, secondPadding),
		};
	}

	if (
		firstColumnId &&
		secondColumnId &&
		firstColumnId === secondColumnId &&
		(firstColumnId === "backlog" || firstColumnId === "in_progress" || firstColumnId === "review")
	) {
		if (firstAnchor.centerY <= secondAnchor.centerY) {
			return {
				start: getAnchorPoint(firstAnchor, "right", firstLaneOffset, firstPadding),
				end: getAnchorPoint(secondAnchor, "right", secondLaneOffset, secondPadding),
			};
		}
		return {
			start: getAnchorPoint(secondAnchor, "right", secondLaneOffset, secondPadding),
			end: getAnchorPoint(firstAnchor, "right", firstLaneOffset, firstPadding),
		};
	}

	if (firstColumnOrder !== null && secondColumnOrder !== null && firstColumnOrder !== secondColumnOrder) {
		if (firstColumnOrder < secondColumnOrder) {
			return {
				start: getAnchorPoint(firstAnchor, "right", firstLaneOffset, firstPadding),
				end: getAnchorPoint(secondAnchor, "left", secondLaneOffset, secondPadding),
			};
		}
		return {
			start: getAnchorPoint(secondAnchor, "right", secondLaneOffset, secondPadding),
			end: getAnchorPoint(firstAnchor, "left", firstLaneOffset, firstPadding),
		};
	}

	const firstSides: AnchorSide[] = ["left", "right", "top", "bottom"];
	const secondSides: AnchorSide[] = ["left", "right", "top", "bottom"];
	let best: {
		cost: number;
		start: AnchorPoint;
		end: AnchorPoint;
	} | null = null;

	for (const firstSide of firstSides) {
		for (const secondSide of secondSides) {
			const start = getAnchorPoint(firstAnchor, firstSide, firstLaneOffset, firstPadding);
			const end = getAnchorPoint(secondAnchor, secondSide, secondLaneOffset, secondPadding);
			const vector = { x: end.x - start.x, y: end.y - start.y };
			const distance = Math.hypot(vector.x, vector.y);
			const startFacing = dot(SIDE_NORMALS[firstSide], vector);
			const endFacing = dot(SIDE_NORMALS[secondSide], { x: -vector.x, y: -vector.y });
			const startFacingPenalty = startFacing < 0 ? 140 + Math.abs(startFacing) * 0.6 : 0;
			const endFacingPenalty = endFacing < 0 ? 140 + Math.abs(endFacing) * 0.6 : 0;
			const cost = distance + startFacingPenalty + endFacingPenalty;
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
		start: getAnchorPoint(firstAnchor, "right", firstLaneOffset, firstPadding),
		end: getAnchorPoint(secondAnchor, "left", secondLaneOffset, secondPadding),
	};
}

function computePath(
	firstAnchor: TaskAnchor,
	secondAnchor: TaskAnchor,
	firstLaneOffset: number,
	secondLaneOffset: number,
	bounds?: { width: number; height: number },
): {
	geometry: DependencyGeometry;
	path: string;
	midpointX: number;
	midpointY: number;
	startSide: AnchorSide;
	endSide: AnchorSide;
} {
	const sourcePadding = SOURCE_CONNECTOR_PADDING;
	const targetPadding = TARGET_CONNECTOR_PADDING;
	const connection = chooseConnection(
		firstAnchor,
		secondAnchor,
		firstLaneOffset,
		secondLaneOffset,
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

	const geometry: DependencyGeometry = {
		startX,
		startY,
		controlPoint1X,
		controlPoint1Y,
		controlPoint2X,
		controlPoint2Y,
		endX,
		endY,
		midpointX: midpoint.x,
		midpointY: midpoint.y,
		startSide: connection.start.side,
		endSide: connection.end.side,
	};
	return {
		geometry,
		path: buildPathFromGeometry(geometry),
		midpointX: midpoint.x,
		midpointY: midpoint.y,
		startSide: connection.start.side,
		endSide: connection.end.side,
	};
}

function hasComparableValueDifference(a: number, b: number): boolean {
	return Math.abs(a - b) > 0.5;
}

function areLayoutsEqual(a: DependencyLayout, b: DependencyLayout): boolean {
	if (hasComparableValueDifference(a.width, b.width) || hasComparableValueDifference(a.height, b.height)) {
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
			hasComparableValueDifference(aAnchor.bottom, bAnchor.bottom) ||
			aAnchor.columnId !== bAnchor.columnId
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
	activeTaskId,
	activeTaskEffectiveColumnId,
	isMotionActive = false,
	onDeleteDependency,
}: {
	containerRef: RefObject<HTMLElement>;
	dependencies: BoardDependency[];
	draft: DependencyLinkDraft | null;
	activeTaskId?: string | null;
	activeTaskEffectiveColumnId?: BoardColumnId | null;
	isMotionActive?: boolean;
	onDeleteDependency?: (dependencyId: string) => void;
}): React.ReactElement | null {
	const [layout, setLayout] = useState<DependencyLayout>(() => createEmptyLayout());
	const [hoveredDependencyId, setHoveredDependencyId] = useState<string | null>(null);
	const hoverClearTimeoutRef = useRef<number | null>(null);
	const previousRenderedDependencyByIdRef = useRef<
		Record<string, Pick<RenderedDependency, "geometry" | "startSide" | "endSide">>
	>({});
	const previousDependenciesByIdRef = useRef<Record<string, BoardDependency>>({});
	const transientRemovedDependencyByIdRef = useRef<Record<string, BoardDependency>>({});
	const sideTransitionByDependencyIdRef = useRef<
		Record<
			string,
			{
				from: DependencyGeometry;
				startTime: number;
				durationMs: number;
				targetStartSide: AnchorSide;
				targetEndSide: AnchorSide;
			}
		>
	>({});
	const animationFrameIdRef = useRef<number | null>(null);
	const [, setAnimationFrameTick] = useState(0);

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
		const setAnchorFromElement = (cardElement: HTMLElement) => {
			const taskId = cardElement.dataset.taskId;
			if (!taskId) {
				return;
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
				columnId:
					taskId === activeTaskId && activeTaskEffectiveColumnId
						? activeTaskEffectiveColumnId
						: normalizeColumnId(
								cardElement.dataset.columnId ??
									cardElement.closest<HTMLElement>("[data-column-id]")?.dataset.columnId,
							),
			};
		};
		for (const cardElement of container.querySelectorAll<HTMLElement>("[data-task-id]")) {
			setAnchorFromElement(cardElement);
		}
		if (activeTaskId && typeof document !== "undefined") {
			const activeCardElements = Array.from(
				document.querySelectorAll<HTMLElement>(`[data-task-id="${activeTaskId}"]`),
			);
			const liveActiveCardElement =
				activeCardElements.find((element) => !container.contains(element)) ?? activeCardElements[0];
			if (liveActiveCardElement) {
				setAnchorFromElement(liveActiveCardElement);
			}
		}

		const nextLayout: DependencyLayout = {
			width: containerRect.width,
			height: containerRect.height,
			anchors,
		};
		setLayout((current) => (areLayoutsEqual(current, nextLayout) ? current : nextLayout));
	}, [activeTaskEffectiveColumnId, activeTaskId, containerRef]);

	useEffect(() => {
		refreshLayout();
	}, [dependencies, draft, refreshLayout]);

	useEffect(() => {
		setHoveredDependencyId((current) => {
			if (!current) {
				return null;
			}
			const isCurrentDependency = dependencies.some((dependency) => dependency.id === current);
			const isTransientDependency = transientRemovedDependencyByIdRef.current[current] !== undefined;
			return isCurrentDependency || isTransientDependency ? current : null;
		});
	}, [dependencies]);

	useLayoutEffect(() => {
		const currentDependenciesById = Object.fromEntries(dependencies.map((dependency) => [dependency.id, dependency]));
		if (!isMotionActive || !activeTaskId) {
			transientRemovedDependencyByIdRef.current = {};
			previousDependenciesByIdRef.current = currentDependenciesById;
			return;
		}

		const previousDependenciesById = previousDependenciesByIdRef.current;
		for (const [dependencyId, dependency] of Object.entries(previousDependenciesById)) {
			if (currentDependenciesById[dependencyId]) {
				continue;
			}
			if (dependency.fromTaskId !== activeTaskId && dependency.toTaskId !== activeTaskId) {
				continue;
			}
			transientRemovedDependencyByIdRef.current[dependencyId] = dependency;
		}
		for (const [dependencyId, transientDependency] of Object.entries(transientRemovedDependencyByIdRef.current)) {
			if (
				currentDependenciesById[dependencyId] ||
				(transientDependency.fromTaskId !== activeTaskId && transientDependency.toTaskId !== activeTaskId)
			) {
				delete transientRemovedDependencyByIdRef.current[dependencyId];
			}
		}
		previousDependenciesByIdRef.current = currentDependenciesById;
	}, [activeTaskId, dependencies, isMotionActive]);

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
		if (!draft && !isMotionActive) {
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
	}, [draft, isMotionActive, refreshLayout]);

	const renderedDependencies = useMemo((): RenderedDependency[] => {
		const displayedDependencies = new Map<string, { dependency: BoardDependency; isTransient: boolean }>();
		for (const dependency of dependencies) {
			displayedDependencies.set(dependency.id, {
				dependency,
				isTransient: false,
			});
		}
		for (const [dependencyId, transientDependency] of Object.entries(transientRemovedDependencyByIdRef.current)) {
			if (displayedDependencies.has(dependencyId)) {
				continue;
			}
			displayedDependencies.set(dependencyId, {
				dependency: transientDependency,
				isTransient: true,
			});
		}

		const candidates = Array.from(displayedDependencies.values())
			.map(({ dependency, isTransient }) => {
				const sourceAnchor = layout.anchors[dependency.fromTaskId];
				const targetAnchor = layout.anchors[dependency.toTaskId];
				if (!sourceAnchor || !targetAnchor) {
					return null;
				}
				const touchesActiveTask =
					activeTaskId !== null && activeTaskId !== undefined
						? dependency.fromTaskId === activeTaskId || dependency.toTaskId === activeTaskId
						: false;
				if (!isTransient && sourceAnchor.columnId !== "backlog" && targetAnchor.columnId !== "backlog") {
					return null;
				}
				if (isTransient && !touchesActiveTask) {
					return null;
				}
				return {
					dependency,
					sourceAnchor,
					targetAnchor,
					isTransient,
				};
			})
			.filter(
				(
					candidate,
				): candidate is {
					dependency: BoardDependency;
					sourceAnchor: TaskAnchor;
					targetAnchor: TaskAnchor;
					isTransient: boolean;
				} => candidate !== null,
			);

		const laneOrderByTaskId = new Map<string, Array<{ dependencyId: string; oppositeCenterY: number }>>();
		for (const candidate of candidates) {
			const sourceLanes = laneOrderByTaskId.get(candidate.dependency.fromTaskId) ?? [];
			sourceLanes.push({
				dependencyId: candidate.dependency.id,
				oppositeCenterY: candidate.targetAnchor.centerY,
			});
			laneOrderByTaskId.set(candidate.dependency.fromTaskId, sourceLanes);

			const targetLanes = laneOrderByTaskId.get(candidate.dependency.toTaskId) ?? [];
			targetLanes.push({
				dependencyId: candidate.dependency.id,
				oppositeCenterY: candidate.sourceAnchor.centerY,
			});
			laneOrderByTaskId.set(candidate.dependency.toTaskId, targetLanes);
		}

		for (const lanes of laneOrderByTaskId.values()) {
			lanes.sort((first, second) => first.oppositeCenterY - second.oppositeCenterY);
		}

		return candidates.map((candidate) => {
			const sourceLanes = laneOrderByTaskId.get(candidate.dependency.fromTaskId) ?? [
				{ dependencyId: candidate.dependency.id, oppositeCenterY: candidate.targetAnchor.centerY },
			];
			const targetLanes = laneOrderByTaskId.get(candidate.dependency.toTaskId) ?? [
				{ dependencyId: candidate.dependency.id, oppositeCenterY: candidate.sourceAnchor.centerY },
			];
			const sourceLaneIndex = sourceLanes.findIndex((lane) => lane.dependencyId === candidate.dependency.id);
			const targetLaneIndex = targetLanes.findIndex((lane) => lane.dependencyId === candidate.dependency.id);
			const sourceLaneOffset = ((sourceLaneIndex === -1 ? 0 : sourceLaneIndex) - (sourceLanes.length - 1) / 2) * 9;
			const targetLaneOffset = ((targetLaneIndex === -1 ? 0 : targetLaneIndex) - (targetLanes.length - 1) / 2) * 9;
			const geometry = computePath(
				candidate.sourceAnchor,
				candidate.targetAnchor,
				sourceLaneOffset,
				targetLaneOffset,
				{ width: layout.width, height: layout.height },
			);
			return {
				dependency: candidate.dependency,
				geometry: geometry.geometry,
				path: geometry.path,
				midpointX: geometry.midpointX,
				midpointY: geometry.midpointY,
				startSide: geometry.startSide,
				endSide: geometry.endSide,
				isTransient: candidate.isTransient,
			};
		});
	}, [activeTaskId, dependencies, layout.anchors, layout.height, layout.width]);

	useLayoutEffect(() => {
		const now = performance.now();
		const nextPreviousRenderedDependencyById: Record<
			string,
			Pick<RenderedDependency, "geometry" | "startSide" | "endSide">
		> = {};
		const nextRenderedDependencyIds = new Set(renderedDependencies.map((rendered) => rendered.dependency.id));
		for (const rendered of renderedDependencies) {
			const existingTransition = sideTransitionByDependencyIdRef.current[rendered.dependency.id];
			const previousRendered = previousRenderedDependencyByIdRef.current[rendered.dependency.id];
			const transitionProgress = existingTransition
				? Math.min((now - existingTransition.startTime) / existingTransition.durationMs, 1)
				: 1;
			const transitionFromGeometry = existingTransition
				? interpolateDependencyGeometry(existingTransition.from, rendered.geometry, transitionProgress)
				: previousRendered?.geometry;
			const shouldAnimateSideTransition =
				previousRendered != null &&
				(previousRendered.startSide !== rendered.startSide || previousRendered.endSide !== rendered.endSide);
			if (shouldAnimateSideTransition && transitionFromGeometry) {
				sideTransitionByDependencyIdRef.current[rendered.dependency.id] = {
					from: transitionFromGeometry,
					startTime: now,
					durationMs: 150,
					targetStartSide: rendered.startSide,
					targetEndSide: rendered.endSide,
				};
			} else if (
				existingTransition &&
				transitionProgress < 1 &&
				existingTransition.targetStartSide === rendered.startSide &&
				existingTransition.targetEndSide === rendered.endSide
			) {
				sideTransitionByDependencyIdRef.current[rendered.dependency.id] = existingTransition;
			} else {
				delete sideTransitionByDependencyIdRef.current[rendered.dependency.id];
			}
			nextPreviousRenderedDependencyById[rendered.dependency.id] = {
				geometry: rendered.geometry,
				startSide: rendered.startSide,
				endSide: rendered.endSide,
			};
		}
		for (const dependencyId of Object.keys(sideTransitionByDependencyIdRef.current)) {
			if (!nextRenderedDependencyIds.has(dependencyId)) {
				delete sideTransitionByDependencyIdRef.current[dependencyId];
			}
		}
		previousRenderedDependencyByIdRef.current = nextPreviousRenderedDependencyById;
	}, [renderedDependencies]);

	useEffect(() => {
		if (Object.keys(sideTransitionByDependencyIdRef.current).length === 0) {
			if (animationFrameIdRef.current !== null) {
				window.cancelAnimationFrame(animationFrameIdRef.current);
				animationFrameIdRef.current = null;
			}
			return;
		}
		const tick = () => {
			const now = performance.now();
			let hasActiveTransition = false;
			for (const [dependencyId, transition] of Object.entries(sideTransitionByDependencyIdRef.current)) {
				if (now - transition.startTime >= transition.durationMs) {
					delete sideTransitionByDependencyIdRef.current[dependencyId];
					continue;
				}
				hasActiveTransition = true;
			}
			setAnimationFrameTick((current) => current + 1);
			if (hasActiveTransition) {
				animationFrameIdRef.current = window.requestAnimationFrame(tick);
				return;
			}
			animationFrameIdRef.current = null;
		};
		animationFrameIdRef.current = window.requestAnimationFrame(tick);
		return () => {
			if (animationFrameIdRef.current !== null) {
				window.cancelAnimationFrame(animationFrameIdRef.current);
				animationFrameIdRef.current = null;
			}
		};
	}, [renderedDependencies]);

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
				? (renderedDependencies.find((rendered) => rendered.dependency.id === hoveredDependencyId) ?? null)
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
				{renderedDependencies.map((rendered) => {
					const sideTransition = sideTransitionByDependencyIdRef.current[rendered.dependency.id];
					const displayedGeometry = sideTransition
						? interpolateDependencyGeometry(
								sideTransition.from,
								rendered.geometry,
								Math.min((performance.now() - sideTransition.startTime) / sideTransition.durationMs, 1),
							)
						: rendered.geometry;
					const displayedPath = buildPathFromGeometry(displayedGeometry);
					return (
						<g key={rendered.dependency.id}>
							<path
								d={displayedPath}
								className={`kb-dependency-path${hoveredDependencyId === rendered.dependency.id ? " kb-dependency-path-hover" : ""}`}
							/>
							{onDeleteDependency && !rendered.isTransient ? (
								<path
									d={displayedPath}
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
					);
				})}
			</svg>
			{draftPath ? (
				<svg
					className="kb-dependency-draft-overlay"
					width={layout.width}
					height={layout.height}
					viewBox={`0 0 ${layout.width} ${layout.height}`}
				>
					<path d={draftPath} className="kb-dependency-draft-path" />
				</svg>
			) : null}
			{onDeleteDependency && hoveredDependency && !hoveredDependency.isTransient ? (
				<div
					key={`${hoveredDependency.dependency.id}-delete`}
					className="kb-dependency-delete-control"
					style={{ left: hoveredDependency.midpointX, top: hoveredDependency.midpointY }}
				>
					<X size={10} color="var(--color-text-primary)" />
				</div>
			) : null}
		</>
	);
}
