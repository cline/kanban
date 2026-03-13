import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { createInitialBoardData } from "@/data/board-data";
import type {
	RuntimeGitRepositoryInfo,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";
import { fetchWorkspaceState } from "@/runtime/workspace-state-query";
import { normalizeBoardData } from "@/state/board-state";
import type { BoardData } from "@/types";

interface UseWorkspaceSyncInput {
	currentProjectId: string | null;
	streamedWorkspaceState: RuntimeWorkspaceStateResponse | null;
	hasNoProjects: boolean;
	isDocumentVisible: boolean;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	setSessions: Dispatch<SetStateAction<Record<string, RuntimeTaskSessionSummary>>>;
	setCanPersistWorkspaceState: Dispatch<SetStateAction<boolean>>;
	onWorktreeError: (message: string | null) => void;
}

interface UseWorkspaceSyncResult {
	workspacePath: string | null;
	workspaceGit: RuntimeGitRepositoryInfo | null;
	workspaceRevision: number | null;
	setWorkspaceRevision: Dispatch<SetStateAction<number | null>>;
	workspaceHydrationNonce: number;
	isWorkspaceStateRefreshing: boolean;
	isWorkspaceMetadataPending: boolean;
	refreshWorkspaceState: () => Promise<void>;
	resetWorkspaceSyncState: () => void;
}

export function useWorkspaceSync({
	currentProjectId,
	streamedWorkspaceState,
	hasNoProjects,
	isDocumentVisible,
	setBoard,
	setSessions,
	setCanPersistWorkspaceState,
	onWorktreeError,
}: UseWorkspaceSyncInput): UseWorkspaceSyncResult {
	const [workspacePath, setWorkspacePath] = useState<string | null>(null);
	const [workspaceGit, setWorkspaceGit] = useState<RuntimeGitRepositoryInfo | null>(null);
	const [appliedWorkspaceProjectId, setAppliedWorkspaceProjectId] = useState<string | null>(null);
	const [workspaceRevision, setWorkspaceRevision] = useState<number | null>(null);
	const [workspaceHydrationNonce, setWorkspaceHydrationNonce] = useState(0);
	const [isWorkspaceStateRefreshing, setIsWorkspaceStateRefreshing] = useState(false);
	const workspaceVersionRef = useRef<{ projectId: string | null; revision: number | null }>({
		projectId: null,
		revision: null,
	});
	const workspaceRefreshRequestIdRef = useRef(0);

	const isWorkspaceMetadataPending = currentProjectId !== null && appliedWorkspaceProjectId !== currentProjectId;

	useEffect(() => {
		if (workspaceVersionRef.current.projectId !== currentProjectId) {
			return;
		}
		workspaceVersionRef.current = {
			projectId: currentProjectId,
			revision: workspaceRevision,
		};
	}, [currentProjectId, workspaceRevision]);

	const applyWorkspaceState = useCallback(
		(nextWorkspaceState: RuntimeWorkspaceStateResponse | null) => {
			if (!nextWorkspaceState) {
				setCanPersistWorkspaceState(false);
				setWorkspacePath(null);
				setWorkspaceGit(null);
				setAppliedWorkspaceProjectId(null);
				setBoard(createInitialBoardData());
				setSessions({});
				setWorkspaceRevision(null);
				workspaceVersionRef.current = {
					projectId: currentProjectId,
					revision: null,
				};
				return;
			}
			const currentVersion = workspaceVersionRef.current;
			const isSameProject = currentVersion.projectId === currentProjectId;
			const currentRevision = isSameProject ? currentVersion.revision : null;
			if (isSameProject && currentRevision !== null && nextWorkspaceState.revision < currentRevision) {
				return;
			}
			setWorkspacePath(nextWorkspaceState.repoPath);
			setWorkspaceGit(nextWorkspaceState.git);
			setSessions(nextWorkspaceState.sessions ?? {});
			const shouldHydrateBoard = !isSameProject || currentRevision !== nextWorkspaceState.revision;
			if (shouldHydrateBoard) {
				const normalized = normalizeBoardData(nextWorkspaceState.board) ?? createInitialBoardData();
				setBoard(normalized);
				setWorkspaceHydrationNonce((current) => current + 1);
			}
			setWorkspaceRevision(nextWorkspaceState.revision);
			workspaceVersionRef.current = {
				projectId: currentProjectId,
				revision: nextWorkspaceState.revision,
			};
			setAppliedWorkspaceProjectId(currentProjectId);
			setCanPersistWorkspaceState(true);
		},
		[currentProjectId, setBoard, setCanPersistWorkspaceState, setSessions],
	);

	const refreshWorkspaceState = useCallback(async () => {
		if (!currentProjectId) {
			return;
		}
		const requestId = workspaceRefreshRequestIdRef.current + 1;
		workspaceRefreshRequestIdRef.current = requestId;
		const requestedProjectId = currentProjectId;
		setIsWorkspaceStateRefreshing(true);
		try {
			const refreshed = await fetchWorkspaceState(requestedProjectId);
			if (
				workspaceRefreshRequestIdRef.current !== requestId ||
				workspaceVersionRef.current.projectId !== requestedProjectId
			) {
				return;
			}
			applyWorkspaceState(refreshed);
			onWorktreeError(null);
		} catch (error) {
			if (
				workspaceRefreshRequestIdRef.current !== requestId ||
				workspaceVersionRef.current.projectId !== requestedProjectId
			) {
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			onWorktreeError(message);
		} finally {
			if (workspaceRefreshRequestIdRef.current === requestId) {
				setIsWorkspaceStateRefreshing(false);
			}
		}
	}, [applyWorkspaceState, currentProjectId, onWorktreeError]);

	const resetWorkspaceSyncState = useCallback(() => {
		workspaceRefreshRequestIdRef.current += 1;
		setCanPersistWorkspaceState(false);
		setWorkspaceRevision(null);
		setIsWorkspaceStateRefreshing(false);
		setAppliedWorkspaceProjectId(null);
		workspaceVersionRef.current = {
			projectId: currentProjectId,
			revision: null,
		};
	}, [currentProjectId, setCanPersistWorkspaceState]);

	useEffect(() => {
		if (hasNoProjects) {
			applyWorkspaceState(null);
			return;
		}
		if (!streamedWorkspaceState) {
			return;
		}
		applyWorkspaceState(streamedWorkspaceState);
	}, [applyWorkspaceState, hasNoProjects, streamedWorkspaceState]);

	useEffect(() => {
		if (isDocumentVisible) {
			void refreshWorkspaceState();
		}
	}, [isDocumentVisible, refreshWorkspaceState]);

	return {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	};
}
