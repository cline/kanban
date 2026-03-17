import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTaskEditor } from "@/hooks/use-task-editor";
import type { RuntimeAgentId } from "@/runtime/types";
import type { BoardCard, BoardData, TaskAutoReviewMode } from "@/types";

function createTask(taskId: string, prompt: string, createdAt: number, overrides: Partial<BoardCard> = {}): BoardCard {
	return {
		id: taskId,
		prompt,
		startInPlanMode: false,
		autoReviewEnabled: false,
		autoReviewMode: "commit",
		baseRef: "main",
		createdAt,
		updatedAt: createdAt,
		...overrides,
	};
}

function createBoard(task: BoardCard): BoardData {
	return {
		columns: [
			{ id: "backlog", title: "Backlog", cards: [task] },
			{ id: "in_progress", title: "In Progress", cards: [] },
			{ id: "review", title: "Review", cards: [] },
			{ id: "trash", title: "Trash", cards: [] },
		],
		dependencies: [],
	};
}

function resetStorage(): void {
	if (typeof localStorage.clear === "function") {
		localStorage.clear();
		return;
	}
	for (const key of Object.keys(localStorage)) {
		localStorage.removeItem?.(key);
	}
}

interface HookSnapshot {
	board: BoardData;
	editingTaskId: string | null;
	newTaskPrompt: string;
	editTaskPrompt: string;
	editTaskStartInPlanMode: boolean;
	editTaskAgentId: RuntimeAgentId | null;
	newTaskAgentId: RuntimeAgentId | null;
	isEditTaskStartInPlanModeDisabled: boolean;
	handleOpenCreateTask: () => void;
	handleCreateTask: () => string | null;
	handleOpenEditTask: (task: BoardCard) => void;
	handleSaveEditedTask: () => string | null;
	handleSaveAndStartEditedTask: () => void;
	setNewTaskPrompt: (value: string) => void;
	setNewTaskAgentId: (value: RuntimeAgentId | null) => void;
	setNewTaskBranchRef: (value: string) => void;
	setEditTaskPrompt: (value: string) => void;
	setEditTaskAgentId: (value: RuntimeAgentId | null) => void;
	setEditTaskAutoReviewEnabled: (value: boolean) => void;
	setEditTaskAutoReviewMode: (value: TaskAutoReviewMode) => void;
}

function requireSnapshot(snapshot: HookSnapshot | null): HookSnapshot {
	if (!snapshot) {
		throw new Error("Expected a hook snapshot.");
	}
	return snapshot;
}

function HookHarness({
	initialBoard,
	selectedAgentId,
	onSnapshot,
	queueTaskStartAfterEdit,
}: {
	initialBoard: BoardData;
	selectedAgentId: RuntimeAgentId | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
	queueTaskStartAfterEdit?: (taskId: string) => void;
}): null {
	const [board, setBoard] = useState<BoardData>(initialBoard);
	const [, setSelectedTaskId] = useState<string | null>(null);
	const editor = useTaskEditor({
		board,
		setBoard,
		currentProjectId: "project-1",
		createTaskBranchOptions: [{ value: "main", label: "main" }],
		defaultTaskBranchRef: "main",
		selectedAgentId,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
	});

	useEffect(() => {
		onSnapshot({
			board,
			editingTaskId: editor.editingTaskId,
			newTaskPrompt: editor.newTaskPrompt,
			editTaskPrompt: editor.editTaskPrompt,
			editTaskStartInPlanMode: editor.editTaskStartInPlanMode,
			editTaskAgentId: editor.editTaskAgentId,
			newTaskAgentId: editor.newTaskAgentId,
			isEditTaskStartInPlanModeDisabled: editor.isEditTaskStartInPlanModeDisabled,
			handleOpenCreateTask: editor.handleOpenCreateTask,
			handleCreateTask: editor.handleCreateTask,
			handleOpenEditTask: editor.handleOpenEditTask,
			handleSaveEditedTask: editor.handleSaveEditedTask,
			handleSaveAndStartEditedTask: editor.handleSaveAndStartEditedTask,
			setNewTaskPrompt: editor.setNewTaskPrompt,
			setNewTaskAgentId: editor.setNewTaskAgentId,
			setNewTaskBranchRef: editor.setNewTaskBranchRef,
			setEditTaskPrompt: editor.setEditTaskPrompt,
			setEditTaskAgentId: editor.setEditTaskAgentId,
			setEditTaskAutoReviewEnabled: editor.setEditTaskAutoReviewEnabled,
			setEditTaskAutoReviewMode: editor.setEditTaskAutoReviewMode,
		});
	}, [
		board,
		editor.editTaskAgentId,
		editor.editTaskPrompt,
		editor.editTaskStartInPlanMode,
		editor.editingTaskId,
		editor.handleCreateTask,
		editor.handleOpenCreateTask,
		editor.handleOpenEditTask,
		editor.handleSaveEditedTask,
		editor.handleSaveAndStartEditedTask,
		editor.isEditTaskStartInPlanModeDisabled,
		editor.newTaskAgentId,
		editor.newTaskPrompt,
		editor.setEditTaskAgentId,
		editor.setEditTaskAutoReviewEnabled,
		editor.setEditTaskAutoReviewMode,
		editor.setEditTaskPrompt,
		editor.setNewTaskAgentId,
		editor.setNewTaskBranchRef,
		editor.setNewTaskPrompt,
		onSnapshot,
	]);

	return null;
}

