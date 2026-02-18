import { useCallback, useEffect, useState } from "react";

import type { RuntimeConfigResponse } from "@/kanban/runtime/types";

interface RuntimeConfigError {
	error: string;
}

export interface UseRuntimeProjectConfigResult {
	config: RuntimeConfigResponse | null;
	refresh: () => Promise<void>;
}

export function useRuntimeProjectConfig(): UseRuntimeProjectConfigResult {
	const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);

	const refresh = useCallback(async () => {
		try {
			const response = await fetch("/api/runtime/config");
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as RuntimeConfigError | null;
				throw new Error(payload?.error ?? `Runtime config request failed with ${response.status}`);
			}
			const payload = (await response.json()) as RuntimeConfigResponse;
			setConfig(payload);
		} catch {
			setConfig(null);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return {
		config,
		refresh,
	};
}
