import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
	normalizeStoredTaskAutoReviewMode,
	TASK_AUTO_REVIEW_ENABLED_STORAGE_KEY,
	TASK_AUTO_REVIEW_MODE_STORAGE_KEY,
	TASK_START_IN_PLAN_MODE_STORAGE_KEY,
} from "@/kanban/app/app-utils";
import { useBooleanLocalStorageValue, useRawLocalStorageValue } from "@/kanban/hooks/react-use";
import type { RuntimeAgentId, RuntimeTaskWorkspaceInfoResponse } from "@/kanban/runtime/types";
import { addTaskToColumn, findCardSelection, updateTask } from "@/kanban/state/board-state";
import { trackTaskCreated } from "@/kanban/telemetry/events";
import type { BoardCard, BoardData, TaskAutoReviewMode } from "@/kanban/types";
import { resolveTaskAutoReviewMode } from "@/kanban/types";

interface UseTaskEditorInput {
	board: BoardData;
	setBoard: Dispatch<SetStateAction<BoardData>>;
	currentProjectId: string | null;
	createTaskBranchOptions: Array<{ value: string; label: string }>;
	defaultTaskBranchRef: string;
	selectedAgentId: RuntimeAgentId | null;
	setSelectedTaskId: Dispatch<SetStateAction<string | null>>;
	setSelectedTaskWorkspaceInfo: Dispatch<SetStateAction<RuntimeTaskWorkspaceInfoResponse | null>>;
	onClearWorktreeError: () => void;
}

interface OpenEditTaskOptions {
	preserveDetailSelection?: boolean;
}

export interface UseTaskEditorResult {
	isInlineTaskCreateOpen: boolean;
	newTaskPrompt: string;
	setNewTaskPrompt: Dispatch<SetStateAction<string>>;
	newTaskStartInPlanMode: boolean;
	setNewTaskStartInPlanMode: Dispatch<SetStateAction<boolean>>;
	newTaskAutoReviewEnabled: boolean;
	setNewTaskAutoReviewEnabled: Dispatch<SetStateAction<boolean>>;
	newTaskAutoReviewMode: TaskAutoReviewMode;
	setNewTaskAutoReviewMode: Dispatch<SetStateAction<TaskAutoReviewMode>>;
	isNewTaskStartInPlanModeDisabled: boolean;
	newTaskBranchRef: string;
	setNewTaskBranchRef: Dispatch<SetStateAction<string>>;
	editingTaskId: string | null;
	editTaskPrompt: string;
	setEditTaskPrompt: Dispatch<SetStateAction<string>>;
	editTaskStartInPlanMode: boolean;
	setEditTaskStartInPlanMode: Dispatch<SetStateAction<boolean>>;
	editTaskAutoReviewEnabled: boolean;
	setEditTaskAutoReviewEnabled: Dispatch<SetStateAction<boolean>>;
	editTaskAutoReviewMode: TaskAutoReviewMode;
	setEditTaskAutoReviewMode: Dispatch<SetStateAction<TaskAutoReviewMode>>;
	editTaskBranchRef: string;
	setEditTaskBranchRef: Dispatch<SetStateAction<string>>;
	handleOpenCreateTask: () => void;
	handleCancelCreateTask: () => void;
	handleOpenEditTask: (task: BoardCard, options?: OpenEditTaskOptions) => void;
	handleCancelEditTask: () => void;
	handleSaveEditedTask: () => void;
	handleCreateTask: () => void;
	resetTaskEditorState: () => void;
}

