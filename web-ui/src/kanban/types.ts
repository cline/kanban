export type BoardColumnId = "backlog" | "todo" | "in_progress" | "ready_for_review" | "done";

export interface BoardCard {
	id: string;
	title: string;
	description: string;
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
