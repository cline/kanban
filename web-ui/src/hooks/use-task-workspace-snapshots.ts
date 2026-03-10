import { useCallback, useEffect, useMemo, useRef } from "react";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import {
	clearInactiveTaskWorkspaceSnapshots,
	getTaskWorkspaceSnapshot,
	setTaskWorkspaceSnapshot,
} from "@/stores/workspace-metadata-store";
import type { BoardCard, ReviewTaskWorkspaceSnapshot } from "@/types";

interface UseTaskWorkspaceSnapshotsOptions {
	currentProjectId: string | null;
	reviewCards: BoardCard[];
	inProgressCards: BoardCard[];
	trashCards: BoardCard[];
	sessions: Record<string, RuntimeTaskSessionSummary>;
	isDocumentVisible: boolean;
	fetchReviewWorkspaceSnapshot: (task: BoardCard) => Promise<ReviewTaskWorkspaceSnapshot | null>;
}

interface UseTaskWorkspaceSnapshotsResult {
	resetWorkspaceSnapshots: () => void;
}

export function useTaskWorkspaceSnapshots(options: UseTaskWorkspaceSnapshotsOptions): UseTaskWorkspaceSnapshotsResult {
	const {
		currentProjectId,
		reviewCards,
		inProgressCards,
		trashCards,
		sessions,
		isDocumentVisible,
		fetchReviewWorkspaceSnapshot,
	} = options;
	const reviewWorkspaceSnapshotLoadingRef = useRef<Set<string>>(new Set());
	const inProgressWorkspaceSnapshotLoadingRef = useRef<Set<string>>(new Set());
	const activeReviewTaskIdsRef = useRef<Set<string>>(new Set());
	const lastFetchedSessionUpdatedAtByTaskIdRef = useRef<Record<string, number>>({});

	const resetWorkspaceSnapshots = useCallback(() => {
		reviewWorkspaceSnapshotLoadingRef.current.clear();
		inProgressWorkspaceSnapshotLoadingRef.current.clear();
		activeReviewTaskIdsRef.current = new Set();
		lastFetchedSessionUpdatedAtByTaskIdRef.current = {};
		clearInactiveTaskWorkspaceSnapshots(new Set());
	}, []);

	const queueWorkspaceSnapshotRefresh = useCallback(
		(task: BoardCard, source: "review" | "in_progress") => {
			const loadingRef =
				source === "review" ? reviewWorkspaceSnapshotLoadingRef : inProgressWorkspaceSnapshotLoadingRef;
			if (loadingRef.current.has(task.id)) {
				return;
			}
			const sessionUpdatedAt = sessions[task.id]?.updatedAt ?? 0;
			const lastFetchedUpdatedAt = lastFetchedSessionUpdatedAtByTaskIdRef.current[task.id] ?? -1;
			const hasSnapshot = getTaskWorkspaceSnapshot(task.id) !== null;
			if (sessionUpdatedAt <= lastFetchedUpdatedAt && hasSnapshot) {
				return;
			}
			loadingRef.current.add(task.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(task);
				loadingRef.current.delete(task.id);
				if (!snapshot) {
					return;
				}
				if (source === "review" && !activeReviewTaskIdsRef.current.has(task.id)) {
					return;
				}
				setTaskWorkspaceSnapshot(snapshot);
				lastFetchedSessionUpdatedAtByTaskIdRef.current[task.id] = sessionUpdatedAt;
			})();
		},
		[fetchReviewWorkspaceSnapshot, sessions],
	);

	const activeWorkspaceSnapshotTaskIds = useMemo(() => {
		const ids = new Set<string>();
		for (const card of reviewCards) {
			ids.add(card.id);
		}
		for (const card of inProgressCards) {
			ids.add(card.id);
		}
		for (const card of trashCards) {
			ids.add(card.id);
		}
		return ids;
	}, [inProgressCards, reviewCards, trashCards]);

	useEffect(() => {
		clearInactiveTaskWorkspaceSnapshots(activeWorkspaceSnapshotTaskIds);
	}, [activeWorkspaceSnapshotTaskIds]);

	useEffect(() => {
		const reviewTaskIds = new Set(reviewCards.map((card) => card.id));
		activeReviewTaskIdsRef.current = reviewTaskIds;
		reviewWorkspaceSnapshotLoadingRef.current.forEach((taskId) => {
			if (!reviewTaskIds.has(taskId)) {
				reviewWorkspaceSnapshotLoadingRef.current.delete(taskId);
			}
		});
		if (!currentProjectId || !isDocumentVisible) {
			if (!currentProjectId) {
				reviewWorkspaceSnapshotLoadingRef.current.clear();
				lastFetchedSessionUpdatedAtByTaskIdRef.current = {};
			}
			return;
		}
		for (const reviewCard of reviewCards) {
			queueWorkspaceSnapshotRefresh(reviewCard, "review");
		}
	}, [currentProjectId, isDocumentVisible, queueWorkspaceSnapshotRefresh, reviewCards]);

	useEffect(() => {
		const inProgressTaskIds = new Set(inProgressCards.map((card) => card.id));
		inProgressWorkspaceSnapshotLoadingRef.current.forEach((taskId) => {
			if (!inProgressTaskIds.has(taskId)) {
				inProgressWorkspaceSnapshotLoadingRef.current.delete(taskId);
			}
		});

		if (!currentProjectId || !isDocumentVisible) {
			if (!currentProjectId) {
				inProgressWorkspaceSnapshotLoadingRef.current.clear();
			}
			return;
		}
		for (const card of inProgressCards) {
			queueWorkspaceSnapshotRefresh(card, "in_progress");
		}
	}, [currentProjectId, inProgressCards, isDocumentVisible, queueWorkspaceSnapshotRefresh]);

	return {
		resetWorkspaceSnapshots,
	};
}
