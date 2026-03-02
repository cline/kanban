import { useCallback, useEffect, useRef, useState } from "react";

import { fetchRuntimeConfig } from "@/kanban/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/kanban/runtime/types";

export interface UseRuntimeProjectConfigResult {
	config: RuntimeConfigResponse | null;
	refresh: () => void;
}

export function useRuntimeProjectConfig(
	workspaceId: string | null,
): UseRuntimeProjectConfigResult {
	const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
	const previousWorkspaceIdRef = useRef<string | null>(null);
	const fetchConfig = useCallback(async (targetWorkspaceId: string): Promise<RuntimeConfigResponse | null> => {
		try {
			return await fetchRuntimeConfig(targetWorkspaceId);
		} catch {
			return null;
		}
	}, []);

	useEffect(() => {
		if (!workspaceId) {
			setConfig(null);
			previousWorkspaceIdRef.current = null;
			return;
		}
		const didWorkspaceChange = previousWorkspaceIdRef.current !== workspaceId;
		previousWorkspaceIdRef.current = workspaceId;
		if (didWorkspaceChange) {
			setConfig(null);
		}
		let cancelled = false;
		void (async () => {
			const fetched = await fetchConfig(workspaceId);
			if (cancelled) {
				return;
			}
			if (fetched) {
				setConfig(fetched);
				return;
			}
			if (didWorkspaceChange) {
				setConfig(null);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [fetchConfig, workspaceId]);

	const refresh = useCallback(() => {
		if (!workspaceId) {
			return;
		}
		void (async () => {
			const fetched = await fetchConfig(workspaceId);
			if (fetched) {
				setConfig(fetched);
			}
		})();
	}, [fetchConfig, workspaceId]);

	return {
		config,
		refresh,
	};
}
