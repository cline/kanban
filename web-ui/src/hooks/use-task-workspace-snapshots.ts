import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { BoardCard, ReviewTaskWorkspaceSnapshot } from "@/types";

interface UseTaskWorkspaceSnapshotsOptions {
	currentProjectId: string | null;
	reviewCards: BoardCard[];
	inProgressCards: BoardCard[];
	trashCards: BoardCard[];
	isDocumentVisible: boolean;
	fetchReviewWorkspaceSnapshot: (task: BoardCard) => Promise<ReviewTaskWorkspaceSnapshot | null>;
}

interface UseTaskWorkspaceSnapshotsResult {
	workspaceSnapshots: Record<string, ReviewTaskWorkspaceSnapshot>;
	resetWorkspaceSnapshots: () => void;
}

export function useTaskWorkspaceSnapshots(options: UseTaskWorkspaceSnapshotsOptions): UseTaskWorkspaceSnapshotsResult {
	const {
		currentProjectId,
		reviewCards,
		inProgressCards,
		trashCards,
		isDocumentVisible,
		fetchReviewWorkspaceSnapshot,
	} = options;
	const [workspaceSnapshots, setWorkspaceSnapshots] = useState<Record<string, ReviewTaskWorkspaceSnapshot>>({});
	const reviewWorkspaceSnapshotLoadingRef = useRef<Set<string>>(new Set());
	const inProgressWorkspaceSnapshotLoadingRef = useRef<Set<string>>(new Set());
	const reviewWorkspaceSnapshotAttemptedRef = useRef<Set<string>>(new Set());
	const activeReviewTaskIdsRef = useRef<Set<string>>(new Set());

	const resetWorkspaceSnapshots = useCallback(() => {
		setWorkspaceSnapshots({});
		reviewWorkspaceSnapshotLoadingRef.current.clear();
		inProgressWorkspaceSnapshotLoadingRef.current.clear();
		reviewWorkspaceSnapshotAttemptedRef.current.clear();
		activeReviewTaskIdsRef.current = new Set();
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

	const upsertWorkspaceSnapshot = useCallback((taskId: string, snapshot: ReviewTaskWorkspaceSnapshot) => {
		setWorkspaceSnapshots((current) => {
			const existing = current[taskId];
			if (existing && JSON.stringify(existing) === JSON.stringify(snapshot)) {
				return current;
			}
			return {
				...current,
				[taskId]: snapshot,
			};
		});
	}, []);

	useEffect(() => {
		setWorkspaceSnapshots((current) => {
			let changed = false;
			const next: Record<string, ReviewTaskWorkspaceSnapshot> = {};
			for (const [taskId, snapshot] of Object.entries(current)) {
				if (activeWorkspaceSnapshotTaskIds.has(taskId)) {
					next[taskId] = snapshot;
					continue;
				}
				changed = true;
			}
			return changed ? next : current;
		});
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
		if (!currentProjectId) {
			reviewWorkspaceSnapshotLoadingRef.current.clear();
			reviewWorkspaceSnapshotAttemptedRef.current.clear();
			return;
		}
		for (const reviewCard of reviewCards) {
			if (workspaceSnapshots[reviewCard.id]) {
				continue;
			}
			if (reviewWorkspaceSnapshotAttemptedRef.current.has(reviewCard.id)) {
				continue;
			}
			if (reviewWorkspaceSnapshotLoadingRef.current.has(reviewCard.id)) {
				continue;
			}
			reviewWorkspaceSnapshotAttemptedRef.current.add(reviewCard.id);
			reviewWorkspaceSnapshotLoadingRef.current.add(reviewCard.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(reviewCard);
				reviewWorkspaceSnapshotLoadingRef.current.delete(reviewCard.id);
				if (!snapshot || !activeReviewTaskIdsRef.current.has(reviewCard.id)) {
					return;
				}
				upsertWorkspaceSnapshot(reviewCard.id, snapshot);
			})();
		}
	}, [currentProjectId, fetchReviewWorkspaceSnapshot, reviewCards, upsertWorkspaceSnapshot, workspaceSnapshots]);

	useEffect(() => {
		const inProgressTaskIds = new Set(inProgressCards.map((card) => card.id));
		inProgressWorkspaceSnapshotLoadingRef.current.forEach((taskId) => {
			if (!inProgressTaskIds.has(taskId)) {
				inProgressWorkspaceSnapshotLoadingRef.current.delete(taskId);
			}
		});

		if (!currentProjectId) {
			inProgressWorkspaceSnapshotLoadingRef.current.clear();
			return;
		}
		for (const card of inProgressCards) {
			if (workspaceSnapshots[card.id]) {
				continue;
			}
			if (inProgressWorkspaceSnapshotLoadingRef.current.has(card.id)) {
				continue;
			}
			inProgressWorkspaceSnapshotLoadingRef.current.add(card.id);
			void (async () => {
				const snapshot = await fetchReviewWorkspaceSnapshot(card);
				inProgressWorkspaceSnapshotLoadingRef.current.delete(card.id);
				if (!snapshot) {
					return;
				}
				upsertWorkspaceSnapshot(card.id, snapshot);
			})();
		}
	}, [currentProjectId, fetchReviewWorkspaceSnapshot, inProgressCards, upsertWorkspaceSnapshot, workspaceSnapshots]);

	return {
		workspaceSnapshots,
		resetWorkspaceSnapshots,
	};
}
