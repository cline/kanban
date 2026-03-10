import { useEffect } from "react";

import type { RuntimeTaskSessionSummary, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import { clearTaskWorkspaceInfo, setTaskWorkspaceInfo } from "@/stores/workspace-metadata-store";
import type { BoardCard, CardSelection } from "@/types";

interface UseSelectedTaskWorkspaceInfoInput {
	currentProjectId: string | null;
	selectedCard: CardSelection | null;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
}

export interface UseSelectedTaskWorkspaceInfoResult {
	clearSelectedTaskWorkspaceInfo: () => void;
}

export function useSelectedTaskWorkspaceInfo({
	currentProjectId,
	selectedCard,
	sessions,
	fetchTaskWorkspaceInfo,
}: UseSelectedTaskWorkspaceInfoInput): UseSelectedTaskWorkspaceInfoResult {
	useEffect(() => {
		let cancelled = false;
		const loadSelectedTaskWorkspaceInfo = async () => {
			if (!selectedCard || !currentProjectId) {
				return;
			}
			const info = await fetchTaskWorkspaceInfo(selectedCard.card);
			if (!cancelled && info) {
				setTaskWorkspaceInfo(info);
			}
		};
		void loadSelectedTaskWorkspaceInfo();
		return () => {
			cancelled = true;
		};
	}, [
		currentProjectId,
		fetchTaskWorkspaceInfo,
		selectedCard?.card.baseRef,
		selectedCard?.card.id,
		selectedCard ? (sessions[selectedCard.card.id]?.updatedAt ?? 0) : 0,
	]);

	return {
		clearSelectedTaskWorkspaceInfo: () => {
			clearTaskWorkspaceInfo(selectedCard?.card.id ?? null);
		},
	};
}
