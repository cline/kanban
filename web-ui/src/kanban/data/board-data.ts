import type { BoardCard, BoardColumn, BoardColumnId, BoardData } from "@/kanban/types";

const columnOrder: Array<{ id: BoardColumnId; title: string }> = [
	{ id: "backlog", title: "Backlog" },
	{ id: "todo", title: "To Do" },
	{ id: "in_progress", title: "In Progress" },
	{ id: "ready_for_review", title: "Ready for Review" },
	{ id: "done", title: "Done" },
];

function createSeedCard(id: string, title: string, description: string): BoardCard {
	const now = Date.now();
	return {
		id,
		title,
		description,
		createdAt: now,
		updatedAt: now,
	};
}

function createEmptyColumn(id: BoardColumnId, title: string): BoardColumn {
	return {
		id,
		title,
		cards: [],
	};
}

export function createInitialBoardData(): BoardData {
	const columns = columnOrder.map((column) => createEmptyColumn(column.id, column.title));

	const backlog = columns.find((column) => column.id === "backlog");
	const todo = columns.find((column) => column.id === "todo");
	const inProgress = columns.find((column) => column.id === "in_progress");
	const review = columns.find((column) => column.id === "ready_for_review");
	const done = columns.find((column) => column.id === "done");

	if (backlog) {
		backlog.cards.push(
			createSeedCard(
				"task-backlog-1",
				"Wire ACP task runs into board lifecycle",
				"Move a card into In Progress and start a task-scoped agent session automatically.",
			),
			createSeedCard(
				"task-backlog-2",
				"Implement file and diff panels",
				"Show changed files and patch-style diffs tied to a specific task session.",
			),
		);
	}

	if (todo) {
		todo.cards.push(
			createSeedCard(
				"task-todo-1",
				"Persist board and chat sessions",
				"Store board state and task chat timelines in local storage so restarts keep context.",
			),
		);
	}

	if (inProgress) {
		inProgress.cards.push(
			createSeedCard(
				"task-progress-1",
				"Ship functional Kanbanana MVP",
				"Focus on task creation, moving columns, task chat, and usable diff review.",
			),
		);
	}

	if (review) {
		review.cards.push(
			createSeedCard(
				"task-review-1",
				"Validate drag/drop and review workflow",
				"Ensure run completion moves cards to Ready for Review and manual move controls cleanup.",
			),
		);
	}

	if (done) {
		done.cards.push(
			createSeedCard(
				"task-done-1",
				"Bootstrap React + Tailwind shell",
				"Initial board UI scaffold is running inside the web app package.",
			),
		);
	}

	return { columns };
}
