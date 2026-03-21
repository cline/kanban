import { useEffect, useMemo, useRef } from "react";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardData } from "@/types";
import {
	disposeAllPersistentTerminalsForWorkspace,
	disposePersistentTerminal,
	ensurePersistentTerminal,
} from "@/terminal/persistent-terminal-manager";

interface UsePrewarmedAgentTerminalsInput {
	currentProjectId: string | null;
	isWorkspaceReady: boolean;
	isRuntimeDisconnected: boolean;
	board: BoardData;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	cursorColor: string;
	terminalBackgroundColor: string;
}

function shouldPrewarmAgentTerminal(summary: RuntimeTaskSessionSummary): boolean {
	return summary.agentId !== null && (summary.state === "running" || summary.state === "awaiting_review");
}

function collectActiveBoardTaskIds(board: BoardData): Set<string> {
	const taskIds = new Set<string>();
	for (const column of board.columns) {
		if (column.id !== "in_progress" && column.id !== "review") {
			continue;
		}
		for (const card of column.cards) {
			taskIds.add(card.id);
		}
	}
	return taskIds;
}

function disposeTaskOwnedTerminals(workspaceId: string, taskId: string): void {
	disposePersistentTerminal(workspaceId, taskId);
}

export function usePrewarmedAgentTerminals({
	currentProjectId,
	isWorkspaceReady,
	isRuntimeDisconnected,
	board,
	sessions,
	cursorColor,
	terminalBackgroundColor,
}: UsePrewarmedAgentTerminalsInput): void {
	const previousWorkspaceIdRef = useRef<string | null>(null);
	const previousTaskIdsRef = useRef<Set<string>>(new Set());
	const activeBoardTaskIds = useMemo(() => collectActiveBoardTaskIds(board), [board]);
	const desiredTaskIds = useMemo(
		() =>
			new Set(
				Object.values(sessions)
					.filter((summary) => activeBoardTaskIds.has(summary.taskId))
					.filter(shouldPrewarmAgentTerminal)
					.map((summary) => summary.taskId),
			),
		[activeBoardTaskIds, sessions],
	);

	useEffect(() => {
		const previousWorkspaceId = previousWorkspaceIdRef.current;
		const previousTaskIds = previousTaskIdsRef.current;

		if (previousWorkspaceId && previousWorkspaceId !== currentProjectId) {
			previousTaskIds.clear();
		}

		if (!currentProjectId) {
			previousWorkspaceIdRef.current = null;
			previousTaskIdsRef.current = new Set();
			return;
		}

		if (!isWorkspaceReady) {
			previousWorkspaceIdRef.current = currentProjectId;
			previousTaskIdsRef.current = new Set();
			return;
		}

		if (isRuntimeDisconnected) {
			disposeAllPersistentTerminalsForWorkspace(currentProjectId);
			previousWorkspaceIdRef.current = currentProjectId;
			previousTaskIdsRef.current = new Set();
			return;
		}

		for (const taskId of desiredTaskIds) {
			ensurePersistentTerminal({
				taskId,
				workspaceId: currentProjectId,
				cursorColor,
				terminalBackgroundColor,
			});
		}

		for (const taskId of previousTaskIds) {
			if (desiredTaskIds.has(taskId)) {
				continue;
			}
			disposeTaskOwnedTerminals(currentProjectId, taskId);
		}

		previousWorkspaceIdRef.current = currentProjectId;
		previousTaskIdsRef.current = new Set(desiredTaskIds);
	}, [
		currentProjectId,
		cursorColor,
		desiredTaskIds,
		isRuntimeDisconnected,
		isWorkspaceReady,
		terminalBackgroundColor,
	]);

	useEffect(() => {
		return () => {
			const workspaceId = previousWorkspaceIdRef.current;
			if (!workspaceId) {
				return;
			}
			disposeAllPersistentTerminalsForWorkspace(workspaceId);
			previousWorkspaceIdRef.current = null;
			previousTaskIdsRef.current = new Set();
		};
	}, []);
}
