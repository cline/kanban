export interface BoardCard {
	id: string;
	title: string;
	body: string;
}

export interface BoardColumn {
	id: string;
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
