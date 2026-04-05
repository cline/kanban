import { useEffect, useState } from "react";
import { createInitialBoardData } from "@/data/board-data";
import type { RuntimeProjectSummary, RuntimeTaskSessionSummary, RuntimeWorkspaceStateResponse } from "@/runtime/types";
import { fetchWorkspaceState } from "@/runtime/workspace-state-query";
import type { BoardCard, BoardColumnId, BoardData } from "@/types";

export interface AllProjectsBoardSnapshot {
	board: BoardData;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
}

interface UseAllProjectsBoardResult extends AllProjectsBoardSnapshot {
	isLoading: boolean;
	error: string | null;
}

function toAggregatedCard(
	project: RuntimeProjectSummary,
	card: RuntimeWorkspaceStateResponse["board"]["columns"][number]["cards"][number],
): BoardCard {
	return {
		...card,
		id: `${project.id}:${card.id}`,
		projectId: project.id,
		projectName: project.name,
		projectTaskId: card.id,
	};
}

export function buildAllProjectsBoardSnapshot(
	projects: RuntimeProjectSummary[],
	workspaceStates: Record<string, RuntimeWorkspaceStateResponse>,
): AllProjectsBoardSnapshot {
	const initialBoard = createInitialBoardData();
	const columns = initialBoard.columns.map((column) => ({
		...column,
		cards: [] as BoardCard[],
	}));
	const columnById = new Map<BoardColumnId, (typeof columns)[number]>(columns.map((column) => [column.id, column]));
	const taskSessions: Record<string, RuntimeTaskSessionSummary> = {};

	for (const project of projects) {
		const workspaceState = workspaceStates[project.id];
		if (!workspaceState) {
			continue;
		}
		for (const column of workspaceState.board.columns) {
			const targetColumn = columnById.get(column.id);
			if (!targetColumn) {
				continue;
			}
			for (const card of column.cards) {
				const aggregatedCard = toAggregatedCard(project, card);
				targetColumn.cards.push(aggregatedCard);
				const sessionSummary = workspaceState.sessions[card.id];
				if (sessionSummary) {
					taskSessions[aggregatedCard.id] = {
						...sessionSummary,
						taskId: aggregatedCard.id,
					};
				}
			}
		}
	}

	for (const column of columns) {
		column.cards.sort((left, right) => right.updatedAt - left.updatedAt);
	}

	return {
		board: {
			columns,
			dependencies: [],
		},
		taskSessions,
	};
}

const EMPTY_SNAPSHOT: AllProjectsBoardSnapshot = {
	board: createInitialBoardData(),
	taskSessions: {},
};

export function useAllProjectsBoard(projects: RuntimeProjectSummary[], enabled: boolean): UseAllProjectsBoardResult {
	const [snapshot, setSnapshot] = useState<AllProjectsBoardSnapshot>(EMPTY_SNAPSHOT);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!enabled || projects.length === 0) {
			setSnapshot(EMPTY_SNAPSHOT);
			setIsLoading(false);
			setError(null);
			return;
		}

		let cancelled = false;
		setIsLoading(true);
		setError(null);

		void Promise.allSettled(
			projects.map(async (project) => ({
				project,
				workspaceState: await fetchWorkspaceState(project.id),
			})),
		).then((results) => {
			if (cancelled) {
				return;
			}

			const nextWorkspaceStates: Record<string, RuntimeWorkspaceStateResponse> = {};
			const failedProjects: string[] = [];
			for (const result of results) {
				if (result.status === "fulfilled") {
					nextWorkspaceStates[result.value.project.id] = result.value.workspaceState;
					continue;
				}
				const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
				failedProjects.push(message);
			}

			setSnapshot(buildAllProjectsBoardSnapshot(projects, nextWorkspaceStates));
			setError(
				failedProjects.length > 0
					? `Could not load ${failedProjects.length} project${failedProjects.length === 1 ? "" : "s"} for the all-projects view.`
					: null,
			);
			setIsLoading(false);
		});

		return () => {
			cancelled = true;
		};
	}, [enabled, projects]);

	return {
		board: snapshot.board,
		taskSessions: snapshot.taskSessions,
		isLoading,
		error,
	};
}
