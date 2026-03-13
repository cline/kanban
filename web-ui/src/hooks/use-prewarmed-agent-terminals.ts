import { useEffect, useMemo, useRef } from "react";
import { getDetailTerminalTaskId } from "@/hooks/use-terminal-panels";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import {
	disposeAllPersistentTerminalsForWorkspace,
	disposePersistentTerminal,
	ensurePersistentTerminal,
} from "@/terminal/persistent-terminal-manager";

interface UsePrewarmedAgentTerminalsInput {
	currentProjectId: string | null;
	isWorkspaceReady: boolean;
	sessions: Record<string, RuntimeTaskSessionSummary>;
	cursorColor: string;
	terminalBackgroundColor: string;
}

function shouldPrewarmAgentTerminal(summary: RuntimeTaskSessionSummary): boolean {
	return summary.agentId !== null && summary.state !== "idle";
}

function disposeTaskOwnedTerminals(workspaceId: string, taskId: string): void {
	disposePersistentTerminal(workspaceId, taskId);
	disposePersistentTerminal(workspaceId, getDetailTerminalTaskId(taskId));
}

export function usePrewarmedAgentTerminals({
	currentProjectId,
	isWorkspaceReady,
	sessions,
	cursorColor,
	terminalBackgroundColor,
}: UsePrewarmedAgentTerminalsInput): void {
	const previousWorkspaceIdRef = useRef<string | null>(null);
	const previousTaskIdsRef = useRef<Set<string>>(new Set());
	const desiredTaskIds = useMemo(
		() =>
			new Set(
				Object.values(sessions)
					.filter(shouldPrewarmAgentTerminal)
					.map((summary) => summary.taskId),
			),
		[sessions],
	);

	useEffect(() => {
		const previousWorkspaceId = previousWorkspaceIdRef.current;
		const previousTaskIds = previousTaskIdsRef.current;

		if (previousWorkspaceId && previousWorkspaceId !== currentProjectId) {
			disposeAllPersistentTerminalsForWorkspace(previousWorkspaceId);
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
	}, [currentProjectId, cursorColor, desiredTaskIds, isWorkspaceReady, terminalBackgroundColor]);

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
