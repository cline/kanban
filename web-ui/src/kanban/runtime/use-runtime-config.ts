import { useCallback, useEffect, useState } from "react";

import { fetchRuntimeConfig, saveRuntimeConfig } from "@/kanban/runtime/runtime-config-query";
import type { RuntimeAgentId, RuntimeConfigResponse, RuntimeProjectShortcut } from "@/kanban/runtime/types";

export interface UseRuntimeConfigResult {
	config: RuntimeConfigResponse | null;
	isLoading: boolean;
	isSaving: boolean;
	save: (nextConfig: {
		selectedAgentId: RuntimeAgentId;
		shortcuts?: RuntimeProjectShortcut[];
		readyForReviewNotificationsEnabled?: boolean;
		commitLocalPromptTemplate?: string;
		commitWorktreePromptTemplate?: string;
		openPrLocalPromptTemplate?: string;
		openPrWorktreePromptTemplate?: string;
	}) => Promise<RuntimeConfigResponse | null>;
}

export function useRuntimeConfig(open: boolean, workspaceId: string | null): UseRuntimeConfigResult {
	const [config, setConfig] = useState<RuntimeConfigResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!open || !workspaceId) {
			setIsLoading(false);
			return;
		}
		let cancelled = false;
		setIsLoading(true);
		void (async () => {
			try {
				const fetched = await fetchRuntimeConfig(workspaceId);
				if (!cancelled) {
					setConfig(fetched);
				}
			} catch {
				// Keep existing settings visible if runtime fetch fails.
			} finally {
				if (!cancelled) {
					setIsLoading(false);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId]);

	const save = useCallback(
		async (nextConfig: {
			selectedAgentId: RuntimeAgentId;
			shortcuts?: RuntimeProjectShortcut[];
			readyForReviewNotificationsEnabled?: boolean;
			commitLocalPromptTemplate?: string;
			commitWorktreePromptTemplate?: string;
			openPrLocalPromptTemplate?: string;
			openPrWorktreePromptTemplate?: string;
		}): Promise<RuntimeConfigResponse | null> => {
			if (!workspaceId) {
				return null;
			}
			setIsSaving(true);
			try {
				const saved = await saveRuntimeConfig(workspaceId, nextConfig);
				setConfig(saved);
				return saved;
			} catch {
				return null;
			} finally {
				setIsSaving(false);
			}
		},
		[workspaceId],
	);

	return {
		config: workspaceId ? config : null,
		isLoading: open ? isLoading : false,
		isSaving,
		save,
	};
}
