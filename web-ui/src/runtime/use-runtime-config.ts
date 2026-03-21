import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRuntimeConfig, saveRuntimeConfig } from "@/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export interface UseRuntimeConfigResult {
	config: RuntimeConfigResponse | null;
	isLoading: boolean;
	isSaving: boolean;
	refresh: () => void;
	save: (nextConfig: {
		selectedAgentId?: RuntimeAgentId;
		selectedShortcutLabel?: string | null;
		agentAutonomousModeEnabled?: boolean;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitPromptTemplate?: string;
		openPrPromptTemplate?: string;
	}) => Promise<RuntimeConfigResponse | null>;
}

export function useRuntimeConfig(
	open: boolean,
	workspaceId: string | null,
	initialConfig: RuntimeConfigResponse | null = null,
): UseRuntimeConfigResult {
	const [isSaving, setIsSaving] = useState(false);
	const previousWorkspaceIdRef = useRef<string | null>(null);
	const queryFn = useCallback(async () => await fetchRuntimeConfig(workspaceId), [workspaceId]);
	const configQuery = useTrpcQuery<RuntimeConfigResponse>({
		enabled: open,
		queryFn,
		retainDataOnError: true,
	});
	const setConfigData = configQuery.setData;

	useEffect(() => {
		const workspaceChanged = previousWorkspaceIdRef.current !== workspaceId;
		previousWorkspaceIdRef.current = workspaceId;
		if (workspaceChanged) {
			setConfigData(initialConfig);
			return;
		}
		if (configQuery.data === null && initialConfig !== null) {
			setConfigData(initialConfig);
		}
	}, [configQuery.data, initialConfig, setConfigData, workspaceId]);

	const save = useCallback(
		async (nextConfig: {
			selectedAgentId?: RuntimeAgentId;
			selectedShortcutLabel?: string | null;
			agentAutonomousModeEnabled?: boolean;
			shortcuts?: RuntimeProjectShortcut[];
			readyForReviewNotificationsEnabled?: boolean;
			commitPromptTemplate?: string;
			openPrPromptTemplate?: string;
		}): Promise<RuntimeConfigResponse | null> => {
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

	const refresh = useCallback(() => {
		void configQuery.refetch();
	}, [configQuery.refetch]);

	return {
		config: configQuery.data ?? initialConfig,
		isLoading: open ? configQuery.isLoading && configQuery.data === null && initialConfig === null : false,
		isSaving,
		refresh,
		save,
	};
}
