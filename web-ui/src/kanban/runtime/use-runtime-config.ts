import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRuntimeConfig, saveRuntimeConfig } from "@/kanban/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/kanban/runtime/types";
import { useTrpcQuery } from "@/kanban/runtime/use-trpc-query";

export interface UseRuntimeConfigResult {
	config: RuntimeConfigResponse | null;
	isLoading: boolean;
	isSaving: boolean;
	save: (nextConfig: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutId?: string | null;
		agentAutonomousModeEnabled?: boolean;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
	}) => Promise<RuntimeConfigResponse | null>;
}

export function useRuntimeConfig(open: boolean, workspaceId: string | null): UseRuntimeConfigResult {
	const [isSaving, setIsSaving] = useState(false);
	const previousWorkspaceIdRef = useRef<string | null>(null);
	const queryFn = useCallback(async () => {
		if (!workspaceId) {
			throw new Error("No workspace selected.");
		}
		return await fetchRuntimeConfig(workspaceId);
	}, [workspaceId]);
	const configQuery = useTrpcQuery<RuntimeConfigResponse>({
		enabled: open && workspaceId !== null,
		queryFn,
		retainDataOnError: true,
	});
	const setConfigData = configQuery.setData;

	useEffect(() => {
		if (previousWorkspaceIdRef.current === workspaceId) {
			return;
		}
		previousWorkspaceIdRef.current = workspaceId;
		setConfigData(null);
	}, [setConfigData, workspaceId]);

	const save = useCallback(
		async (nextConfig: {
			selectedAgentId?: RuntimeAgentId;
			selectedShortcutId?: string | null;
			agentAutonomousModeEnabled?: boolean;
			shortcuts?: RuntimeProjectShortcut[];
			readyForReviewNotificationsEnabled?: boolean;
			commitPromptTemplate?: string;
			openPrPromptTemplate?: string;
		}): Promise<RuntimeConfigResponse | null> => {
			if (!workspaceId) {
				return null;
			}
			setIsSaving(true);
			try {
				const saved = await saveRuntimeConfig(workspaceId, nextConfig);
				setConfigData(saved);
				return saved;
			} catch {
				return null;
			} finally {
				setIsSaving(false);
			}
		},
		[setConfigData, workspaceId],
	);

	return {
		config: workspaceId ? configQuery.data : null,
		isLoading: open ? configQuery.isLoading : false,
		isSaving,
		save,
	};
}
