import type { TranslationKey } from "@/i18n/translations";
import type { BoardColumnId } from "@/types";

const BOARD_COLUMN_TITLE_KEYS = {
	backlog: "board.column.backlog",
	in_progress: "board.column.inProgress",
	review: "board.column.review",
	trash: "board.column.done",
} satisfies Record<BoardColumnId, TranslationKey>;

export function getBoardColumnTitleKey(columnId: BoardColumnId): TranslationKey {
	return BOARD_COLUMN_TITLE_KEYS[columnId];
}
