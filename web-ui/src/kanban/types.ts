export type BoardColumnId = "backlog" | "in_progress" | "review" | "trash";

export interface BoardCard {
	id: string;
	title: string;
	description: string;
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

export interface CardSelection {
	card: BoardCard;
	column: BoardColumn;
	allColumns: BoardColumn[];
}