export function useTaskEditor({
	board,
	setBoard,
	currentProjectId,
	createTaskBranchOptions,
	defaultTaskBranchRef,
	selectedAgentId,
	setSelectedTaskId,
	setSelectedTaskWorkspaceInfo,
	onClearWorktreeError,
}: UseTaskEditorInput): UseTaskEditorResult {
	const [isInlineTaskCreateOpen, setIsInlineTaskCreateOpen] = useState(false);
	const [newTaskPrompt, setNewTaskPrompt] = useState("");
	const [newTaskStartInPlanMode, setNewTaskStartInPlanMode] = useBooleanLocalStorageValue(
		TASK_START_IN_PLAN_MODE_STORAGE_KEY,
		false,
	);
	const [newTaskAutoReviewEnabled, setNewTaskAutoReviewEnabled] = useBooleanLocalStorageValue(
		TASK_AUTO_REVIEW_ENABLED_STORAGE_KEY,
		false,
	);
	const [newTaskAutoReviewMode, setNewTaskAutoReviewMode] = useRawLocalStorageValue<TaskAutoReviewMode>(
		TASK_AUTO_REVIEW_MODE_STORAGE_KEY,
		"commit",
		normalizeStoredTaskAutoReviewMode,
	);
	const isNewTaskStartInPlanModeDisabled = newTaskAutoReviewEnabled && newTaskAutoReviewMode === "move_to_trash";
	const [newTaskBranchRef, setNewTaskBranchRef] = useState("");
	const [lastCreatedTaskBranchByProjectId, setLastCreatedTaskBranchByProjectId] = useState<Record<string, string>>({});
	const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
	const [editTaskPrompt, setEditTaskPrompt] = useState("");
	const [editTaskStartInPlanMode, setEditTaskStartInPlanMode] = useState(false);
	const [editTaskAutoReviewEnabled, setEditTaskAutoReviewEnabled] = useState(false);
	const [editTaskAutoReviewMode, setEditTaskAutoReviewMode] = useState<TaskAutoReviewMode>("commit");
	const [editTaskBranchRef, setEditTaskBranchRef] = useState("");

	const lastCreatedTaskBranchRef = useMemo(() => {
		if (!currentProjectId) {
			return null;
		}
		return lastCreatedTaskBranchByProjectId[currentProjectId] ?? null;
	}, [currentProjectId, lastCreatedTaskBranchByProjectId]);

	const resolvedDefaultTaskBranchRef = useMemo(() => {
		if (
			lastCreatedTaskBranchRef &&
			createTaskBranchOptions.some((option) => option.value === lastCreatedTaskBranchRef)
		) {
			return lastCreatedTaskBranchRef;
		}
		return defaultTaskBranchRef;
	}, [createTaskBranchOptions, defaultTaskBranchRef, lastCreatedTaskBranchRef]);

	useEffect(() => {
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === newTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [createTaskBranchOptions, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!isInlineTaskCreateOpen) {
			return;
		}
		if (!newTaskBranchRef) {
			setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
		}
	}, [isInlineTaskCreateOpen, newTaskBranchRef, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!isNewTaskStartInPlanModeDisabled || !newTaskStartInPlanMode) {
			return;
		}
		setNewTaskStartInPlanMode(false);
	}, [isNewTaskStartInPlanModeDisabled, newTaskStartInPlanMode, setNewTaskStartInPlanMode]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const isCurrentValid = createTaskBranchOptions.some((option) => option.value === editTaskBranchRef);
		if (isCurrentValid) {
			return;
		}
		setEditTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [createTaskBranchOptions, editTaskBranchRef, editingTaskId, resolvedDefaultTaskBranchRef]);

	useEffect(() => {
		if (!editingTaskId) {
			return;
		}
		const selection = findCardSelection(board, editingTaskId);
		if (!selection || selection.column.id !== "backlog") {
			setEditingTaskId(null);
			setEditTaskPrompt("");
			setEditTaskStartInPlanMode(false);
			setEditTaskAutoReviewEnabled(false);
			setEditTaskAutoReviewMode("commit");
			setEditTaskBranchRef("");
		}
	}, [board, editingTaskId]);

	const handleOpenCreateTask = useCallback(() => {
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setIsInlineTaskCreateOpen(true);
	}, []);

	const handleCancelCreateTask = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setNewTaskPrompt("");
		setNewTaskBranchRef(resolvedDefaultTaskBranchRef);
	}, [resolvedDefaultTaskBranchRef]);

	const handleOpenEditTask = useCallback(
		(task: BoardCard, options?: OpenEditTaskOptions) => {
			if (!options?.preserveDetailSelection) {
				setSelectedTaskId(null);
				setSelectedTaskWorkspaceInfo(null);
			}
			setIsInlineTaskCreateOpen(false);
			setNewTaskPrompt("");
			const taskPrompt = task.prompt.trim();
			setEditingTaskId(task.id);
			setEditTaskPrompt(taskPrompt);
			setEditTaskStartInPlanMode(task.startInPlanMode);
			setEditTaskAutoReviewEnabled(task.autoReviewEnabled === true);
			setEditTaskAutoReviewMode(resolveTaskAutoReviewMode(task.autoReviewMode));
			const fallbackBranch = task.baseRef || resolvedDefaultTaskBranchRef;
			setEditTaskBranchRef(fallbackBranch);
		},
		[resolvedDefaultTaskBranchRef, setSelectedTaskId, setSelectedTaskWorkspaceInfo],
	);

	const handleCancelEditTask = useCallback(() => {
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
		setEditTaskAutoReviewEnabled(false);
		setEditTaskAutoReviewMode("commit");
		setEditTaskBranchRef("");
	}, []);

	const handleSaveEditedTask = useCallback(() => {
		if (!editingTaskId) {
			return;
		}
		const prompt = editTaskPrompt.trim();
		if (!prompt) {
			return;
		}
		if (!(editTaskBranchRef || resolvedDefaultTaskBranchRef)) {
			return;
		}

		const baseRef = editTaskBranchRef || resolvedDefaultTaskBranchRef;

		setBoard((currentBoard) => {
			const updated = updateTask(currentBoard, editingTaskId, {
				prompt,
				startInPlanMode: editTaskStartInPlanMode,
				autoReviewEnabled: editTaskAutoReviewEnabled,
				autoReviewMode: editTaskAutoReviewMode,
				baseRef,
			});
			return updated.updated ? updated.board : currentBoard;
		});
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setEditTaskAutoReviewEnabled(false);
		setEditTaskAutoReviewMode("commit");
		onClearWorktreeError();
	}, [
		editTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		editTaskBranchRef,
		editTaskPrompt,
		editTaskStartInPlanMode,
		editingTaskId,
		onClearWorktreeError,
		resolvedDefaultTaskBranchRef,
		setBoard,
	]);

	const handleCreateTask = useCallback(() => {
		const prompt = newTaskPrompt.trim();
		if (!prompt) {
			return;
		}
		if (!(newTaskBranchRef || resolvedDefaultTaskBranchRef)) {
			return;
		}
		const baseRef = newTaskBranchRef || resolvedDefaultTaskBranchRef;
		setBoard((currentBoard) =>
			addTaskToColumn(currentBoard, "backlog", {
				prompt,
				startInPlanMode: newTaskStartInPlanMode,
				autoReviewEnabled: newTaskAutoReviewEnabled,
				autoReviewMode: newTaskAutoReviewMode,
				baseRef,
			}),
		);
		trackTaskCreated({
			selected_agent_id: selectedAgentId ?? "unknown",
			start_in_plan_mode: newTaskStartInPlanMode,
			prompt_character_count: prompt.length,
		});
		if (currentProjectId) {
			setLastCreatedTaskBranchByProjectId((current) => ({
				...current,
				[currentProjectId]: baseRef,
			}));
		}
		setNewTaskPrompt("");
		setNewTaskBranchRef(baseRef);
		setIsInlineTaskCreateOpen(false);
		onClearWorktreeError();
	}, [
		currentProjectId,
		newTaskAutoReviewEnabled,
		newTaskAutoReviewMode,
		newTaskBranchRef,
		newTaskPrompt,
		newTaskStartInPlanMode,
		onClearWorktreeError,
		resolvedDefaultTaskBranchRef,
		selectedAgentId,
		setBoard,
	]);

	const resetTaskEditorState = useCallback(() => {
		setIsInlineTaskCreateOpen(false);
		setEditingTaskId(null);
		setEditTaskPrompt("");
		setEditTaskStartInPlanMode(false);
		setEditTaskAutoReviewEnabled(false);
		setEditTaskAutoReviewMode("commit");
		setEditTaskBranchRef("");
	}, []);

	return {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		newTaskAutoReviewEnabled,
		setNewTaskAutoReviewEnabled,
		newTaskAutoReviewMode,
		setNewTaskAutoReviewMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		editTaskAutoReviewEnabled,
		setEditTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		setEditTaskAutoReviewMode,
		editTaskBranchRef,
		setEditTaskBranchRef,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleCreateTask,
		resetTaskEditorState,
	};
}
