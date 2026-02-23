import { useCallback, useEffect, useRef, useState } from "react";

import type { RuntimeWorkspaceChangesResponse } from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";

interface RuntimeWorkspaceError {
	error: string;
}

export interface UseRuntimeWorkspaceChangesResult {
	changes: RuntimeWorkspaceChangesResponse | null;
	isLoading: boolean;
	isRuntimeAvailable: boolean;
	refresh: () => Promise<void>;
}

async function fetchRuntimeWorkspaceChanges(
	taskId: string,
	workspaceId: string,
	baseRef?: string | null,
): Promise<RuntimeWorkspaceChangesResponse> {
	const params = new URLSearchParams({
		taskId,
	});
	if (baseRef !== undefined) {
		params.set("baseRef", baseRef ?? "");
	}
	const response = await workspaceFetch(`/api/workspace/changes?${params.toString()}`, {
		workspaceId,
	});
	if (!response.ok) {
		const payload = (await response.json().catch(() => null)) as RuntimeWorkspaceError | null;
		throw new Error(payload?.error ?? `Workspace request failed with ${response.status}`);
	}
	return (await response.json()) as RuntimeWorkspaceChangesResponse;
}

export function useRuntimeWorkspaceChanges(
	taskId: string | null,
	workspaceId: string | null,
	baseRef?: string | null,
): UseRuntimeWorkspaceChangesResult {
	const [changes, setChanges] = useState<RuntimeWorkspaceChangesResponse | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRuntimeAvailable, setIsRuntimeAvailable] = useState(true);
	const refreshRequestIdRef = useRef(0);

	const refresh = useCallback(async () => {
		if (!taskId || !workspaceId) {
			return;
		}
		const requestId = refreshRequestIdRef.current + 1;
		refreshRequestIdRef.current = requestId;
		setIsLoading(true);
		try {
			const nextChanges = await fetchRuntimeWorkspaceChanges(taskId, workspaceId, baseRef);
			if (refreshRequestIdRef.current !== requestId) {
				return;
			}
			setChanges(nextChanges);
			setIsRuntimeAvailable(true);
		} catch {
			if (refreshRequestIdRef.current !== requestId) {
				return;
			}
			setChanges(null);
			setIsRuntimeAvailable(false);
		} finally {
			if (refreshRequestIdRef.current === requestId) {
				setIsLoading(false);
			}
		}
	}, [baseRef, taskId, workspaceId]);

	useEffect(() => {
		refreshRequestIdRef.current += 1;
		if (!taskId || !workspaceId) {
			setChanges(null);
			setIsLoading(false);
			setIsRuntimeAvailable(workspaceId !== null);
			return;
		}
		void refresh();
	}, [refresh, taskId, workspaceId]);

	if (!taskId) {
		return {
			changes: null,
			isLoading: false,
			isRuntimeAvailable: true,
			refresh,
		};
	}

	if (!workspaceId) {
		return {
			changes: null,
			isLoading: false,
			isRuntimeAvailable: false,
			refresh,
		};
	}

	return {
		changes,
		isLoading,
		isRuntimeAvailable,
		refresh,
	};
}
