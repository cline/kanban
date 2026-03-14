import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import { LocalStorageKey } from "@/storage/local-storage-store";
import type { BoardData, TaskAutoReviewMode } from "@/types";

export const TASK_START_IN_PLAN_MODE_STORAGE_KEY = LocalStorageKey.TaskStartInPlanMode;
export const TASK_AUTO_REVIEW_ENABLED_STORAGE_KEY = LocalStorageKey.TaskAutoReviewEnabled;
export const TASK_AUTO_REVIEW_MODE_STORAGE_KEY = LocalStorageKey.TaskAutoReviewMode;

export function normalizeStoredTaskAutoReviewMode(value: string): TaskAutoReviewMode | null {
	if (value === "commit" || value === "pr" || value === "move_to_trash") {
		return value;
	}
	return null;
}

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
		reviewReason: null,
		exitCode: null,
		lastHookAt: null,
		latestHookActivity: null,
	};
}

export const filterTask = (query: string, task: SearchableTask): boolean => {
	const normalizedQuery = query.toLowerCase();
	return (
		task.title.toLowerCase().includes(normalizedQuery) || task.columnTitle.toLowerCase().includes(normalizedQuery)
	);
};

export const renderTask = (
	task: SearchableTask,
	{
		handleClick,
		handleFocus,
		modifiers,
	}: {
		handleClick: React.MouseEventHandler<HTMLElement>;
		handleFocus: () => void;
		modifiers: { matchesPredicate: boolean; active: boolean; disabled: boolean };
	},
): React.ReactElement | null => {
	if (!modifiers.matchesPredicate) {
		return null;
	}
	return (
		<button
			key={task.id}
			type="button"
			className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-[13px] text-text-primary rounded-md hover:bg-surface-3 text-left ${modifiers.active ? "bg-surface-3" : ""}`}
			disabled={modifiers.disabled}
			onClick={handleClick}
			onFocus={handleFocus}
			role="option"
		>
			<span className="flex-1 truncate">{task.title}</span>
			<span className="text-text-tertiary text-xs shrink-0">{task.columnTitle}</span>
		</button>
	);
};
