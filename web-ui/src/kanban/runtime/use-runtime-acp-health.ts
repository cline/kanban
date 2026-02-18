import { useEffect, useState } from "react";

import type { RuntimeAcpHealthResponse } from "@/kanban/runtime/types";

interface RuntimeHealthError {
	error: string;
}

export interface UseRuntimeAcpHealthResult {
	health: RuntimeAcpHealthResponse | null;
}

export function useRuntimeAcpHealth(): UseRuntimeAcpHealthResult {
	const [health, setHealth] = useState<RuntimeAcpHealthResponse | null>(null);

	useEffect(() => {
		let cancelled = false;

		const load = async () => {
			try {
				const response = await fetch("/api/acp/health");
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as RuntimeHealthError | null;
					throw new Error(payload?.error ?? `Health request failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeAcpHealthResponse;
				if (!cancelled) {
					setHealth(payload);
				}
			} catch {
				if (!cancelled) {
					setHealth(null);
				}
			}
		};

		void load();

		return () => {
			cancelled = true;
		};
	}, []);

	return { health };
}
