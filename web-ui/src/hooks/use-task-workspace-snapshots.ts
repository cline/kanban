import { useCallback, useEffect, useMemo, useRef } from "react";

import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import {
	clearInactiveTaskWorkspaceSnapshots,
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
	const reviewWorkspaceSnapshotAttemptedRef = useRef<Set<string>>(new Set());
	const activeReviewTaskIdsRef = useRef<Set<string>>(new Set());
	const lastFetchedSessionUpdatedAtByTaskIdRef = useRef<Record<string, number>>({});

	const resetWorkspaceSnapshots = useCallback(() => {
		reviewWorkspaceSnapshotLoadingRef.current.clear();
		inProgressWorkspaceSnapshotLoadingRef.current.clear();
		reviewWorkspaceSnapshotAttemptedRef.current.clear();
		activeReviewTaskIdsRef.current = new Set();
		lastFetchedSessionUpdatedAtByTaskIdRef.current = {};
		clearInactiveTaskWorkspaceSnapshots(new Set());
	}, []);

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
		reviewWorkspaceSnapshotAttemptedRef.current.forEach((taskId) => {
			if (!reviewTaskIds.has(taskId)) {
				reviewWorkspaceSnapshotAttemptedRef.current.delete(taskId);
			}
		});
		if (!currentProjectId || !isDocumentVisible) {
			if (!currentProjectId) {
				reviewWorkspaceSnapshotLoadingRef.current.clear();
				reviewWorkspaceSnapshotAttemptedRef.current.clear();
				lastFetchedSessionUpdatedAtByTaskIdRef.current = {};
			}
			return;
		}
		for (const reviewCard of reviewCards) {
			const sessionUpdatedAt = sessions[reviewCard.id]?.updatedAt ?? 0;
			const lastFetchedUpdatedAt = lastFetchedSessionUpdatedAtByTaskIdRef.current[reviewCard.id] ?? -1;
			const shouldRefreshForSessionUpdate = sessionUpdatedAt > lastFetchedUpdatedAt;
			if (!shouldRefreshForSessionUpdate && reviewWorkspaceSnapshotAttemptedRef.current.has(reviewCard.id)) {
				continue;
			}
			if (reviewWorkspaceSnapshotLoadingRef.current.has(reviewCard.id)) {
				continue;
			}
			reviewWorkspaceSnapshotAttemptedRef.current.add(reviewCard.id);
			reviewWorkspaceSnapshotLoadingRef.current.add(reviewCard.id);
			lastFetchedSessionUpdatedAtByTaskIdRef.current[reviewCard.id] = sessionUpdatedAt;
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(reviewCard);
				reviewWorkspaceSnapshotLoadingRef.current.delete(reviewCard.id);
				if (!snapshot || !activeReviewTaskIdsRef.current.has(reviewCard.id)) {
					return;
				}
				setTaskWorkspaceSnapshot(snapshot);
			})();
		}
	}, [currentProjectId, fetchReviewWorkspaceSnapshot, isDocumentVisible, reviewCards, sessions]);

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
			const sessionUpdatedAt = sessions[card.id]?.updatedAt ?? 0;
			const lastFetchedUpdatedAt = lastFetchedSessionUpdatedAtByTaskIdRef.current[card.id] ?? -1;
			if (sessionUpdatedAt <= lastFetchedUpdatedAt && lastFetchedUpdatedAt >= 0) {
				continue;
			}
			if (inProgressWorkspaceSnapshotLoadingRef.current.has(card.id)) {
				continue;
			}
			inProgressWorkspaceSnapshotLoadingRef.current.add(card.id);
			lastFetchedSessionUpdatedAtByTaskIdRef.current[card.id] = sessionUpdatedAt;
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(card);
				inProgressWorkspaceSnapshotLoadingRef.current.delete(card.id);
				if (!snapshot) {
					return;
				}
				setTaskWorkspaceSnapshot(snapshot);
			})();
		}
	}, [currentProjectId, fetchReviewWorkspaceSnapshot, inProgressCards, isDocumentVisible, sessions]);

	return {
		resetWorkspaceSnapshots,
	};
}
