import { useCallback } from "react";

import { fetchRuntimeConfig } from "@/kanban/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/kanban/runtime/types";
import { useTrpcQuery } from "@/kanban/runtime/use-trpc-query";

export interface UseRuntimeProjectConfigResult {
	config: RuntimeConfigResponse | null;
	refresh: () => void;
}

export function useRuntimeProjectConfig(workspaceId: string | null): UseRuntimeProjectConfigResult {
	const queryFn = useCallback(async () => {
		if (!workspaceId) {
			throw new Error("No workspace selected.");
		}
		return await fetchRuntimeConfig(workspaceId);
	}, [workspaceId]);
	const configQuery = useTrpcQuery<RuntimeConfigResponse>({
		enabled: workspaceId !== null,
		queryFn,
	});

	const refresh = useCallback(() => {
		void configQuery.refetch();
	}, [configQuery.refetch]);

	return {
		config: workspaceId ? configQuery.data : null,
		refresh,
	};
}
