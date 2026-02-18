import { useCallback, useEffect, useState } from "react";

import type { RuntimeAcpHealthResponse } from "@/kanban/runtime/types";

interface RuntimeHealthError {
	error: string;
}

export interface UseRuntimeAcpHealthResult {
	health: RuntimeAcpHealthResponse | null;
	refresh: () => Promise<void>;
}

export function useRuntimeAcpHealth(): UseRuntimeAcpHealthResult {
	const [health, setHealth] = useState<RuntimeAcpHealthResponse | null>(null);

	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/acp/health");
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as RuntimeHealthError | null;
				throw new Error(payload?.error ?? `Health request failed with ${response.status}`);
			}
			const payload = (await response.json()) as RuntimeAcpHealthResponse;
			setHealth(payload);
		} catch {
			setHealth(null);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return {
		health,
		refresh,
	};
}
