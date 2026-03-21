import { useCallback, useEffect, useRef } from "react";

import { fetchRuntimeConfig } from "@/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export interface UseRuntimeProjectConfigResult {
	config: RuntimeConfigResponse | null;
	isLoading: boolean;
	refresh: () => void;
}

export function useRuntimeProjectConfig(workspaceId: string | null): UseRuntimeProjectConfigResult {
	const previousWorkspaceIdRef = useRef<string | null>(null);
	const queryFn = useCallback(async () => await fetchRuntimeConfig(workspaceId), [workspaceId]);
	const configQuery = useTrpcQuery<RuntimeConfigResponse>({
		enabled: true,
		queryFn,
	});
	const setConfigData = configQuery.setData;

	useEffect(() => {
		const workspaceChanged = previousWorkspaceIdRef.current !== workspaceId;
		previousWorkspaceIdRef.current = workspaceId;
		if (workspaceChanged) {
			setConfigData(null);
		}
	}, [setConfigData, workspaceId]);

	const refresh = useCallback(() => {
		void configQuery.refetch();
	}, [configQuery.refetch]);

	return {
		config: configQuery.data,
		isLoading: configQuery.isLoading && configQuery.data === null,
		refresh,
	};
}
