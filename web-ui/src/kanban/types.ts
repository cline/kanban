export type BoardColumnId = "backlog" | "in_progress" | "review" | "trash";

export interface BoardCard {
	id: string;
	title: string;
	description: string;
	prompt: string;
	startInPlanMode: boolean;
	baseRef?: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface BoardColumn {
	id: BoardColumnId;
	title: string;
	cards: BoardCard[];
}

export interface BoardData {
	columns: BoardColumn[];
}

export interface ReviewTaskWorkspaceSnapshot {
	taskId: string;
	mode: "local" | "worktree";
	path: string;
	hasGit: boolean;
	branch: string | null;
	isDetached: boolean;
	headCommit: string | null;
	changedFiles: number | null;
	additions: number | null;
	deletions: number | null;
}

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
