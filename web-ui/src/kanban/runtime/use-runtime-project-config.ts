import { useEffect, useRef, useState } from "react";

import { fetchRuntimeConfig } from "@/kanban/runtime/runtime-config-query";
import type { RuntimeConfigResponse } from "@/kanban/runtime/types";

export interface UseRuntimeProjectConfigResult {
	config: RuntimeConfigResponse | null;
}

export function useRuntimeProjectConfig(
	workspaceId: string | null,
	refreshNonce = 0,
): UseRuntimeProjectConfigResult {
	const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
	const previousWorkspaceIdRef = useRef<string | null>(null);

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
			try {
				const fetched = await fetchRuntimeConfig(workspaceId);
				if (!cancelled) {
					setConfig(fetched);
				}
			} catch {
				if (!cancelled && didWorkspaceChange) {
					setConfig(null);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [refreshNonce, workspaceId]);

	return {
		config,
	};
}
