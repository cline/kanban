import { useCallback, useEffect, useState } from "react";

import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/kanban/runtime/types";

interface RuntimeConfigError {
	error: string;
}

export interface UseRuntimeConfigResult {
	config: RuntimeConfigResponse | null;
	isLoading: boolean;
	isSaving: boolean;
	load: () => Promise<void>;
	save: (nextConfig: {
		selectedAgentId: RuntimeAgentId;
		customAgentCommand: string | null;
		shortcuts?: RuntimeProjectShortcut[];
	}) => Promise<RuntimeConfigResponse | null>;
}

export function useRuntimeConfig(open: boolean): UseRuntimeConfigResult {
	const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const load = useCallback(async () => {
		if (!open) {
			return;
		}
		setIsLoading(true);
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
		} finally {
			setIsLoading(false);
		}
	}, [open]);

	const save = useCallback(
		async (nextConfig: {
			selectedAgentId: RuntimeAgentId;
			customAgentCommand: string | null;
			shortcuts?: RuntimeProjectShortcut[];
		}): Promise<RuntimeConfigResponse | null> => {
			setIsSaving(true);
			try {
				const response = await fetch("/api/runtime/config", {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify(nextConfig),
				});
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as RuntimeConfigError | null;
					throw new Error(payload?.error ?? `Runtime config save failed with ${response.status}`);
				}
				const payload = (await response.json()) as RuntimeConfigResponse;
				setConfig(payload);
				return payload;
			} catch {
				return null;
			} finally {
				setIsSaving(false);
			}
		},
		[],
	);

	useEffect(() => {
		void load();
	}, [load]);

	return {
		config,
		isLoading,
		isSaving,
		load,
		save,
	};
}
