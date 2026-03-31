// Board visibility filtering.
//
// Rules:
//   - "shared" cards are visible to everyone.
//   - "private" cards are only visible to:
//       1. The card's creator (matched by CallerIdentity.uuid === card.createdBy.uuid)
//       2. Admins — any caller with isLocal === true (localhost users)
//   - Cards with no visibility set default to "shared".
//   - Cards with no createdBy are always visible (backwards compatibility).
//
// Filtering happens on the read path (getState, buildWorkspaceStateSnapshot,
// broadcast). The write path (saveState) enforces that only the owner or an
// admin can set or change a card's visibility.

import type { RuntimeBoardData } from "../core/api-contract";
import type { CallerIdentity } from "../remote/types";

// Returns true if the caller is permitted to see the given card.
function callerCanSeeCard(card: RuntimeBoardData["columns"][0]["cards"][0], caller: CallerIdentity | null): boolean {
	// Cards default to shared — visible to everyone.
	if (!card.visibility || card.visibility === "shared") return true;

	// Private card — no caller identity means no access.
	if (!caller) return false;

	// Localhost users are admins and see everything.
	if (caller.isLocal) return true;

	// The card's creator always sees their own private card.
	if (card.createdBy && card.createdBy.uuid === caller.uuid) return true;

	return false;
}

// Filters the board so the caller only sees cards they are permitted to see.
// Returns a new board object — the original is not mutated.
export function filterBoardForCaller(board: RuntimeBoardData, caller: CallerIdentity | null): RuntimeBoardData {
	// Admins (localhost) and unauthenticated local requests see the full board.
	if (!caller || caller.isLocal) return board;

	const filteredColumns = board.columns.map((col) => ({
		...col,
		cards: col.cards.filter((card) => callerCanSeeCard(card, caller)),
	}));

	// Only return a new object if something was actually filtered out.
	const unchanged = filteredColumns.every((col, i) => col.cards.length === board.columns[i]?.cards.length);
	if (unchanged) return board;

	return { ...board, columns: filteredColumns };
}

// Returns true if the caller is permitted to set the visibility field on a card.
// Rules:
//   - Admins (isLocal) can change visibility on any card.
//   - A non-admin can only change visibility on their own card.
//   - A non-admin cannot set visibility on a card they don't own.
export function callerCanSetVisibility(
	card: RuntimeBoardData["columns"][0]["cards"][0],
	caller: CallerIdentity | null,
): boolean {
	if (!caller) return false;
	if (caller.isLocal) return true;
	if (!card.createdBy) return false;
	return card.createdBy.uuid === caller.uuid;
}
