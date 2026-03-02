import { MenuItem } from "@blueprintjs/core";
import type { ItemRenderer } from "@blueprintjs/select";

import type { RuntimeTaskSessionSummary } from "@/kanban/runtime/types";
import type { BoardData } from "@/kanban/types";

export const TASK_START_IN_PLAN_MODE_STORAGE_KEY = "kanbanana.task-start-in-plan-mode";

export interface SearchableTask {
	id: string;
	title: string;
	columnTitle: string;
}

export function countTasksByColumn(board: BoardData): {
	backlog: number;
	in_progress: number;
	review: number;
	trash: number;
} {
	const counts = {
		backlog: 0,
		in_progress: 0,
		review: 0,
		trash: 0,
	};
	for (const column of board.columns) {
		if (column.id === "backlog") {
			counts.backlog += column.cards.length;
			continue;
		}
		if (column.id === "in_progress") {
			counts.in_progress += column.cards.length;
			continue;
		}
		if (column.id === "review") {
			counts.review += column.cards.length;
			continue;
		}
		if (column.id === "trash") {
			counts.trash += column.cards.length;
		}
	}
	return counts;
}

export function parseProjectIdFromPathname(pathname: string): string | null {
	const segments = pathname.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return null;
	}
	const firstSegment = segments[0];
	if (!firstSegment) {
		return null;
	}
	try {
		return decodeURIComponent(firstSegment);
	} catch {
		return null;
	}
}

export function buildProjectPathname(projectId: string): string {
	return `/${encodeURIComponent(projectId)}`;
}

export function createIdleTaskSession(taskId: string): RuntimeTaskSessionSummary {
	return {
		taskId,
		state: "idle",
		agentId: null,
		workspacePath: null,
		pid: null,
		startedAt: null,
		updatedAt: Date.now(),
		lastOutputAt: null,
		lastActivityLine: null,
		reviewReason: null,
		exitCode: null,
	};
}

export const filterTask = (query: string, task: SearchableTask): boolean => {
	const normalizedQuery = query.toLowerCase();
	return task.title.toLowerCase().includes(normalizedQuery) ||
		task.columnTitle.toLowerCase().includes(normalizedQuery);
};

export const renderTask: ItemRenderer<SearchableTask> = (task, { handleClick, handleFocus, modifiers }) => {
	if (!modifiers.matchesPredicate) {
		return null;
	}
	return (
		<MenuItem
			key={task.id}
			active={modifiers.active}
			disabled={modifiers.disabled}
			label={task.columnTitle}
			text={task.title}
			onClick={handleClick}
			onFocus={handleFocus}
			roleStructure="listoption"
		/>
	);
};
