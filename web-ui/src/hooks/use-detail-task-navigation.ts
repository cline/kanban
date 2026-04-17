import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buildDetailTaskUrl, parseDetailTaskIdFromSearch } from "@/hooks/app-utils";
import { findCardSelection } from "@/state/board-state";
import type { BoardData } from "@/types";
import { useWindowEvent } from "@/utils/react-use";

interface UseDetailTaskNavigationInput {
	board: BoardData;
	currentProjectId: string | null;
	isAwaitingWorkspaceSnapshot: boolean;
	isInitialRuntimeLoad: boolean;
	isProjectSwitching: boolean;
	isWorkspaceMetadataPending: boolean;
	onDetailClosed?: () => void;
}

export interface UseDetailTaskNavigationResult {
	selectedTaskId: string | null;
	selectedCard: ReturnType<typeof findCardSelection>;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	handleBack: () => void;
}

export function useDetailTaskNavigation({
	board,
	currentProjectId,
	isAwaitingWorkspaceSnapshot,
	isInitialRuntimeLoad,
	isProjectSwitching,
	isWorkspaceMetadataPending,
	onDetailClosed,
}: UseDetailTaskNavigationInput): UseDetailTaskNavigationResult {
	const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseDetailTaskIdFromSearch(window.location.search);
	});
	const previousProjectIdRef = useRef<string | null | undefined>(undefined);
	const onDetailClosedRef = useRef(onDetailClosed);
	const selectedCard = useMemo(() => {
		if (!selectedTaskId) {
			return null;
		}
		return findCardSelection(board, selectedTaskId);
	}, [board, selectedTaskId]);

	useEffect(() => {
		onDetailClosedRef.current = onDetailClosed;
	}, [onDetailClosed]);

	const closeDetail = useCallback(() => {
		setSelectedTaskId(null);
		onDetailClosedRef.current?.();
	}, []);

	useEffect(() => {
		const previousProjectId = previousProjectIdRef.current;
		previousProjectIdRef.current = currentProjectId;
		if (previousProjectId === undefined) {
			return;
		}
		if (previousProjectId === currentProjectId) {
			return;
		}
		closeDetail();
	}, [closeDetail, currentProjectId]);

	useEffect(() => {
		if (
			selectedTaskId &&
			(isInitialRuntimeLoad || isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending)
		) {
			return;
		}
		if (selectedTaskId && !selectedCard) {
			closeDetail();
		}
	}, [
		closeDetail,
		isAwaitingWorkspaceSnapshot,
		isInitialRuntimeLoad,
		isProjectSwitching,
		isWorkspaceMetadataPending,
		selectedCard,
		selectedTaskId,
	]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const currentUrl = new URL(window.location.href);
		const currentTaskIdInUrl = parseDetailTaskIdFromSearch(currentUrl.search);
		if (currentTaskIdInUrl === selectedTaskId) {
			return;
		}
		const nextUrl = buildDetailTaskUrl({
			pathname: currentUrl.pathname,
			search: currentUrl.search,
			hash: currentUrl.hash,
			taskId: selectedTaskId,
		});
		if (selectedTaskId && !currentTaskIdInUrl) {
			window.history.pushState(window.history.state, "", nextUrl);
			return;
		}
		window.history.replaceState(window.history.state, "", nextUrl);
	}, [selectedTaskId]);

	const handleTaskDetailPopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		setSelectedTaskId(parseDetailTaskIdFromSearch(window.location.search));
		onDetailClosedRef.current?.();
	}, []);
	useWindowEvent("popstate", handleTaskDetailPopState);

	return {
		selectedTaskId,
		selectedCard,
		setSelectedTaskId,
		handleBack: closeDetail,
	};
}