describe("useTaskEditor", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		resetStorage();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
		resetStorage();
	});

	it("defaults new tasks to the selected global agent and persists it", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard(createTask("task-1", "Initial prompt", 1));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="codex"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});

		expect(requireSnapshot(latestSnapshot).newTaskAgentId).toBe("codex");

		await act(async () => {
			const snapshot = requireSnapshot(latestSnapshot);
			snapshot.setNewTaskPrompt("New task");
			snapshot.setNewTaskBranchRef("main");
		});

		expect(requireSnapshot(latestSnapshot).newTaskPrompt).toBe("New task");

		await act(async () => {
			requireSnapshot(latestSnapshot).handleCreateTask();
		});

		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.prompt).toBe("New task");
		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.agentId).toBe("codex");
	});

	it("backfills the create agent from global settings without overwriting a manual choice", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard(createTask("task-1", "Initial prompt", 1));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenCreateTask();
		});

		expect(requireSnapshot(latestSnapshot).newTaskAgentId).toBeNull();

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="gemini"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).newTaskAgentId).toBe("gemini");

		await act(async () => {
			requireSnapshot(latestSnapshot).setNewTaskAgentId("codex");
		});

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="claude"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).newTaskAgentId).toBe("codex");
	});

	it("prefers the task agent when opening an edit", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard(createTask("task-1", "Initial prompt", 1, { agentId: "codex" }));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="claude"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		expect(requireSnapshot(latestSnapshot).editTaskAgentId).toBe("codex");
	});

	it("falls back to the selected global agent for legacy tasks and saves it", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard(createTask("task-1", "Initial prompt", 1));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="gemini"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		expect(requireSnapshot(latestSnapshot).editTaskAgentId).toBe("gemini");

		await act(async () => {
			requireSnapshot(latestSnapshot).setEditTaskPrompt("Updated prompt");
		});

		let savedTaskId: string | null = null;
		await act(async () => {
			savedTaskId = requireSnapshot(latestSnapshot).handleSaveEditedTask();
		});

		expect(savedTaskId).toBe("task-1");
		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.agentId).toBe("gemini");
	});

	it("backfills the edit agent from global settings without overwriting a manual choice", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard(createTask("task-1", "Initial prompt", 1));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		expect(requireSnapshot(latestSnapshot).editTaskAgentId).toBeNull();

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="gemini"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).editTaskAgentId).toBe("gemini");

		await act(async () => {
			requireSnapshot(latestSnapshot).setEditTaskAgentId("codex");
		});

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId="claude"
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		expect(requireSnapshot(latestSnapshot).editTaskAgentId).toBe("codex");
	});

	it("disables start in plan mode when move to trash auto review is selected while editing", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const initialBoard = createBoard(
			createTask("task-1", "Initial prompt", 1, {
				startInPlanMode: true,
			}),
		);

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId={null}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setEditTaskAutoReviewEnabled(true);
			requireSnapshot(latestSnapshot).setEditTaskAutoReviewMode("move_to_trash");
		});

		expect(requireSnapshot(latestSnapshot).isEditTaskStartInPlanModeDisabled).toBe(true);
		expect(requireSnapshot(latestSnapshot).editTaskStartInPlanMode).toBe(false);
	});

	it("queues the saved task id when saving and starting an edited task", async () => {
		let latestSnapshot: HookSnapshot | null = null;
		const queueTaskStartAfterEdit = vi.fn();
		const initialBoard = createBoard(createTask("task-1", "Initial prompt", 1));

		await act(async () => {
			root.render(
				<HookHarness
					initialBoard={initialBoard}
					selectedAgentId={null}
					queueTaskStartAfterEdit={queueTaskStartAfterEdit}
					onSnapshot={(snapshot) => {
						latestSnapshot = snapshot;
					}}
				/>,
			);
		});

		const task = requireSnapshot(latestSnapshot).board.columns[0]?.cards[0];
		if (!task) {
			throw new Error("Expected a backlog task.");
		}

		await act(async () => {
			requireSnapshot(latestSnapshot).handleOpenEditTask(task);
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).setEditTaskPrompt("Updated prompt");
		});

		await act(async () => {
			requireSnapshot(latestSnapshot).handleSaveAndStartEditedTask();
		});

		expect(queueTaskStartAfterEdit).toHaveBeenCalledWith("task-1");
		expect(requireSnapshot(latestSnapshot).board.columns[0]?.cards[0]?.prompt).toBe("Updated prompt");
	});
});
