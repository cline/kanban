import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GitCommitDiffSource } from "@/components/git-history/git-commit-diff-panel";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeGitCommit,
	RuntimeGitCommitDiffResponse,
	RuntimeGitRef,
	RuntimeGitRefsResponse,
	RuntimeGitSyncSummary,
	RuntimeWorkspaceChangesResponse,
} from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

export type GitHistoryViewMode = "working-copy" | "commit";

const INITIAL_COMMIT_PAGE_SIZE = 150;
const COMMIT_PAGE_SIZE = 150;

interface GitHistoryTaskScope {
	taskId: string;
	baseRef: string;
}

interface UseGitHistoryDataOptions {
	workspaceId: string | null;
	taskScope?: GitHistoryTaskScope | null;
	gitSummary: RuntimeGitSyncSummary | null;
	enabled?: boolean;
}

interface GitHistoryRefreshOptions {
	background?: boolean;
}

export interface UseGitHistoryDataResult {
	viewMode: GitHistoryViewMode;
	refs: RuntimeGitRef[];
	activeRef: RuntimeGitRef | null;
	refsErrorMessage: string | null;
	isRefsLoading: boolean;
	workingCopyFileCount: number;
	hasWorkingCopy: boolean;
	commits: RuntimeGitCommit[];
	totalCommitCount: number;
	selectedCommitHash: string | null;
	selectedCommit: RuntimeGitCommit | null;
	isLogLoading: boolean;
	isLoadingMoreCommits: boolean;
	logErrorMessage: string | null;
	diffSource: GitCommitDiffSource | null;
	isDiffLoading: boolean;
	diffErrorMessage: string | null;
	selectedDiffPath: string | null;
	selectWorkingCopy: () => void;
	selectRef: (ref: RuntimeGitRef) => void;
	selectCommit: (commit: RuntimeGitCommit) => void;
	selectDiffPath: (path: string | null) => void;
	loadMoreCommits: () => void;
	refresh: (options?: GitHistoryRefreshOptions) => void;
}

