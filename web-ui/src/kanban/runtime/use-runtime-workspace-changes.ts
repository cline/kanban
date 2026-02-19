import { useCallback, useEffect, useState } from "react";

import type { RuntimeWorkspaceChangesResponse } from "@/kanban/runtime/types";

interface RuntimeWorkspaceError {
	error: string;
}

export interface UseRuntimeWorkspaceChangesResult {
	changes: RuntimeWorkspaceChangesResponse | null;
	isLoading: boolean;
	isRuntimeAvailable: boolean;
	refresh: () => Promise<void>;
}

export function useRuntimeWorkspaceChanges(
	taskId: string | null,
	baseRef?: string | null,
): UseRuntimeWorkspaceChangesResult {
	const [changes, setChanges] = useState<RuntimeWorkspaceChangesResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRuntimeAvailable, setIsRuntimeAvailable] = useState(true);

	const refresh = useCallback(async () => {
		if (!taskId) {
			setChanges(null);
			setIsRuntimeAvailable(true);
			return;
		}

		setIsLoading(true);
		try {
			const params = new URLSearchParams({
				taskId,
			});
			if (baseRef !== undefined) {
				params.set("baseRef", baseRef ?? "");
			}
			const response = await fetch(`/api/workspace/changes?${params.toString()}`);
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as RuntimeWorkspaceError | null;
				throw new Error(payload?.error ?? `Workspace request failed with ${response.status}`);
			}

			const payload = (await response.json()) as RuntimeWorkspaceChangesResponse;
			setChanges(payload);
			setIsRuntimeAvailable(true);
		} catch {
			setChanges(null);
			setIsRuntimeAvailable(false);
		} finally {
			setIsLoading(false);
		}
	}, [baseRef, taskId]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return {
		changes,
		isLoading,
		isRuntimeAvailable,
		refresh,
	};
}
