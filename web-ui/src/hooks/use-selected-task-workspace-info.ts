import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useState } from "react";

import type { RuntimeTaskSessionSummary, RuntimeTaskWorkspaceInfoResponse } from "@/runtime/types";
import type { BoardCard, CardSelection } from "@/types";

function matchesWorkspaceInfoSelection(
	workspaceInfo: RuntimeTaskWorkspaceInfoResponse | null,
	card: BoardCard | null,
): workspaceInfo is RuntimeTaskWorkspaceInfoResponse {
	if (!workspaceInfo || !card) {
		return false;
	}
	return workspaceInfo.taskId === card.id && workspaceInfo.baseRef === card.baseRef;
}

interface UseSelectedTaskWorkspaceInfoInput {
	currentProjectId: string | null;
	selectedCard: CardSelection | null;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	fetchTaskWorkspaceInfo: (task: BoardCard) => Promise<RuntimeTaskWorkspaceInfoResponse | null>;
}

export interface UseSelectedTaskWorkspaceInfoResult {
	selectedTaskWorkspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
	setSelectedTaskWorkspaceInfo: Dispatch<SetStateAction<RuntimeTaskWorkspaceInfoResponse | null>>;
	activeSelectedTaskWorkspaceInfo: RuntimeTaskWorkspaceInfoResponse | null;
}

export function useSelectedTaskWorkspaceInfo({
	currentProjectId,
	selectedCard,
	sessions,
	fetchTaskWorkspaceInfo,
}: UseSelectedTaskWorkspaceInfoInput): UseSelectedTaskWorkspaceInfoResult {
	const [selectedTaskWorkspaceInfo, setSelectedTaskWorkspaceInfo] = useState<RuntimeTaskWorkspaceInfoResponse | null>(
		null,
	);

	const activeSelectedTaskWorkspaceInfo = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return matchesWorkspaceInfoSelection(selectedTaskWorkspaceInfo, selectedCard.card)
			? selectedTaskWorkspaceInfo
			: null;
	}, [selectedCard, selectedTaskWorkspaceInfo]);

	useEffect(() => {
		let cancelled = false;
		const loadSelectedTaskWorkspaceInfo = async () => {
			if (!selectedCard) {
				setSelectedTaskWorkspaceInfo(null);
				return;
			}
			setSelectedTaskWorkspaceInfo((current) => {
				if (matchesWorkspaceInfoSelection(current, selectedCard.card)) {
					return current;
				}
				return null;
			});
			const info = await fetchTaskWorkspaceInfo(selectedCard.card);
			if (!cancelled) {
				setSelectedTaskWorkspaceInfo(info);
			}
		};
		void loadSelectedTaskWorkspaceInfo();
		return () => {
			cancelled = true;
		};
	}, [
		fetchTaskWorkspaceInfo,
		selectedCard?.card.baseRef,
		selectedCard?.card.id,
		selectedCard ? (sessions[selectedCard.card.id]?.updatedAt ?? 0) : 0,
	]);

	return {
		selectedTaskWorkspaceInfo,
		setSelectedTaskWorkspaceInfo,
		activeSelectedTaskWorkspaceInfo,
	};
}
