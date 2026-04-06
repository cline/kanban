import type { DropResult } from "@hello-pangea/dnd";
import { useCallback, useRef, useState } from "react";
import { notifyError } from "@/components/app-toaster";
import { fetchWorkspaceState, saveWorkspaceState } from "@/runtime/workspace-state-query";
import { isAllowedCrossColumnCardMove } from "@/state/drag-rules";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";

export interface AllProjectsDragMoveResult {
	updatedBoard: BoardData;
	projectId: string;
	projectTaskId: string;
	fromColumnId: BoardColumnId;
	toColumnId: BoardColumnId;
}

/**
 * Applies a drag result to the all-projects aggregated board.
 * Returns null if the drop is invalid or disallowed.
 */
export function applyAllProjectsDragResult(board: BoardData, result: DropResult): AllProjectsDragMoveResult | null {
	const { source, destination } = result;

	if (!destination) {
		return null;
	}

	if (source.droppableId === destination.droppableId && source.index === destination.index) {
		return null;
	}

	const fromColumnId = source.droppableId as BoardColumnId;
	const toColumnId = destination.droppableId as BoardColumnId;

	if (fromColumnId !== toColumnId && !isAllowedCrossColumnCardMove(fromColumnId, toColumnId)) {
		return null;
	}

	const sourceColumnIndex = board.columns.findIndex((c) => c.id === fromColumnId);
	const destColumnIndex = board.columns.findIndex((c) => c.id === toColumnId);
	const sourceColumn = board.columns[sourceColumnIndex];
	const destColumn = board.columns[destColumnIndex];

	if (!sourceColumn || !destColumn) {
		return null;
	}

	const card = sourceColumn.cards[source.index];
	if (!card) {
		return null;
	}

	const projectId = card.projectId;
	const projectTaskId = card.projectTaskId ?? card.id;
	if (!projectId) {
		return null;
	}

	const newColumns = board.columns.map((col) => ({ ...col, cards: [...col.cards] }));
	newColumns[sourceColumnIndex]!.cards.splice(source.index, 1);
	newColumns[destColumnIndex]!.cards.splice(destination.index, 0, card);

	return {
		updatedBoard: { ...board, columns: newColumns },
		projectId,
		projectTaskId,
		fromColumnId,
		toColumnId,
	};
}

/**
 * Persists a card move from the all-projects view to the target project's workspace state.
 */
export async function persistAllProjectsCardMove(
	projectId: string,
	projectTaskId: string,
	toColumnId: BoardColumnId,
): Promise<void> {
	const state = await fetchWorkspaceState(projectId);

	let cardToMove: BoardCard | undefined;
	const updatedColumns = state.board.columns.map((col) => ({
		...col,
		cards: col.cards.filter((c) => {
			if (c.id === projectTaskId) {
				cardToMove = { ...c, updatedAt: Date.now() };
				return false;
			}
			return true;
		}),
	}));

	if (!cardToMove) {
		return;
	}

	const targetColumn = updatedColumns.find((c) => c.id === toColumnId);
	if (!targetColumn) {
		return;
	}
	targetColumn.cards.unshift(cardToMove);

	await saveWorkspaceState(projectId, {
		board: { columns: updatedColumns, dependencies: state.board.dependencies },
		sessions: state.sessions,
		expectedRevision: state.revision,
	});
}

interface UseAllProjectsDragResult {
	board: BoardData;
	handleDragEnd: (result: DropResult) => void;
}

/**
 * Hook that provides an optimistically-updated board and a drag-end handler
 * for the all-projects view. The `sourceBoard` from `useAllProjectsBoard`
 * is used as the source of truth, with local overrides applied on drag.
 */
export function useAllProjectsDrag(sourceBoard: BoardData): UseAllProjectsDragResult {
	const [optimisticBoard, setOptimisticBoard] = useState<BoardData | null>(null);
	const persistInFlightRef = useRef(false);
	const latestSourceBoardRef = useRef(sourceBoard);
	latestSourceBoardRef.current = sourceBoard;

	// Clear optimistic override when source board updates, but only if no persist is in flight.
	// While persisting, the source board may briefly revert to pre-move state before the
	// server-side update propagates, so we keep the optimistic board to avoid flicker.
	const prevSourceBoardRef = useRef(sourceBoard);
	if (prevSourceBoardRef.current !== sourceBoard) {
		prevSourceBoardRef.current = sourceBoard;
		if (optimisticBoard !== null && !persistInFlightRef.current) {
			setOptimisticBoard(null);
		}
	}

	const handleDragEnd = useCallback(
		(result: DropResult) => {
			const currentBoard = optimisticBoard ?? latestSourceBoardRef.current;
			const moveResult = applyAllProjectsDragResult(currentBoard, result);
			if (!moveResult) {
				return;
			}

			persistInFlightRef.current = true;
			setOptimisticBoard(moveResult.updatedBoard);

			void persistAllProjectsCardMove(moveResult.projectId, moveResult.projectTaskId, moveResult.toColumnId)
				.then(() => {
					persistInFlightRef.current = false;
					setOptimisticBoard(null);
				})
				.catch((error) => {
					persistInFlightRef.current = false;
					setOptimisticBoard(null);
					notifyError("Failed to move task", error);
				});
		},
		[optimisticBoard],
	);

	return {
		board: optimisticBoard ?? sourceBoard,
		handleDragEnd,
	};
}
