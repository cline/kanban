import type { BoardCard, BoardColumn } from "@/kanban/types";

const cardKey = Symbol("card");

export type CardDragData = {
	[cardKey]: true;
	card: BoardCard;
	columnId: string;
	rect: DOMRect;
};

export function getCardData({
	card,
	columnId,
	rect,
}: Omit<CardDragData, typeof cardKey>): CardDragData {
	return {
		[cardKey]: true,
		card,
		columnId,
		rect,
	};
}

export function isCardData(value: Record<string | symbol, unknown>): value is CardDragData {
	return Boolean(value[cardKey]);
}

export function isDraggingCard({
	source,
}: {
	source: { data: Record<string | symbol, unknown> };
}): boolean {
	return isCardData(source.data);
}

const cardDropTargetKey = Symbol("card-drop-target");

export type CardDropTargetData = {
	[cardDropTargetKey]: true;
	card: BoardCard;
	columnId: string;
};

export function getCardDropTargetData({
	card,
	columnId,
}: Omit<CardDropTargetData, typeof cardDropTargetKey>): CardDropTargetData {
	return {
		[cardDropTargetKey]: true,
		card,
		columnId,
	};
}

export function isCardDropTargetData(
	value: Record<string | symbol, unknown>,
): value is CardDropTargetData {
	return Boolean(value[cardDropTargetKey]);
}

const columnKey = Symbol("column");

export type ColumnDragData = {
	[columnKey]: true;
	column: BoardColumn;
};

export function getColumnData({
	column,
}: Omit<ColumnDragData, typeof columnKey>): ColumnDragData {
	return {
		[columnKey]: true,
		column,
	};
}

export function isColumnData(value: Record<string | symbol, unknown>): value is ColumnDragData {
	return Boolean(value[columnKey]);
}

export function isDraggingColumn({
	source,
}: {
	source: { data: Record<string | symbol, unknown> };
}): boolean {
	return isColumnData(source.data);
}
