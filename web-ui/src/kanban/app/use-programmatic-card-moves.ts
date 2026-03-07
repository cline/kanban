import { useCallback, useEffect, useRef } from "react";

import type { RequestProgrammaticCardMove } from "@/kanban/components/kanban-board";
import type { ProgrammaticCardMoveInFlight } from "@/kanban/state/drag-rules";
import type { BoardColumnId } from "@/kanban/types";

interface RequestMoveTaskToTrashOptions {
	optimisticMoveApplied?: boolean;
	skipWorkingChangeWarning?: boolean;
}

type RequestMoveTaskToTrash = (
	taskId: string,
	fromColumnId: BoardColumnId,
	options?: RequestMoveTaskToTrashOptions,
) => Promise<void>;

export interface ProgrammaticCardMoveBehavior {
	skipKickoff?: boolean;
	skipTrashWorkflow?: boolean;
	skipWorkingChangeWarning?: boolean;
}

interface PendingProgrammaticTrashMoveCompletion {
	resolve: () => void;
	timeoutId: number;
}

interface ConsumedProgrammaticCardMove {
	behavior?: ProgrammaticCardMoveBehavior;
	programmaticCardMoveInFlight?: ProgrammaticCardMoveInFlight;
}

export function useProgrammaticCardMoves(): {
	handleProgrammaticCardMoveReady: (requestMove: RequestProgrammaticCardMove | null) => void;
	setRequestMoveTaskToTrashHandler: (handler: RequestMoveTaskToTrash) => void;
	tryProgrammaticCardMove: (
		taskId: string,
		fromColumnId: BoardColumnId,
		targetColumnId: BoardColumnId,
		behavior?: ProgrammaticCardMoveBehavior,
	) => boolean;
	consumeProgrammaticCardMove: (taskId: string) => ConsumedProgrammaticCardMove;
	resolvePendingProgrammaticTrashMove: (taskId: string) => void;
	resetProgrammaticCardMoves: () => void;
	requestMoveTaskToTrashWithAnimation: RequestMoveTaskToTrash;
} {
	const requestProgrammaticCardMoveRef = useRef<RequestProgrammaticCardMove | null>(null);
	const programmaticCardMoveInFlightRef = useRef<ProgrammaticCardMoveInFlight | null>(null);
	const programmaticCardMoveBehaviorByTaskIdRef = useRef<Record<string, ProgrammaticCardMoveBehavior>>({});
	const pendingProgrammaticTrashMoveCompletionByTaskIdRef =
		useRef<Record<string, PendingProgrammaticTrashMoveCompletion>>({});
	const requestMoveTaskToTrashRef = useRef<RequestMoveTaskToTrash | null>(null);

	const handleProgrammaticCardMoveReady = useCallback((requestMove: RequestProgrammaticCardMove | null) => {
		requestProgrammaticCardMoveRef.current = requestMove;
	}, []);

	const setRequestMoveTaskToTrashHandler = useCallback((handler: RequestMoveTaskToTrash) => {
		requestMoveTaskToTrashRef.current = handler;
	}, []);

	const clearProgrammaticCardMoveInFlight = useCallback((taskId?: string) => {
		if (taskId && programmaticCardMoveInFlightRef.current?.taskId !== taskId) {
			return;
		}
		programmaticCardMoveInFlightRef.current = null;
	}, []);

	const tryProgrammaticCardMove = useCallback((
		taskId: string,
		fromColumnId: BoardColumnId,
		targetColumnId: BoardColumnId,
		behavior?: ProgrammaticCardMoveBehavior,
	): boolean => {
		const requestMove = requestProgrammaticCardMoveRef.current;
		if (!requestMove || programmaticCardMoveInFlightRef.current) {
			return false;
		}
		const programmaticCardMoveInFlight: ProgrammaticCardMoveInFlight = {
			taskId,
			fromColumnId,
			toColumnId: targetColumnId,
		};
		if (behavior) {
			programmaticCardMoveBehaviorByTaskIdRef.current[taskId] = behavior;
		} else {
			delete programmaticCardMoveBehaviorByTaskIdRef.current[taskId];
		}
		programmaticCardMoveInFlightRef.current = programmaticCardMoveInFlight;
		const started = requestMove(programmaticCardMoveInFlight);
		if (!started) {
			clearProgrammaticCardMoveInFlight(taskId);
			delete programmaticCardMoveBehaviorByTaskIdRef.current[taskId];
		}
		return started;
	}, [clearProgrammaticCardMoveInFlight]);

	const consumeProgrammaticCardMove = useCallback((taskId: string): ConsumedProgrammaticCardMove => {
		const behavior = programmaticCardMoveBehaviorByTaskIdRef.current[taskId];
		delete programmaticCardMoveBehaviorByTaskIdRef.current[taskId];
		const programmaticCardMoveInFlight = programmaticCardMoveInFlightRef.current?.taskId === taskId
			? programmaticCardMoveInFlightRef.current
			: undefined;
		clearProgrammaticCardMoveInFlight(taskId);
		return {
			behavior,
			programmaticCardMoveInFlight,
		};
	}, [clearProgrammaticCardMoveInFlight]);

	const resolvePendingProgrammaticTrashMove = useCallback((taskId: string) => {
		const pending = pendingProgrammaticTrashMoveCompletionByTaskIdRef.current[taskId];
		if (!pending) {
			return;
		}
		window.clearTimeout(pending.timeoutId);
		delete pendingProgrammaticTrashMoveCompletionByTaskIdRef.current[taskId];
		pending.resolve();
	}, []);

	const resetProgrammaticCardMoves = useCallback(() => {
		clearProgrammaticCardMoveInFlight();
		programmaticCardMoveBehaviorByTaskIdRef.current = {};
		for (const taskId of Object.keys(pendingProgrammaticTrashMoveCompletionByTaskIdRef.current)) {
			resolvePendingProgrammaticTrashMove(taskId);
		}
	}, [clearProgrammaticCardMoveInFlight, resolvePendingProgrammaticTrashMove]);

	useEffect(() => {
		return () => {
			resetProgrammaticCardMoves();
		};
	}, [resetProgrammaticCardMoves]);

	const requestMoveTaskToTrashWithAnimation = useCallback<RequestMoveTaskToTrash>(async (
		taskId,
		fromColumnId,
		options,
	) => {
		const requestMoveTaskToTrash = requestMoveTaskToTrashRef.current;
		if (!requestMoveTaskToTrash) {
			return;
		}
		if (fromColumnId !== "review") {
			await requestMoveTaskToTrash(taskId, fromColumnId, options);
			return;
		}

		resolvePendingProgrammaticTrashMove(taskId);

		let resolveCompletion: (() => void) | null = null;
		const completionPromise = new Promise<void>((resolve) => {
			resolveCompletion = resolve;
		});
		const timeoutId = window.setTimeout(() => {
			resolvePendingProgrammaticTrashMove(taskId);
		}, 5000);
		pendingProgrammaticTrashMoveCompletionByTaskIdRef.current[taskId] = {
			resolve: () => {
				resolveCompletion?.();
				resolveCompletion = null;
			},
			timeoutId,
		};

		const startedProgrammaticMove = tryProgrammaticCardMove(taskId, fromColumnId, "trash", {
			skipWorkingChangeWarning: options?.skipWorkingChangeWarning,
		});
		if (!startedProgrammaticMove) {
			resolvePendingProgrammaticTrashMove(taskId);
			await requestMoveTaskToTrash(taskId, fromColumnId, options);
			return;
		}

		await completionPromise;
	}, [resolvePendingProgrammaticTrashMove, tryProgrammaticCardMove]);

	return {
		handleProgrammaticCardMoveReady,
		setRequestMoveTaskToTrashHandler,
		tryProgrammaticCardMove,
		consumeProgrammaticCardMove,
		resolvePendingProgrammaticTrashMove,
		resetProgrammaticCardMoves,
		requestMoveTaskToTrashWithAnimation,
	};
}
