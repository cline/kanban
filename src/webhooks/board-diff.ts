// Pure function that diffs two board snapshots and produces webhook events.
// Used after saveState to detect task.created, task.moved, and task.completed events.
import { randomUUID } from "node:crypto";

import type { RuntimeBoardCard, RuntimeBoardColumnId, RuntimeBoardData, WebhookEvent } from "../core/api-contract.js";

interface CardLocation {
	card: RuntimeBoardCard;
	columnId: RuntimeBoardColumnId;
}

function indexCardsByColumn(board: RuntimeBoardData): Map<string, CardLocation> {
	const index = new Map<string, CardLocation>();
	for (const column of board.columns) {
		for (const card of column.cards) {
			index.set(card.id, { card, columnId: column.id as RuntimeBoardColumnId });
		}
	}
	return index;
}

export function diffBoard(
	oldBoard: RuntimeBoardData,
	newBoard: RuntimeBoardData,
	workspaceId: string,
	now?: number,
	generateId?: () => string,
): WebhookEvent[] {
	const timestamp = now ?? Date.now();
	const nextId = generateId ?? randomUUID;

	const oldIndex = indexCardsByColumn(oldBoard);
	const newIndex = indexCardsByColumn(newBoard);

	const events: WebhookEvent[] = [];

	for (const [cardId, newLocation] of newIndex) {
		const oldLocation = oldIndex.get(cardId);

		if (!oldLocation) {
			// Card is new — task.created
			events.push({
				id: nextId(),
				type: "task.created",
				timestamp,
				workspaceId,
				task: {
					id: cardId,
					title: newLocation.card.prompt,
					columnId: newLocation.columnId,
				},
			});
			continue;
		}

		if (oldLocation.columnId !== newLocation.columnId) {
			// Card moved between columns — task.moved (always emitted)
			events.push({
				id: nextId(),
				type: "task.moved",
				timestamp,
				workspaceId,
				task: {
					id: cardId,
					title: newLocation.card.prompt,
					columnId: newLocation.columnId,
					previousColumnId: oldLocation.columnId,
				},
			});

			// If destination is trash — also emit task.completed
			if (newLocation.columnId === "trash") {
				events.push({
					id: nextId(),
					type: "task.completed",
					timestamp,
					workspaceId,
					task: {
						id: cardId,
						title: newLocation.card.prompt,
						columnId: "trash",
						previousColumnId: oldLocation.columnId,
					},
				});
			}
		}
	}

	return events;
}
