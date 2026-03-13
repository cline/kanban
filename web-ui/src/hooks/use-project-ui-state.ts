import type { ComponentProps } from "react";
import { useMemo } from "react";
import type { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { countTasksByColumn } from "@/hooks/app-utils";
import type { BoardData } from "@/types";

type ProjectSummaries = ComponentProps<typeof ProjectNavigationPanel>["projects"];

interface UseProjectUiStateInput {
	board: BoardData;
	canPersistWorkspaceState: boolean;
	currentProjectId: string | null;
	projects: ProjectSummaries;
	navigationCurrentProjectId: string | null;
	selectedTaskId: string | null;
	streamError: string | null;
	isProjectSwitching: boolean;
	isInitialRuntimeLoad: boolean;
	isAwaitingWorkspaceSnapshot: boolean;
	isWorkspaceMetadataPending: boolean;
	hasReceivedSnapshot: boolean;
}

interface UseProjectUiStateResult {
	displayedProjects: ProjectSummaries;
	navigationProjectPath: string | null;
	shouldShowProjectLoadingState: boolean;
	isProjectListLoading: boolean;
	shouldUseNavigationPath: boolean;
}

export function useProjectUiState({
	board,
	canPersistWorkspaceState,
	currentProjectId,
	projects,
	navigationCurrentProjectId,
	selectedTaskId,
	streamError,
	isProjectSwitching,
	isInitialRuntimeLoad,
	isAwaitingWorkspaceSnapshot,
	isWorkspaceMetadataPending,
	hasReceivedSnapshot,
}: UseProjectUiStateInput): UseProjectUiStateResult {
	const displayedProjects = useMemo(() => {
		if (!canPersistWorkspaceState || !currentProjectId) {
			return projects;
		}
		const localCounts = countTasksByColumn(board);
		return projects.map((project) =>
			project.id === currentProjectId
				? {
						...project,
						taskCounts: localCounts,
					}
				: project,
		);
	}, [board, canPersistWorkspaceState, currentProjectId, projects]);

	const navigationProjectPath = useMemo(() => {
		if (!navigationCurrentProjectId) {
			return null;
		}
		return projects.find((project) => project.id === navigationCurrentProjectId)?.path ?? null;
	}, [navigationCurrentProjectId, projects]);

	const shouldShowProjectLoadingState =
		selectedTaskId === null &&
		!streamError &&
		(isProjectSwitching || isInitialRuntimeLoad || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);
	const isProjectListLoading = !hasReceivedSnapshot && !streamError;
	const shouldUseNavigationPath = isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending;

	return {
		displayedProjects,
		navigationProjectPath,
		shouldShowProjectLoadingState,
		isProjectListLoading,
		shouldUseNavigationPath,
	};
}