export function useGitHistoryData({
	workspaceId,
	taskScope,
	gitSummary,
	enabled = true,
}: UseGitHistoryDataOptions): UseGitHistoryDataResult {
	const [viewMode, setViewMode] = useState<GitHistoryViewMode>("commit");
	const [selectedRefName, setSelectedRefName] = useState<string | null>(null);
	const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
	const [selectedDiffPath, setSelectedDiffPath] = useState<string | null>(null);
	const [commits, setCommits] = useState<RuntimeGitCommit[]>([]);
	const [totalCommitCount, setTotalCommitCount] = useState(0);
	const [isLogLoading, setIsLogLoading] = useState(false);
	const [isLoadingMoreCommits, setIsLoadingMoreCommits] = useState(false);
	const [logErrorMessage, setLogErrorMessage] = useState<string | null>(null);
	// Commit log requests can overlap when users switch refs quickly or trigger refresh/load-more.
	// We cancel older in-flight requests so stale responses cannot overwrite state from newer requests.
	const logAbortControllerRef = useRef<AbortController | null>(null);

	const abortInFlightLogRequest = useCallback(() => {
		logAbortControllerRef.current?.abort();
		logAbortControllerRef.current = null;
	}, []);

	const isAbortError = useCallback((error: unknown): boolean => {
		if (!(error instanceof Error)) {
			return false;
		}
		const name = error.name.toLowerCase();
		const message = error.message.toLowerCase();
		return name === "aborterror" || message.includes("aborted") || message.includes("aborterror");
	}, []);

	const refsQueryFn = useCallback(async () => {
		if (!workspaceId) {
			throw new Error("Missing workspace.");
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		const payload = await trpc.workspace.getGitRefs.query(taskScope ?? null);
		if (!payload.ok) {
			throw new Error(payload.error ?? "Could not load git refs.");
		}
		return payload;
	}, [taskScope, workspaceId]);

	const refsQuery = useTrpcQuery<RuntimeGitRefsResponse>({
		enabled: enabled && workspaceId !== null,
		queryFn: refsQueryFn,
		retainDataOnError: true,
	});

	const scopeKey = `${workspaceId ?? "__none__"}:${taskScope?.taskId ?? "__home__"}:${taskScope?.baseRef ?? "__home__"}`;
	const prevScopeKeyRef = useRef(scopeKey);
	useEffect(() => {
		if (scopeKey === prevScopeKeyRef.current) {
			return;
		}
		prevScopeKeyRef.current = scopeKey;
		setViewMode("commit");
		setSelectedRefName(null);
		setSelectedCommitHash(null);
		setSelectedDiffPath(null);
		refsQuery.setData(null);
	}, [scopeKey, refsQuery.setData]);

	const prevBranchRef = useRef(gitSummary?.currentBranch ?? null);
	useEffect(() => {
		const current = gitSummary?.currentBranch ?? null;
		if (current !== prevBranchRef.current) {
			prevBranchRef.current = current;
			setSelectedRefName(null);
			setSelectedCommitHash(null);
			if (enabled) {
				void refsQuery.refetch();
			}
		}
	}, [enabled, gitSummary?.currentBranch, refsQuery.refetch]);

	const refs = refsQuery.data?.refs ?? [];
	const refsErrorMessage =
		refsQuery.isError && refs.length === 0 ? (refsQuery.error?.message ?? "Could not load git refs.") : null;
	const headRef = refs.find((ref) => ref.isHead);

	const activeRef = useMemo(() => {
		if (selectedRefName) {
			return refs.find((ref) => ref.name === selectedRefName) ?? headRef ?? null;
		}
		return headRef ?? null;
	}, [headRef, refs, selectedRefName]);

	const logRef = activeRef?.type === "detached" ? activeRef.hash : (activeRef?.name ?? null);

	const loadCommits = useCallback(
		async (options: { skip: number; maxCount: number; append: boolean; silent?: boolean }) => {
			if (!enabled || !workspaceId || !logRef) {
				abortInFlightLogRequest();
				setCommits([]);
				setTotalCommitCount(0);
				setLogErrorMessage(null);
				setIsLogLoading(false);
				setIsLoadingMoreCommits(false);
				return;
			}

			abortInFlightLogRequest();
			const abortController = new AbortController();
			logAbortControllerRef.current = abortController;
			if (options.append) {
				setIsLoadingMoreCommits(true);
			} else {
				if (!options.silent) {
					setIsLogLoading(true);
					setLogErrorMessage(null);
				} else {
					setIsLogLoading(false);
				}
			}

			try {
				const trpc = getRuntimeTrpcClient(workspaceId);
				const payload = await trpc.workspace.getGitLog.query(
					{
						ref: logRef,
						maxCount: options.maxCount,
						skip: options.skip,
						taskScope: taskScope ?? null,
					},
					{
						signal: abortController.signal,
					},
				);
				if (abortController.signal.aborted || logAbortControllerRef.current !== abortController) {
					return;
				}
				if (!payload.ok) {
					if (options.silent) {
						return;
					}
					if (!options.append) {
						setCommits([]);
						setTotalCommitCount(0);
					}
					setLogErrorMessage(payload.error ?? "Could not load commits.");
					return;
				}

				setLogErrorMessage(null);
				setTotalCommitCount(payload.totalCount);
				setCommits((current) => {
					if (!options.append) {
						return payload.commits;
					}
					const existingHashes = new Set(current.map((commit) => commit.hash));
					const nextCommits = payload.commits.filter((commit) => !existingHashes.has(commit.hash));
					return [...current, ...nextCommits];
				});
			} catch (error) {
				if (abortController.signal.aborted || logAbortControllerRef.current !== abortController) {
					return;
				}
				if (isAbortError(error)) {
					return;
				}
				if (options.silent) {
					return;
				}
				const message = error instanceof Error ? error.message : String(error);
				if (!options.append) {
					setCommits([]);
					setTotalCommitCount(0);
				}
				setLogErrorMessage(message || "Could not load commits.");
			} finally {
				if (logAbortControllerRef.current === abortController) {
					logAbortControllerRef.current = null;
					if (options.append) {
						setIsLoadingMoreCommits(false);
					} else {
						setIsLogLoading(false);
					}
				}
			}
		},
		[abortInFlightLogRequest, enabled, isAbortError, logRef, taskScope, workspaceId],
	);

	useEffect(() => {
		abortInFlightLogRequest();
		setCommits([]);
		setTotalCommitCount(0);
		setIsLogLoading(false);
		setIsLoadingMoreCommits(false);
		setLogErrorMessage(null);
		if (!enabled || !workspaceId || !logRef) {
			return;
		}
		void loadCommits({
			skip: 0,
			maxCount: INITIAL_COMMIT_PAGE_SIZE,
			append: false,
		});
	}, [abortInFlightLogRequest, enabled, loadCommits, logRef, workspaceId]);

	useEffect(() => {
		return () => {
			abortInFlightLogRequest();
		};
	}, [abortInFlightLogRequest]);

	const loadMoreCommits = useCallback(() => {
		if (!enabled || !workspaceId || !logRef || isLogLoading || isLoadingMoreCommits) {
			return;
		}
		if (commits.length >= totalCommitCount) {
			return;
		}
		void loadCommits({
			skip: commits.length,
			maxCount: COMMIT_PAGE_SIZE,
			append: true,
		});
	}, [
		commits.length,
		enabled,
		isLoadingMoreCommits,
		isLogLoading,
		loadCommits,
		logRef,
		totalCommitCount,
		workspaceId,
	]);

	const refreshCommits = useCallback(
		(options?: { silent?: boolean }) => {
			if (!enabled || !workspaceId || !logRef) {
				return;
			}
			void loadCommits({
				skip: 0,
				maxCount: Math.max(commits.length, INITIAL_COMMIT_PAGE_SIZE),
				append: false,
				silent: options?.silent ?? false,
			});
		},
		[commits.length, enabled, loadCommits, logRef, workspaceId],
	);

	const resolvedLogErrorMessage = refsErrorMessage ?? logErrorMessage;

	useEffect(() => {
		if (viewMode === "working-copy") {
			return;
		}
		if (selectedCommitHash && commits.some((commit) => commit.hash === selectedCommitHash)) {
			return;
		}
		const firstCommit = commits[0];
		setSelectedCommitHash(firstCommit?.hash ?? null);
		setSelectedDiffPath(null);
	}, [commits, selectedCommitHash, viewMode]);

	const diffQueryFn = useCallback(async () => {
		if (!workspaceId || !selectedCommitHash) {
			throw new Error("Missing scope.");
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		return await trpc.workspace.getCommitDiff.query({
			commitHash: selectedCommitHash,
			taskScope: taskScope ?? null,
		});
	}, [selectedCommitHash, taskScope, workspaceId]);

	const diffQuery = useTrpcQuery<RuntimeGitCommitDiffResponse>({
		enabled: enabled && workspaceId !== null && selectedCommitHash !== null && viewMode === "commit",
		queryFn: diffQueryFn,
	});

	const workingCopyFileCount = gitSummary?.changedFiles ?? 0;
	const hasWorkingCopy = workingCopyFileCount > 0;

	const workingCopyQueryFn = useCallback(async () => {
		if (!workspaceId) {
			throw new Error("Missing workspace.");
		}
		const trpc = getRuntimeTrpcClient(workspaceId);
		if (taskScope) {
			return await trpc.workspace.getChanges.query(taskScope);
		}
		return await trpc.workspace.getWorkspaceChanges.query();
	}, [taskScope, workspaceId]);

	const workingCopyQuery = useTrpcQuery<RuntimeWorkspaceChangesResponse>({
		enabled: enabled && workspaceId !== null && hasWorkingCopy,
		queryFn: workingCopyQueryFn,
		retainDataOnError: true,
	});

	const selectWorkingCopy = useCallback(() => {
		setViewMode("working-copy");
		setSelectedRefName(null);
		setSelectedCommitHash(null);
		setSelectedDiffPath(null);
	}, []);

	const selectRef = useCallback((ref: RuntimeGitRef) => {
		setSelectedRefName(ref.name);
		setViewMode("commit");
		setSelectedCommitHash(null);
		setSelectedDiffPath(null);
	}, []);

	const selectCommit = useCallback((commit: RuntimeGitCommit) => {
		setViewMode("commit");
		setSelectedCommitHash(commit.hash);
		setSelectedDiffPath(null);
	}, []);

	const diffSource = useMemo((): GitCommitDiffSource | null => {
		if (viewMode === "working-copy") {
			const files = workingCopyQuery.data?.files;
			if (!files) {
				return null;
			}
			return { type: "working-copy", files };
		}
		const commitFiles = diffQuery.data?.files;
		if (!commitFiles) {
			return null;
		}
		return { type: "commit", files: commitFiles };
	}, [diffQuery.data?.files, viewMode, workingCopyQuery.data?.files]);

	const selectedCommit = commits.find((commit) => commit.hash === selectedCommitHash) ?? null;
	const isDiffLoading =
		viewMode === "commit"
			? isLogLoading || diffQuery.isLoading
			: workingCopyQuery.isLoading && !workingCopyQuery.data;
	const diffErrorMessage =
		viewMode === "commit"
			? (resolvedLogErrorMessage ??
				(diffQuery.isError
					? (diffQuery.error?.message ?? "Could not load diff.")
					: diffQuery.data && !diffQuery.data.ok
						? (diffQuery.data.error ?? "Could not load diff.")
						: null))
			: workingCopyQuery.isError && !workingCopyQuery.data
				? (workingCopyQuery.error?.message ?? "Could not load working copy changes.")
				: null;

	useEffect(() => {
		if (!hasWorkingCopy && viewMode === "working-copy") {
			setViewMode("commit");
			setSelectedDiffPath(null);
		}
	}, [hasWorkingCopy, viewMode]);

	const refresh = useCallback(
		(options?: GitHistoryRefreshOptions) => {
			if (!enabled) {
				return;
			}
			const isBackgroundRefresh = options?.background === true;
			if (isBackgroundRefresh) {
				if (!refsQuery.isLoading) {
					void refsQuery.refetch();
				}
				if (!isLogLoading && !isLoadingMoreCommits) {
					refreshCommits({
						silent: true,
					});
				}
				if (hasWorkingCopy && !workingCopyQuery.isLoading) {
					void workingCopyQuery.refetch();
				}
				return;
			}

			void refsQuery.refetch();
			refreshCommits({
				silent: false,
			});
			if (hasWorkingCopy) {
				void workingCopyQuery.refetch();
			}
		},
		[
			enabled,
			hasWorkingCopy,
			isLoadingMoreCommits,
			isLogLoading,
			refsQuery,
			refsQueryFn,
			refreshCommits,
			workingCopyQuery,
			workingCopyQueryFn,
		],
	);

	return {
		viewMode,
		refs,
		activeRef,
		refsErrorMessage,
		isRefsLoading: refsQuery.isLoading && refs.length === 0,
		workingCopyFileCount,
		hasWorkingCopy,
		commits,
		totalCommitCount,
		selectedCommitHash,
		selectedCommit,
		isLogLoading,
		isLoadingMoreCommits,
		logErrorMessage: resolvedLogErrorMessage,
		diffSource,
		isDiffLoading,
		diffErrorMessage,
		selectedDiffPath,
		selectWorkingCopy,
		selectRef,
		selectCommit,
		selectDiffPath: setSelectedDiffPath,
		loadMoreCommits,
		refresh,
	};
}
