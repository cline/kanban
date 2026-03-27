// Hook for fetching the community prompts catalog, fuzzy-searching it,
// and applying/removing prompts to/from the current workspace.

import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimePromptItem, RuntimePromptType } from "@/runtime/types";

export type PromptTypeFilter = "all" | RuntimePromptType;

export interface UsePromptsLibraryResult {
	/** All prompts from the community catalog. */
	catalog: RuntimePromptItem[];
	/** Prompts filtered by search query and type filter. */
	filteredPrompts: RuntimePromptItem[];
	/** Whether the catalog is currently loading. */
	isLoading: boolean;
	/** Error message if catalog fetch failed. */
	errorMessage: string | null;
	/** Current search query. */
	searchQuery: string;
	/** Update the search query. */
	setSearchQuery: (query: string) => void;
	/** Current type filter. */
	typeFilter: PromptTypeFilter;
	/** Update the type filter. */
	setTypeFilter: (filter: PromptTypeFilter) => void;
	/** Set of prompt IDs that are applied to the workspace. */
	appliedPromptIds: Set<string>;
	/** Apply a prompt to the workspace. */
	applyPrompt: (prompt: RuntimePromptItem) => Promise<void>;
	/** Remove a prompt from the workspace. */
	removePrompt: (prompt: RuntimePromptItem) => Promise<void>;
	/** Whether any apply/remove operation is in progress. */
	isApplyingOrRemoving: boolean;
	/** Refresh the catalog from the server. */
	refresh: () => void;
	/** The currently expanded prompt (for viewing content). */
	expandedPromptId: string | null;
	/** Toggle expanded prompt. */
	toggleExpandedPrompt: (promptId: string) => void;
}

const FUSE_OPTIONS = {
	keys: [
		{ name: "name", weight: 0.4 },
		{ name: "description", weight: 0.3 },
		{ name: "tags", weight: 0.15 },
		{ name: "author", weight: 0.1 },
		{ name: "category", weight: 0.05 },
	],
	threshold: 0.4,
	includeScore: true,
	ignoreLocation: true,
	minMatchCharLength: 2,
};

export function usePromptsLibrary(workspaceId: string | null): UsePromptsLibraryResult {
	const [catalog, setCatalog] = useState<RuntimePromptItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [searchQuery, setSearchQuery] = useState("");
	const [typeFilter, setTypeFilter] = useState<PromptTypeFilter>("all");
	const [appliedPromptIds, setAppliedPromptIds] = useState<Set<string>>(new Set());
	const [isApplyingOrRemoving, setIsApplyingOrRemoving] = useState(false);
	const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);
	const fetchNonce = useRef(0);

	const fetchCatalog = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		const nonce = ++fetchNonce.current;
		setIsLoading(true);
		setErrorMessage(null);

		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const [catalogResult, appliedResult] = await Promise.all([
				client.prompts.getCatalog.query(),
				client.prompts.getAppliedPrompts.query(),
			]);

			if (nonce !== fetchNonce.current) {
				return;
			}

			setCatalog(catalogResult.items);
			setAppliedPromptIds(new Set(appliedResult.appliedPromptIds));
		} catch (error) {
			if (nonce !== fetchNonce.current) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			if (nonce === fetchNonce.current) {
				setIsLoading(false);
			}
		}
	}, [workspaceId]);

	useEffect(() => {
		void fetchCatalog();
	}, [fetchCatalog]);

	const refresh = useCallback(() => {
		void fetchCatalog();
	}, [fetchCatalog]);

	const fuse = useMemo(() => new Fuse(catalog, FUSE_OPTIONS), [catalog]);

	const filteredPrompts = useMemo(() => {
		let results: RuntimePromptItem[];

		if (searchQuery.trim().length >= 2) {
			results = fuse.search(searchQuery.trim()).map((result) => result.item);
		} else {
			results = catalog;
		}

		if (typeFilter !== "all") {
			results = results.filter((prompt) => prompt.type === typeFilter);
		}

		return results;
	}, [catalog, fuse, searchQuery, typeFilter]);

	const applyPrompt = useCallback(
		async (prompt: RuntimePromptItem) => {
			if (!workspaceId) {
				return;
			}
			setIsApplyingOrRemoving(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const result = await client.prompts.applyPrompt.mutate({
					promptId: prompt.promptId,
					type: prompt.type,
					content: prompt.content,
					name: prompt.name,
				});
				if (result.ok) {
					setAppliedPromptIds((prev) => {
						const next = new Set(prev);
						next.add(`${prompt.type}:${prompt.promptId}`);
						return next;
					});
					showAppToast(
						{ intent: "success", message: `Applied "${prompt.name}"`, timeout: 3000 },
						`prompt-applied-${prompt.promptId}`,
					);
				} else {
					showAppToast(
						{ intent: "danger", message: result.error ?? "Failed to apply prompt", timeout: 5000 },
						`prompt-apply-error-${prompt.promptId}`,
					);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{ intent: "danger", message, timeout: 5000 },
					`prompt-apply-error-${prompt.promptId}`,
				);
			} finally {
				setIsApplyingOrRemoving(false);
			}
		},
		[workspaceId],
	);

	const removePrompt = useCallback(
		async (prompt: RuntimePromptItem) => {
			if (!workspaceId) {
				return;
			}
			setIsApplyingOrRemoving(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const result = await client.prompts.removePrompt.mutate({
					promptId: prompt.promptId,
					type: prompt.type,
					name: prompt.name,
				});
				if (result.ok) {
					setAppliedPromptIds((prev) => {
						const next = new Set(prev);
						next.delete(`${prompt.type}:${prompt.promptId}`);
						return next;
					});
					showAppToast(
						{ intent: "success", message: `Removed "${prompt.name}"`, timeout: 3000 },
						`prompt-removed-${prompt.promptId}`,
					);
				} else {
					showAppToast(
						{ intent: "danger", message: result.error ?? "Failed to remove prompt", timeout: 5000 },
						`prompt-remove-error-${prompt.promptId}`,
					);
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				showAppToast(
					{ intent: "danger", message, timeout: 5000 },
					`prompt-remove-error-${prompt.promptId}`,
				);
			} finally {
				setIsApplyingOrRemoving(false);
			}
		},
		[workspaceId],
	);

	const toggleExpandedPrompt = useCallback((promptId: string) => {
		setExpandedPromptId((prev) => (prev === promptId ? null : promptId));
	}, []);

	return {
		catalog,
		filteredPrompts,
		isLoading,
		errorMessage,
		searchQuery,
		setSearchQuery,
		typeFilter,
		setTypeFilter,
		appliedPromptIds,
		applyPrompt,
		removePrompt,
		isApplyingOrRemoving,
		refresh,
		expandedPromptId,
		toggleExpandedPrompt,
	};
}
