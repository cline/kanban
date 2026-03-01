import { useCallback, useEffect, useRef, useState } from "react";

import type { RuntimeWorkspaceChangesResponse } from "@/kanban/runtime/types";
import { workspaceFetch } from "@/kanban/runtime/workspace-fetch";

interface RuntimeWorkspaceError {
	error: string;
}

interface WorkspaceChangesCacheEntry {
	changes: RuntimeWorkspaceChangesResponse;
	updatedAt: number;
}

export interface UseRuntimeWorkspaceChangesResult {
	changes: RuntimeWorkspaceChangesResponse | null;
	isLoading: boolean;
	isRuntimeAvailable: boolean;
	refresh: () => Promise<void>;
}

const WORKSPACE_CHANGES_CACHE_MAX_ENTRIES = 32;

function buildWorkspaceChangesCacheKey(input: {
	taskId: string;
	workspaceId: string;
	baseRef?: string | null;
}): string {
	return `${input.workspaceId}\t${input.taskId}\t${input.baseRef ?? ""}`;
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
	const refreshContextVersionRef = useRef(0);
	const refreshInFlightRef = useRef(false);
	const refreshPendingRef = useRef(false);
	const changesCacheRef = useRef<Map<string, WorkspaceChangesCacheEntry>>(new Map());
	const activeCacheKeyRef = useRef<string | null>(null);

	const rememberChangesForCache = useCallback(
		(cacheKey: string, nextChanges: RuntimeWorkspaceChangesResponse) => {
			const cache = changesCacheRef.current;
			cache.delete(cacheKey);
			cache.set(cacheKey, {
				changes: nextChanges,
				updatedAt: Date.now(),
			});
			if (cache.size <= WORKSPACE_CHANGES_CACHE_MAX_ENTRIES) {
				return;
			}
			const oldest = cache.keys().next().value;
			if (!oldest) {
				return;
			}
			cache.delete(oldest);
		},
		[],
	);

	const fetchAndStoreChanges = useCallback(async () => {
		if (!taskId || !workspaceId) {
			return;
		}
		const cacheKey = buildWorkspaceChangesCacheKey({ taskId, workspaceId, baseRef });
		const requestId = refreshRequestIdRef.current + 1;
		refreshRequestIdRef.current = requestId;
		try {
			const nextChanges = await fetchRuntimeWorkspaceChanges(taskId, workspaceId, baseRef);
			if (refreshRequestIdRef.current !== requestId) {
				return;
			}
			rememberChangesForCache(cacheKey, nextChanges);
			setChanges(nextChanges);
			setIsRuntimeAvailable(true);
		} catch {
			if (refreshRequestIdRef.current !== requestId) {
				return;
			}
			setChanges(null);
			setIsRuntimeAvailable(false);
		}
	}, [baseRef, rememberChangesForCache, taskId, workspaceId]);

	const refresh = useCallback(async () => {
		if (!taskId || !workspaceId) {
			return;
		}
		if (refreshInFlightRef.current) {
			refreshPendingRef.current = true;
			return;
		}
		const refreshContextVersion = refreshContextVersionRef.current;
		refreshInFlightRef.current = true;
		setIsLoading(true);
		try {
			await fetchAndStoreChanges();
			while (
				refreshPendingRef.current &&
				refreshContextVersion === refreshContextVersionRef.current
			) {
				refreshPendingRef.current = false;
				await fetchAndStoreChanges();
			}
		} finally {
			if (refreshContextVersion !== refreshContextVersionRef.current) {
				return;
			}
			refreshInFlightRef.current = false;
			refreshPendingRef.current = false;
			setIsLoading(false);
		}
	}, [fetchAndStoreChanges, taskId, workspaceId]);

	useEffect(() => {
		refreshContextVersionRef.current += 1;
		refreshRequestIdRef.current += 1;
		refreshInFlightRef.current = false;
		refreshPendingRef.current = false;
		activeCacheKeyRef.current =
			taskId && workspaceId
				? buildWorkspaceChangesCacheKey({ taskId, workspaceId, baseRef })
				: null;
		const activeCacheKey = activeCacheKeyRef.current;
		const cached = activeCacheKey ? changesCacheRef.current.get(activeCacheKey) : null;
		if (cached && activeCacheKey) {
			changesCacheRef.current.delete(activeCacheKey);
			changesCacheRef.current.set(activeCacheKey, {
				changes: cached.changes,
				updatedAt: cached.updatedAt,
			});
			setChanges(cached.changes);
		} else {
			setChanges(null);
		}
		setIsLoading(false);
		if (!taskId || !workspaceId) {
			setIsRuntimeAvailable(workspaceId !== null);
			return;
		}
		setIsRuntimeAvailable(true);
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
