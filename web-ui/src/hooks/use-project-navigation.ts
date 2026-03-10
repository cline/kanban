import { useCallback, useEffect, useState } from "react";

import { showAppToast } from "@/components/app-toaster";
import { useWindowEvent } from "@/utils/react-use";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useRuntimeStateStream } from "@/runtime/use-runtime-state-stream";
import { buildProjectPathname, parseProjectIdFromPathname } from "@/hooks/app-utils";

const REMOVED_PROJECT_ERROR_PREFIX = "Project no longer exists on disk and was removed:";

export function parseRemovedProjectPathFromStreamError(streamError: string | null): string | null {
	if (!streamError || !streamError.startsWith(REMOVED_PROJECT_ERROR_PREFIX)) {
		return null;
	}
	return streamError.slice(REMOVED_PROJECT_ERROR_PREFIX.length).trim();
}

interface UseProjectNavigationInput {
	onProjectSwitchStart: () => void;
	onProjectRemoveError: (message: string) => void;
}

export interface UseProjectNavigationResult {
	requestedProjectId: string | null;
	navigationCurrentProjectId: string | null;
	removingProjectId: string | null;
	currentProjectId: string | null;
	projects: ReturnType<typeof useRuntimeStateStream>["projects"];
	workspaceState: ReturnType<typeof useRuntimeStateStream>["workspaceState"];
	latestTaskReadyForReview: ReturnType<typeof useRuntimeStateStream>["latestTaskReadyForReview"];
	streamError: string | null;
	isRuntimeDisconnected: boolean;
	hasReceivedSnapshot: boolean;
	hasNoProjects: boolean;
	isProjectSwitching: boolean;
	handleSelectProject: (projectId: string) => void;
	handleAddProject: () => Promise<void>;
	handleRemoveProject: (projectId: string) => Promise<boolean>;
	resetProjectNavigationState: () => void;
}

export function useProjectNavigation({
	onProjectSwitchStart,
	onProjectRemoveError,
}: UseProjectNavigationInput): UseProjectNavigationResult {
	const [requestedProjectId, setRequestedProjectId] = useState<string | null>(() => {
		if (typeof window === "undefined") {
			return null;
		}
		return parseProjectIdFromPathname(window.location.pathname);
	});
	const [pendingAddedProjectId, setPendingAddedProjectId] = useState<string | null>(null);
	const [removingProjectId, setRemovingProjectId] = useState<string | null>(null);

	const {
		currentProjectId,
		projects,
		workspaceState,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
	} = useRuntimeStateStream(requestedProjectId);

	const hasNoProjects = hasReceivedSnapshot && projects.length === 0 && currentProjectId === null;
	const isProjectSwitching = requestedProjectId !== null && requestedProjectId !== currentProjectId && !hasNoProjects;
	const navigationCurrentProjectId = requestedProjectId ?? currentProjectId;

	const handleSelectProject = useCallback(
		(projectId: string) => {
			if (!projectId || projectId === currentProjectId) {
				return;
			}
			onProjectSwitchStart();
			setRequestedProjectId(projectId);
		},
		[currentProjectId, onProjectSwitchStart],
	);

	const handleAddProject = useCallback(async () => {
		try {
			const trpcClient = getRuntimeTrpcClient(currentProjectId);
			const picked = await trpcClient.projects.pickDirectory.mutate();
			if (!picked.ok || !picked.path) {
				if (picked?.error && picked.error !== "No directory was selected.") {
					throw new Error(picked.error);
				}
				return;
			}

			const added = await trpcClient.projects.add.mutate({ path: picked.path });
			if (!added.ok || !added.project) {
				throw new Error(added.error ?? "Could not add project.");
			}
			setPendingAddedProjectId(added.project.id);
			handleSelectProject(added.project.id);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			showAppToast({
				intent: "danger",
				icon: "warning-sign",
				message,
				timeout: 7000,
			});
		}
	}, [currentProjectId, handleSelectProject]);

	const handleRemoveProject = useCallback(
		async (projectId: string): Promise<boolean> => {
			if (removingProjectId) {
				return false;
			}
			setRemovingProjectId(projectId);
			try {
				const trpcClient = getRuntimeTrpcClient(currentProjectId);
				const payload = await trpcClient.projects.remove.mutate({ projectId });
				if (!payload.ok) {
					throw new Error(payload.error ?? "Could not remove project.");
				}
				if (currentProjectId === projectId) {
					onProjectSwitchStart();
					setRequestedProjectId(null);
				}
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				onProjectRemoveError(message);
				return false;
			} finally {
				setRemovingProjectId((current) => (current === projectId ? null : current));
			}
		},
		[currentProjectId, onProjectRemoveError, onProjectSwitchStart, removingProjectId],
	);

	const handlePopState = useCallback(() => {
		if (typeof window === "undefined") {
			return;
		}
		const nextProjectId = parseProjectIdFromPathname(window.location.pathname);
		setRequestedProjectId(nextProjectId);
	}, []);
	useWindowEvent("popstate", handlePopState);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!currentProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		const nextPathname = buildProjectPathname(currentProjectId);
		if (nextUrl.pathname === nextPathname) {
			return;
		}
		window.history.replaceState({}, "", `${nextPathname}${nextUrl.search}${nextUrl.hash}`);
	}, [currentProjectId]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		if (!hasNoProjects || !requestedProjectId) {
			return;
		}
		const nextUrl = new URL(window.location.href);
		if (nextUrl.pathname !== "/") {
			window.history.replaceState({}, "", `/${nextUrl.search}${nextUrl.hash}`);
		}
		setRequestedProjectId(null);
	}, [hasNoProjects, requestedProjectId]);

	useEffect(() => {
		if (!pendingAddedProjectId) {
			return;
		}
		const projectExists = projects.some((project) => project.id === pendingAddedProjectId);
		if (!projectExists && currentProjectId !== pendingAddedProjectId) {
			return;
		}
		setPendingAddedProjectId(null);
	}, [currentProjectId, pendingAddedProjectId, projects]);

	useEffect(() => {
		if (!requestedProjectId || !currentProjectId) {
			return;
		}
		if (pendingAddedProjectId && requestedProjectId === pendingAddedProjectId) {
			return;
		}
		const requestedStillExists = projects.some((project) => project.id === requestedProjectId);
		if (requestedStillExists) {
			return;
		}
		setRequestedProjectId(currentProjectId);
	}, [currentProjectId, pendingAddedProjectId, projects, requestedProjectId]);

	const resetProjectNavigationState = useCallback(() => {
		setRemovingProjectId(null);
	}, []);

	return {
		requestedProjectId,
		navigationCurrentProjectId,
		removingProjectId,
		currentProjectId,
		projects,
		workspaceState,
		latestTaskReadyForReview,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleRemoveProject,
		resetProjectNavigationState,
	};
}
